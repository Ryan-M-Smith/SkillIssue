## Autoload `GameSession`: lobby / match state and the server-authorized controller table.
## The server owns pairing and assignments; this node mirrors what the server reports and
## answers "which controller is team T's mover?" for InputRouter. No gameplay here.
extends Node

signal registered(game_id: String, pairing_code: String)
signal state_changed(state: String)
signal controller_assigned(controller_id: String, team: int, role: String)
signal controller_removed(controller_id: String, team: int, role: String)
signal controller_ready_changed(controller_id: String, is_ready: bool)
signal server_message(message: String)
signal server_error(error: String)

const STATES: PackedStringArray = ["waiting", "ready", "playing", "paused", "ended"]
const ROLES: PackedStringArray = ["mover", "gunner"]   ## game-side role names (PhoneDuoController)
const TEAM_COUNT := 2

## Protocol role names → game role names. Unknown roles are rejected.
const ROLE_ALIASES := {
	"movement": "mover", "mover": "mover",
	"aim": "gunner", "gunner": "gunner",
}

## The protocol numbers teams 1 and 2; the game's TeamData ids are 0 (blue) and 1 (red).
@export var server_team_offset := 1

var game_id := ""
var pairing_code := ""
var state := "waiting"

## controller_id -> {"team": int, "role": String, "ready": bool}
var _controllers := {}


func _ready() -> void:
	NetworkClient.game_event_received.connect(_on_game_event)
	NetworkClient.connection_changed.connect(_on_connection_changed)


## Controller id holding a team's role, or "" if the slot is empty.
func controller_at(team: int, role: String) -> String:
	for id in _controllers:
		var c: Dictionary = _controllers[id]
		if c.team == team and c.role == role:
			return id
	return ""


## {"team", "role", "ready"} for a controller, or {} if unknown.
func controller_info(controller_id: String) -> Dictionary:
	return _controllers.get(controller_id, {})


func controller_count() -> int:
	return _controllers.size()


func all_slots_filled() -> bool:
	return _controllers.size() == TEAM_COUNT * ROLES.size()


func is_playing() -> bool:
	return state == "playing"


## Asks the server to start the match. The server validates it and broadcasts the new state.
func request_start() -> bool:
	return NetworkClient.send_event("start_game", {"gameId": game_id})


## Marks a controller ready (from its "ready" action). Purely lobby display state.
func set_controller_ready(controller_id: String, is_ready: bool) -> void:
	if _controllers.has(controller_id) and _controllers[controller_id].ready != is_ready:
		_controllers[controller_id].ready = is_ready
		controller_ready_changed.emit(controller_id, is_ready)


static func normalize_role(role: String) -> String:
	return ROLE_ALIASES.get(role.to_lower(), "")


func _on_game_event(event: Dictionary) -> void:
	var p: Dictionary = event.payload
	match event.type:
		"game_registered":
			game_id = str(p.get("gameId", ""))
			pairing_code = str(p.get("pairingCode", ""))
			registered.emit(game_id, pairing_code)
			_set_state(str(p.get("state", "waiting")))
		"controller_assigned":
			_assign(str(p.get("controllerId", "")), p.get("teamId"), str(p.get("role", "")))
		"role":
			# Legacy role event. controller_assigned is authoritative; `role` only changes
			# the role of a controller the server already assigned (sender = controller id).
			var id: String = event.sender
			if _controllers.has(id):
				_assign(id, _controllers[id].team + server_team_offset, str(p.get("role", "")))
		"controller_disconnected":
			_remove(str(p.get("controllerId", "")))
		"broadcast":
			if p.has("state"):
				_set_state(str(p.state))
			if p.has("message"):
				server_message.emit(str(p.message))
			if p.has("error"):
				server_error.emit(str(p.error))
				push_warning("GameSession: server error: %s" % p.error)


func _assign(id: String, server_team: Variant, raw_role: String) -> void:
	var role := normalize_role(raw_role)
	if id.is_empty() or role.is_empty() or (typeof(server_team) != TYPE_FLOAT and typeof(server_team) != TYPE_INT):
		push_warning("GameSession: ignoring invalid assignment (%s, %s, %s)" % [id, server_team, raw_role])
		return
	var team := int(server_team) - server_team_offset
	if team < 0 or team >= TEAM_COUNT:
		push_warning("GameSession: ignoring assignment to unknown team %s" % server_team)
		return
	# Reassignment: drop whatever this controller held, and whoever held the target slot,
	# so an old connection can never keep sending input into a slot it lost.
	if _controllers.has(id):
		_remove(id)
	var previous := controller_at(team, role)
	if not previous.is_empty():
		_remove(previous)
	_controllers[id] = {"team": team, "role": role, "ready": false}
	controller_assigned.emit(id, team, role)


func _remove(id: String) -> void:
	if not _controllers.has(id):
		return
	var c: Dictionary = _controllers[id]
	_controllers.erase(id)
	controller_removed.emit(id, c.team, c.role)


func _set_state(new_state: String) -> void:
	if not STATES.has(new_state):
		push_warning("GameSession: ignoring unknown state '%s'" % new_state)
		return
	if new_state != state:
		state = new_state
		state_changed.emit(state)


## Losing the server invalidates the session: the server drops it when the host leaves,
## so phones must rejoin with the new pairing code after we reconnect.
func _on_connection_changed(connected: bool) -> void:
	if connected:
		return
	for id in _controllers.keys():
		_remove(id)
	game_id = ""
	pairing_code = ""
	_set_state("waiting")
