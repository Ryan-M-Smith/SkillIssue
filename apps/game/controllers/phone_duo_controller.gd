## Combines a team's two phones (mover + gunner) into one Duo's input.
## Also sends state back (health, guns owned, scope) and buzzes phones on hits.
## Talks to the InputRouter autoload (scripts/input_router.gd) only if it provides
## `phone_message` / `send_to`, so it also runs without networking, without errors.
class_name PhoneDuoController
extends DuoController

@export var team := 0
@export var state_send_interval := 0.15

var _move := Vector2.ZERO
var _crouch := false
var _sprint := false
var _fire := false
var _aim_accum := Vector2.ZERO
var _jump_queued := false
var _scope_queued := false
var _weapon_queued := -1
var _send_timer := 0.0
var _bridge: Node


func _init(team_id: int = 0) -> void:
	team = team_id
	name = "PhoneController%d" % team_id


func _ready() -> void:
	_bridge = get_node_or_null("/root/InputRouter")
	if _bridge == null:
		return
	if _bridge.has_signal("phone_message"):
		_bridge.connect("phone_message", _on_phone_message)
	if _bridge.has_signal("phone_left"):
		_bridge.connect("phone_left", _on_phone_left)


func _send(role: String, msg: Dictionary) -> void:
	if _bridge and _bridge.has_method("send_to"):
		_bridge.call("send_to", team, role, msg)


func _on_attached() -> void:
	duo.health.damaged.connect(func(_amount, _source):
		_send("mover", {"t": "buzz", "ms": 70})
		_send("gunner", {"t": "buzz", "ms": 70}))


func _on_phone_message(msg_team: int, role: String, msg: Dictionary) -> void:
	if msg_team != team:
		return
	var t: String = msg.get("t", "")
	if role == "mover":
		match t:
			"move":
				_move = Vector2(float(msg.get("x", 0.0)), float(msg.get("y", 0.0)))
			"btn":
				var held := int(msg.get("v", 0)) == 1
				match msg.get("b", ""):
					"jump":
						if held:
							_jump_queued = true
					"crouch":
						_crouch = held
					"sprint":
						_sprint = held
	elif role == "gunner":
		match t:
			"aim":
				_aim_accum += Vector2(float(msg.get("dx", 0.0)), float(msg.get("dy", 0.0)))
			"btn":
				var held := int(msg.get("v", 0)) == 1
				match msg.get("b", ""):
					"fire":
						_fire = held
					"scope":
						if held:
							_scope_queued = true
			"weapon":
				_weapon_queued = int(msg.get("i", -1))


func _on_phone_left(msg_team: int, role: String) -> void:
	if msg_team != team:
		return
	if role == "mover":
		_move = Vector2.ZERO
		_crouch = false
		_sprint = false
	else:
		_fire = false
		_aim_accum = Vector2.ZERO


func poll(input: DuoInput, _delta: float) -> void:
	input.move += _move
	input.crouch = input.crouch or _crouch
	input.sprint = input.sprint or _sprint
	input.fire = input.fire or _fire
	input.aim_delta += _aim_accum
	_aim_accum = Vector2.ZERO
	if _jump_queued:
		input.jump = true
		_jump_queued = false
	if _scope_queued:
		input.scope_toggle = true
		_scope_queued = false
	if _weapon_queued >= 0:
		input.weapon_slot = _weapon_queued
		_weapon_queued = -1


func _process(delta: float) -> void:
	if duo == null or _bridge == null or not _bridge.has_method("send_to"):
		return
	_send_timer -= delta
	if _send_timer > 0.0:
		return
	_send_timer = state_send_interval
	var w: WeaponComponent = duo.weapons
	var base := {"t": "state", "hp": duo.health.hp, "max_hp": duo.health.max_health, "alive": duo.alive}
	_send("mover", base)
	var g := base.duplicate()
	g["weapon"] = w.current
	g["owned"] = w.owned
	g["scoped"] = w.scoped
	g["can_scope"] = w.current_data() != null and w.current_data().has_scope
	_send("gunner", g)
