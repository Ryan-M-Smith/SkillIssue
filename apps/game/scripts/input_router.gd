## Autoload `InputRouter`: network events → the right team's PhoneDuoController.
## Looks up each event's sender in GameSession (the server-authorized table), checks the
## sender's role may send it, and re-emits it in the small format PhoneDuoController reads:
##   mover:  {t:"move", x, y}  {t:"btn", b:"jump"|"crouch"|"sprint", v:0|1}
##   gunner: {t:"aim", dx, dy} {t:"btn", b:"fire"|"scope", v:0|1}  {t:"weapon", i}
## `broadcast` and `role` events are GameSession's job; this node only routes input.
extends Node

## PhoneDuoController connects to these by name.
signal phone_message(team: int, role: String, msg: Dictionary)
signal phone_left(team: int, role: String)
## Every dropped event, with the reason. For tests and debugging; not printed.
signal event_dropped(reason: String, event: Dictionary)

## Which game role may send which action (spec: the movement phone can't drive aim and
## vice versa). Actions in ANY_ROLE_ACTIONS are accepted from both.
const ACTIONS_BY_ROLE := {
	"mover": ["jump", "crouch", "sprint"],
	"gunner": ["shoot", "reload", "scope", "weapon"],
}
const ANY_ROLE_ACTIONS := ["ready", "interact", "none"]
## Valid protocol actions the Duo can't do yet. Accepted and counted, nothing happens.
const UNSUPPORTED_ACTIONS := ["interact", "none"]

const Motion := preload("res://scripts/network/motion_interpreter.gd")

@export var only_during_play := true   ## drop gameplay input unless GameSession.is_playing()
## Both supported servers authorize and forward these state / hit feedback messages.
@export var feedback_enabled := true
@export var tap_fire_seconds := 0.1     ## "shoot" with no `pressed` field holds fire this long
@export var tap_crouch_seconds := 1.5   ## "crouch" with no `pressed` field (companion's crouch length)

var _motion := {}          ## controller_id -> Motion
var _last_move := {}       ## controller_id -> Vector2 last sent to the Duo
var _timed := {}           ## "id:button" -> {left, team, role, button}: auto-release for taps
var _sprinting := {}       ## controller_id -> bool, for `sprint` taps without `pressed` (toggle)
var _last_action_ts := {}  ## "id:action" -> timestamp, to drop retransmitted one-shots
var _last_input_msec := {} ## controller_id -> newest valid input; lost sensors release held buttons
var _cleared := {}         ## emit the role reset only once per stale period
var _stats := {
	"motion": 0, "actions": 0, "unsupported": 0, "dropped": 0,
	"latency_ms_avg": 0.0, "latency_samples": 0,
}


func _ready() -> void:
	NetworkClient.game_event_received.connect(_on_game_event)
	GameSession.controller_assigned.connect(_on_controller_assigned)
	GameSession.controller_removed.connect(_on_controller_removed)
	GameSession.state_changed.connect(_on_session_state_changed)


## PhoneDuoController calls this to reach a team's phone (state, buzz).
func send_to(team: int, role: String, msg: Dictionary) -> void:
	if not feedback_enabled:
		return
	var id := GameSession.controller_at(team, role)
	if not id.is_empty():
		NetworkClient.send_message("to_controller", {"controllerId": id, "message": msg})


## The MotionInterpreter for a controller, to tune sensitivity / axes at runtime.
func motion_interpreter(controller_id: String) -> Motion:
	return _motion.get(controller_id)


func get_stats() -> Dictionary:
	return _stats.duplicate()


func _on_game_event(event: Dictionary) -> void:
	match event.type:
		"motion":
			_handle_motion(event)
		"environment":
			_handle_environment(event)


func _handle_motion(event: Dictionary) -> void:
	var info := _sender_info(event)
	if info.is_empty():
		return
	if not _gameplay_open():
		return
	var id: String = event.sender
	var interp: Motion = _motion.get(id)
	if interp == null or not interp.feed(event.payload, info.role, Time.get_ticks_msec()):
		_drop("motion payload has no usable readings", event)
		return
	_stats.motion += 1
	_last_input_msec[id] = Time.get_ticks_msec()
	_cleared[id] = false
	_sample_latency(event.timestamp)


func _handle_environment(event: Dictionary) -> void:
	var info := _sender_info(event)
	if info.is_empty():
		return
	var id: String = event.sender
	var action: Variant = event.payload.get("action")
	if typeof(action) != TYPE_STRING:
		_drop("environment without a string 'action'", event)
		return
	var allowed: Array = ACTIONS_BY_ROLE.get(info.role, [])
	if not (action in ANY_ROLE_ACTIONS or action in allowed):
		_drop("action '%s' not allowed for role %s (or unknown)" % [action, info.role], event)
		return
	# One-shot actions retransmitted with the same timestamp must not fire twice.
	var key := "%s:%s" % [id, action]
	if event.timestamp > 0.0 and _last_action_ts.get(key, -1.0) == event.timestamp:
		_drop("duplicate action", event)
		return
	_last_action_ts[key] = event.timestamp

	var pressed_v: Variant = event.payload.get("pressed")
	var has_pressed := typeof(pressed_v) == TYPE_BOOL
	var pressed: bool = pressed_v if has_pressed else true
	_stats.actions += 1
	if _gameplay_open():
		_last_input_msec[id] = Time.get_ticks_msec()
		_cleared[id] = false
	_sample_latency(event.timestamp)

	match action:
		"ready":
			GameSession.set_controller_ready(id, pressed)
			if _motion.has(id):
				(_motion[id] as Motion).calibrate()
		"jump":
			if pressed and _gameplay_open():
				_emit(info, {"t": "btn", "b": "jump", "v": 1})
		"crouch":
			_button(id, info, "crouch", pressed, has_pressed, tap_crouch_seconds)
		"sprint":
			# The companion toggles sprint and sends the new state as `pressed`.
			# Without `pressed`, each sprint event flips it here instead.
			var on: bool = pressed if has_pressed else not _sprinting.get(id, false)
			if on and not _gameplay_open():
				return
			_sprinting[id] = on
			_emit(info, {"t": "btn", "b": "sprint", "v": 1 if on else 0})
		"shoot":
			_button(id, info, "fire", pressed, has_pressed, tap_fire_seconds)
		"scope", "reload":
			if pressed and _gameplay_open():
				_emit(info, {"t": "btn", "b": action, "v": 1})
		"weapon":
			if not pressed or not _gameplay_open():
				return
			var slot: Variant = event.payload.get("slot")
			if typeof(slot) == TYPE_INT or typeof(slot) == TYPE_FLOAT:
				_emit(info, {"t": "weapon", "i": int(slot)})
			else:
				_drop("weapon action without a numeric 'slot'", event)
		_:
			if action in UNSUPPORTED_ACTIONS:
				_stats.unsupported += 1


## Held button. With `pressed` it follows press/release; without it (current protocol)
## it's a tap that releases itself after `tap_seconds`.
func _button(id: String, info: Dictionary, button: String, pressed: bool, has_pressed: bool, tap_seconds: float) -> void:
	if pressed and not _gameplay_open():
		return
	var key := "%s:%s" % [id, button]
	_emit(info, {"t": "btn", "b": button, "v": 1 if pressed else 0})
	if pressed and not has_pressed:
		_timed[key] = {"left": tap_seconds, "team": info.team, "role": info.role, "button": button}
	else:
		_timed.erase(key)


## Motion is applied here, once per physics frame, from the newest reading only,
## so a burst of packets never turns into a backlog of stale input.
func _physics_process(delta: float) -> void:
	var now := Time.get_ticks_msec()
	var open := _gameplay_open()
	for id in _motion:
		var info := GameSession.controller_info(id)
		if info.is_empty():
			continue
		var interp: Motion = _motion[id]
		if interp.is_stale(now):
			interp.clear()
		var latest: int = _last_input_msec.get(id, -1)
		if not open or latest < 0 or now - latest > interp.stale_after_msec:
			_clear_controller_input(id, info)
			continue
		if info.role == "mover":
			var m := interp.move if open else Vector2.ZERO
			if m != _last_move.get(id, Vector2.ZERO):
				_last_move[id] = m
				_emit(info, {"t": "move", "x": m.x, "y": m.y})
		elif open and interp.aim_rate != Vector2.ZERO:
			var d := interp.aim_rate * delta
			_emit(info, {"t": "aim", "dx": d.x, "dy": d.y})

	for key in _timed.keys():
		var t: Dictionary = _timed[key]
		t.left -= delta
		if t.left <= 0.0:
			_timed.erase(key)
			phone_message.emit(t.team, t.role, {"t": "btn", "b": t.button, "v": 0})


func _on_controller_assigned(id: String, _team: int, _role: String) -> void:
	_motion[id] = Motion.new()   # fresh: recalibrates on its first reading
	_last_move.erase(id)
	_sprinting.erase(id)
	_last_input_msec.erase(id)
	_cleared.erase(id)


## Disconnect or reassignment: forget the controller and clear that role's input.
func _on_controller_removed(id: String, team: int, role: String) -> void:
	_motion.erase(id)
	_last_move.erase(id)
	_sprinting.erase(id)
	_last_input_msec.erase(id)
	_cleared.erase(id)
	for key in _timed.keys():
		if (key as String).begins_with(id + ":"):
			_timed.erase(key)
	for key in _last_action_ts.keys():
		if (key as String).begins_with(id + ":"):
			_last_action_ts.erase(key)
	phone_left.emit(team, role)


## Stale sensors and lobby transitions must release held buttons even when the socket
## remains open. A single reset per stale period prevents per-frame signal spam.
func _clear_controller_input(id: String, info: Dictionary) -> void:
	if _cleared.get(id, false):
		return
	_cleared[id] = true
	if _motion.has(id):
		(_motion[id] as Motion).clear()
	_last_move.erase(id)
	_sprinting.erase(id)
	for key in _timed.keys():
		if (key as String).begins_with(id + ":"):
			_timed.erase(key)
	phone_left.emit(info.team, info.role)


func _on_session_state_changed(_state: String) -> void:
	if _gameplay_open():
		return
	for id in _motion:
		var info := GameSession.controller_info(id)
		if not info.is_empty():
			_clear_controller_input(id, info)


func _sender_info(event: Dictionary) -> Dictionary:
	var info := GameSession.controller_info(event.sender)
	if info.is_empty():
		_drop("sender '%s' is not an assigned controller" % event.sender, event)
	return info


func _gameplay_open() -> bool:
	return not only_during_play or GameSession.is_playing()


func _emit(info: Dictionary, msg: Dictionary) -> void:
	phone_message.emit(info.team, info.role, msg)


func _drop(reason: String, event: Dictionary) -> void:
	_stats.dropped += 1
	event_dropped.emit(reason, event)


## Unix-ms timestamps only; values that clearly aren't wall-clock time are skipped.
## Includes any clock difference between phone and PC, so compare runs, not absolutes.
func _sample_latency(timestamp: float) -> void:
	if timestamp < 1.0e12:
		return
	var lat := Time.get_unix_time_from_system() * 1000.0 - timestamp
	var n: int = _stats.latency_samples + 1
	_stats.latency_ms_avg += (lat - _stats.latency_ms_avg) / n
	_stats.latency_samples = n
