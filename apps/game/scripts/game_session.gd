## Autoload `GameSession`: lobby / match state and the server-authorized controller table.
## The server owns pairing and assignments; this node mirrors what the server reports
## (lobby_state.assignments, controller_disconnected, broadcast) and answers
## "which controller is team T's mover?" for InputRouter. No gameplay here.
extends Node

signal registered(game_id: String, pairing_code: String)
signal state_changed(state: String)
signal controller_assigned(controller_id: String, team: int, role: String)
signal controller_removed(controller_id: String, team: int, role: String)
signal controller_ready_changed(controller_id: String, is_ready: bool)
signal server_message(message: String)
signal server_error(error: String)
## The lobby roster or its state changed (names, spots, ready flags). Read `players`.
signal lobby_changed()

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
## Ask the server to start the match as soon as the lobby is ready (all four
## slots, or fewer when the server runs with MIN_CONTROLLERS). Off by default: the
## lobby screen counts down and starts the match itself.
@export var auto_start := false

var game_id := ""
var pairing_code := ""
var state := "waiting"

## Every phone in the lobby, slotted or not, in join order:
## {"id", "name", "team" (game team, -1 = none), "role" ("mover"/"gunner"/""), "ready", "connected"}
var players: Array[Dictionary] = []
## Slotted, ready phones it takes to start (from the server).
var min_players := 4

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


## Asks the server to start the match. The server accepts it only when all four slots are
## filled, then broadcasts state "playing"; otherwise it replies with join_rejected.
func request_start() -> bool:
	return NetworkClient.send_message("start_game")


## Starts the server if needed and connects to it as the game host. The server
## replies with the join code (`registered`). Await it; check `pairing_code`.
func create_lobby() -> void:
	await ServerProcess.ensure_running()
	if not ServerProcess.is_up():
		server_error.emit(ServerProcess.message)
		return
	NetworkClient.connect_to_server(ServerProcess.server_url())


## Disconnects from the server, which closes the lobby for every phone.
func leave_lobby() -> void:
	NetworkClient.disconnect_from_server()


## While playing: the live score and clock, which the server passes to the phones.
## `scores` is indexed by game team (0 blue, 1 red).
func send_match_status(scores: Array, time_left: float, kill_target: int) -> void:
	NetworkClient.send_message("match_status", {
		"scores": [scores[0], scores[1]], "timeLeft": snappedf(time_left, 0.1), "killTarget": kill_target,
	})


## The match is over: the server moves to "ended" and shows the phones the result.
## `winning_team` is a game team (0/1), or -1 for a draw. `stats` are protocol TeamStats.
func end_match(winning_team: int, scores: Array, stats: Array) -> void:
	NetworkClient.send_message("end_game", {
		"winningTeam": null if winning_team < 0 else winning_team + server_team_offset,
		"scores": [scores[0], scores[1]],
		"stats": stats,
	})


## Play Again: back to the lobby with the same code and players, ready flags cleared.
func reset_lobby() -> void:
	NetworkClient.send_message("reset_lobby")


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
		"lobby_state":
			# The server's full assignment list; the game learns assignments from this.
			_sync_assignments(p.get("assignments"))
			_sync_players(p.get("players"))
			if typeof(p.get("minPlayers")) in [TYPE_INT, TYPE_FLOAT]:
				min_players = int(p.minPlayers)
			if p.has("state"):
				_set_state(str(p.state))
			lobby_changed.emit()
		"controller_assigned":
			# The server sends this to the phone; accepted here too, nested or flat.
			var a: Variant = p.get("assignment", p)
			if typeof(a) == TYPE_DICTIONARY:
				_assign(str(a.get("controllerId", "")), a.get("teamId"), str(a.get("role", "")))
		"join_rejected":
			# The server reports errors to the game this way too (e.g. start before ready).
			var err := "%s: %s" % [p.get("code", "error"), p.get("message", "")]
			server_error.emit(err)
			push_warning("GameSession: server rejected a request: %s" % err)
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


## Makes the controller table match the server's list: drops controllers that are gone or
## disconnected, adds new ones, reassigns any whose team or role changed.
func _sync_assignments(list: Variant) -> void:
	if typeof(list) != TYPE_ARRAY:
		return
	var seen := {}
	for a in list:
		if typeof(a) != TYPE_DICTIONARY or a.get("connected", true) == false:
			continue
		var id := str(a.get("controllerId", ""))
		var role := normalize_role(str(a.get("role", "")))
		seen[id] = true
		var current := controller_info(id)
		var team_v: Variant = a.get("teamId")
		var team := int(team_v) - server_team_offset if typeof(team_v) in [TYPE_INT, TYPE_FLOAT] else -1
		if current.is_empty() or current.team != team or current.role != role:
			_assign(id, team_v, str(a.get("role", "")))
	for id in _controllers.keys():
		if not seen.has(id):
			_remove(id)


func _sync_players(list: Variant) -> void:
	players.clear()
	if typeof(list) != TYPE_ARRAY:
		return
	for a in list:
		if typeof(a) != TYPE_DICTIONARY:
			continue
		var team_v: Variant = a.get("teamId")
		players.append({
			"id": str(a.get("controllerId", "")),
			"name": str(a.get("name", "Player")),
			"team": int(team_v) - server_team_offset if typeof(team_v) in [TYPE_INT, TYPE_FLOAT] else -1,
			"role": normalize_role(str(a.get("role", ""))) if a.get("role") != null else "",
			"ready": a.get("ready", false) == true,
			"connected": a.get("connected", true) != false,
		})


## The player holding a game team's role, or {} if the spot is open.
func player_at(team: int, role: String) -> Dictionary:
	for p in players:
		if p.team == team and p.role == role:
			return p
	return {}


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
		if state == "ready" and auto_start:
			request_start.call_deferred()


## Losing the server invalidates the session: the server drops it when the host leaves,
## so phones must rejoin with the new pairing code after we reconnect.
func _on_connection_changed(connected: bool) -> void:
	if connected:
		return
	for id in _controllers.keys():
		_remove(id)
	players.clear()
	game_id = ""
	pairing_code = ""
	_set_state("waiting")
	lobby_changed.emit()
