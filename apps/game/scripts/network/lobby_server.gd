## Autoload `LobbyServer`: the SkillIssue WebSocket server, running inside the game.
## Phones connect to ws://<this computer>:8080, join with the lobby code, pick a team and
## role, ready up, and stream input. Nothing to install: no Node.js, no separate process.
##
## The game itself is the lobby host, but it doesn't open a socket to itself: NetworkClient
## talks to this node directly (NetworkClient.connect_local) and gets the same messages a
## remote server would send it. Protocol: docs/network-protocol.md and
## packages/protocol/events.ts. apps/server/index.ts is the same server in Node, kept for
## the web debugger and for running a server on its own.
##
## Also relays the debug stream (debug_join / debug_motion / debug_event), so the phone
## app's Practice screen and the web debugger work against the game too.
extends Node

## "idle" | "running" (ours) | "external" (another server already has the port) | "failed"
signal status_changed(state: String, message: String)

const PROTOCOL_VERSION := 1
const CODE_LENGTH := 6
## Letters and digits that can't be mistaken for each other (no 0/O, 1/I/L).
const CODE_ALPHABET := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const MAX_PLAYERS := 4
const MAX_NAME := 16
const SLOTS := [
	{"teamId": 1, "role": "movement"}, {"teamId": 1, "role": "aim"},
	{"teamId": 2, "role": "movement"}, {"teamId": 2, "role": "aim"},
]
const HANDSHAKE_TIMEOUT_MS := 5000
const MAX_DEBUG_READINGS := 50
const MAX_PACKETS_PER_PEER := 64   ## per frame, so one chatty phone can't stall the game
const MAX_CONNECTIONS := 32
const MAX_MESSAGE_BYTES := 65536
const MAX_MESSAGES_PER_SECOND := 240
const IDENTIFY_TIMEOUT_MS := 10000
const MOVEMENT_ACTIONS := ["jump", "crouch", "sprint"]
const AIM_ACTIONS := ["shoot", "scope", "weapon", "reload"]
const SHARED_ACTIONS := ["ready", "interact", "none"]

@export var port := 8080
## Phones a match needs when the host doesn't say (the host sends its own in hello: see
## GameSession.players_needed). Also settable with `-- --min-players=1`.
@export var min_players := 4

var state := "idle"
var message := ""

var _tcp := TCPServer.new()
var _pending: Array[Dictionary] = []   ## {"ws", "since"}: WebSocket handshakes in progress
var _closing: Array[Dictionary] = []   ## keep polling until the closing handshake finishes
var _peers := {}                       ## peer id -> {"ws", "kind", ...}; kind "" | "controller" | "debug"
var _next_peer := 1
var _rng := RandomNumberGenerator.new()

## The lobby (one per game): null until the host says hello.
var _session: Variant = null
var _host_inbox: Callable              ## delivers server → host messages to NetworkClient

var _debug_rooms := {}                 ## room -> {"phones": {peer id: true}, "viewers": {...}}
var _debug_room_re := RegEx.create_from_string("^[A-Za-z0-9_-]{1,32}$")


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # the tree pauses at the end of a match
	_rng.randomize()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--min-players="):
			min_players = clampi(arg.get_slice("=", 1).to_int(), 1, 4)


func is_up() -> bool:
	return state == "running" or state == "external"


func is_local() -> bool:
	return state == "running"


func server_url() -> String:
	return "ws://127.0.0.1:%d" % port


## Addresses phones on the same Wi-Fi can use, best guess first.
func lan_urls() -> PackedStringArray:
	var urls := PackedStringArray()
	for address in IP.get_local_addresses():
		if address.count(".") == 3 and not address.begins_with("127.") and not address.begins_with("169.254."):
			urls.append("ws://%s:%d" % [address, port])
	# Home and office networks first; VPN / container ranges last.
	var rank := func(u: String) -> int:
		return 0 if u.contains("//192.168.") else (1 if u.contains("//10.") else 2)
	var sorted := Array(urls)
	sorted.sort_custom(func(a, b): return rank.call(a) < rank.call(b))
	return PackedStringArray(sorted)


## Starts listening if it isn't already. If something else holds the port (say, the Node
## server started by hand), the state becomes "external" and the game connects to that.
func ensure_running() -> void:
	if is_up():
		return
	var err := _tcp.listen(port, "*")
	if err == OK:
		_set_status("running", "Server running on port %d." % port)
		print("[LobbyServer] listening on ws://*:%d" % port)
		for url in lan_urls():
			print("[LobbyServer]   phones on your network: ", url)
		return
	if await _port_open():
		_set_status("external", "Using the server already running on port %d." % port)
	else:
		_set_status("failed", "Couldn't open port %d for phones (error %d). Close whatever is using it and retry." % [port, err])


func stop() -> void:
	host_left()
	for id in _peers.keys():
		_close_peer(id, 1001, "Server shutting down.")
	for p in _pending:
		p.ws.close()
	_pending.clear()
	_closing.clear()
	_tcp.stop()
	if state == "running":
		_set_status("idle", "")


func _exit_tree() -> void:
	stop()


# --- The in-process host (NetworkClient.connect_local) ---

## NetworkClient registers where the host's messages go. Then it sends "hello".
func attach_host(inbox: Callable) -> void:
	host_left()
	_host_inbox = inbox


## The game left the lobby: close it for every phone.
func host_left() -> void:
	_host_inbox = Callable()
	_close_lobby()


func _close_lobby() -> void:
	if _session == null:
		return
	var s: Dictionary = _session
	_session = null
	for id in s.controllers.keys():
		_close_peer(id, 1001, "Game host disconnected.")


## A message from the game host (same shape it would send over the wire).
func host_message(msg: Dictionary) -> void:
	match str(msg.get("type", "")):
		"hello":
			if not _valid_version(msg) or typeof(msg.get("clientType")) != TYPE_STRING or msg.clientType != "game":
				_to_host(_rejection("invalid_message", "Only protocol version 1 game hello messages are supported."))
				return
			_register_game(_player_count(msg.get("minPlayers")))
		"set_min_players":
			var count := _player_count(msg.get("minPlayers"))
			if _session == null or count == 0:
				_to_host(_rejection("invalid_message", "Only the game host can set the player count (1-4)."))
				return
			if _session.state == "waiting" or _session.state == "ready":
				_session.minPlayers = count
				_send_lobby_state()
		"start_game":
			_start_game()
		"match_status":
			_relay_match_status(msg)
		"end_game":
			_end_game(msg)
		"reset_lobby":
			_reset_lobby()
		"to_controller":
			_forward_feedback(msg)
		"swap_roles":
			_swap_roles(msg.get("teamId"))
		_:
			_to_host(_rejection("invalid_message", "Unknown message type."))


func _to_host(msg: Dictionary) -> void:
	if _host_inbox.is_valid():
		# Through JSON, so the game sees exactly what a remote server would send.
		_host_inbox.call(JSON.parse_string(JSON.stringify(msg)))


# --- Sockets ---

func _process(_delta: float) -> void:
	if state != "running":
		return
	while _tcp.is_connection_available():
		var stream := _tcp.take_connection()
		if _pending.size() + _peers.size() + _closing.size() >= MAX_CONNECTIONS:
			stream.disconnect_from_host()
			continue
		var ws := WebSocketPeer.new()
		ws.inbound_buffer_size = MAX_MESSAGE_BYTES
		ws.outbound_buffer_size = MAX_MESSAGE_BYTES
		ws.max_queued_packets = 128
		if "heartbeat_interval" in ws:
			ws.set("heartbeat_interval", 10.0)
		if ws.accept_stream(stream) == OK:
			ws.set_no_delay(true)
			_pending.append({"ws": ws, "since": Time.get_ticks_msec()})

	for i in range(_pending.size() - 1, -1, -1):
		var p: Dictionary = _pending[i]
		var ws: WebSocketPeer = p.ws
		ws.poll()
		match ws.get_ready_state():
			WebSocketPeer.STATE_OPEN:
				_pending.remove_at(i)
				var id := _next_peer
				_next_peer += 1
				_peers[id] = {"ws": ws, "kind": "", "since": Time.get_ticks_msec(), "window": Time.get_ticks_msec(), "messages": 0}
			WebSocketPeer.STATE_CLOSED:
				_pending.remove_at(i)
			_:
				if Time.get_ticks_msec() - int(p.since) > HANDSHAKE_TIMEOUT_MS:
					ws.close()
					_pending.remove_at(i)

	for i in range(_closing.size() - 1, -1, -1):
		var closing: Dictionary = _closing[i]
		(closing.ws as WebSocketPeer).poll()
		if closing.ws.get_ready_state() == WebSocketPeer.STATE_CLOSED or Time.get_ticks_msec() - int(closing.since) > 2000:
			_closing.remove_at(i)

	for id in _peers.keys():
		if not _peers.has(id):
			continue
		var ws: WebSocketPeer = _peers[id].ws
		var peer: Dictionary = _peers[id]
		ws.poll()
		if ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_disconnect(id)
			continue
		if peer.kind == "" and Time.get_ticks_msec() - int(peer.since) > IDENTIFY_TIMEOUT_MS:
			_close_peer(id, 1008, "Join a lobby or debug room within 10 seconds.")
			continue
		var n := 0
		while ws.get_available_packet_count() > 0 and n < MAX_PACKETS_PER_PEER and _peers.has(id):
			n += 1
			var packet := ws.get_packet()
			if Time.get_ticks_msec() - int(peer.window) >= 1000:
				peer.window = Time.get_ticks_msec()
				peer.messages = 0
			peer.messages += 1
			if int(peer.messages) > MAX_MESSAGES_PER_SECOND or packet.size() > MAX_MESSAGE_BYTES:
				_close_peer(id, 1008, "Too much input; reconnect and try again.")
				break
			if not ws.was_string_packet():
				_close_peer(id, 1003, "Use JSON text messages.")
				break
			var data: Variant = JSON.parse_string(packet.get_string_from_utf8())
			if typeof(data) != TYPE_DICTIONARY or typeof(data.get("type")) != TYPE_STRING:
				_send(id, _rejection("invalid_message", "Message must be valid JSON with a type."))
				continue
			_handle(id, data)


func _send(id: int, msg: Dictionary) -> void:
	var peer: Variant = _peers.get(id)
	if peer != null and (peer.ws as WebSocketPeer).get_ready_state() == WebSocketPeer.STATE_OPEN:
		peer.ws.send_text(JSON.stringify(msg))


func _close_peer(id: int, code: int, reason: String) -> void:
	var peer: Variant = _peers.get(id)
	if peer == null:
		return
	_disconnect(id)
	(peer.ws as WebSocketPeer).close(code, reason)
	_closing.append({"ws": peer.ws, "since": Time.get_ticks_msec()})


func _rejection(code: String, text: String) -> Dictionary:
	return {"type": "join_rejected", "code": code, "message": text}


func _handle(id: int, msg: Dictionary) -> void:
	var peer: Dictionary = _peers[id]
	var type: String = msg.type
	if type.begins_with("debug_"):
		if peer.kind == "controller":
			_send(id, _rejection("invalid_message", "A game or controller connection can't join a debug room."))
		else:
			_handle_debug(id, peer, msg)
		return
	if peer.kind == "debug" and type in ["hello", "join_game", "motion", "environment"]:
		_send(id, _rejection("invalid_message", "Debug connections can't join or drive a game."))
		return
	match type:
		"hello":
			_send(id, _rejection("invalid_message", "This server is hosted by the game; it doesn't take another game."))
		"join_game":
			var role: Variant = msg.get("requestedRole")
			if not _valid_version(msg) or typeof(msg.get("pairingCode")) != TYPE_STRING \
					or (role != null and not (role in ["movement", "aim"])):
				_send(id, _rejection("invalid_message", "Invalid join request."))
				return
			_join_game(id, str(msg.pairingCode), role, msg.get("name"))
		"select_slot":
			_select_slot(id, msg.get("teamId"), msg.get("role"))
		"set_ready":
			_set_ready(id, msg.get("ready"))
		"motion", "environment":
			_forward_input(id, msg)
		"start_game", "match_status", "end_game", "reset_lobby", "swap_roles":
			_send(id, _rejection("invalid_message", "Only the game host can do that."))
		_:
			_send(id, _rejection("invalid_message", "Unknown message type."))


func _disconnect(id: int) -> void:
	var peer: Dictionary = _peers[id]
	_peers.erase(id)
	_leave_debug(id, peer)
	if peer.kind != "controller" or _session == null or not _session.controllers.has(id):
		return
	var c: Dictionary = _session.controllers[id]
	_session.controllers.erase(id)
	if c.teamId != null and c.role != null:
		_broadcast({"type": "controller_disconnected", "controllerId": c.controllerId, "teamId": c.teamId, "role": c.role})
	_send_lobby_state()


# --- Lobby ---

## A host's player count (1-4), or 0 if the value isn't one.
func _player_count(value: Variant) -> int:
	if typeof(value) not in [TYPE_INT, TYPE_FLOAT] or float(value) != floorf(float(value)):
		return 0
	return int(value) if int(value) >= 1 and int(value) <= SLOTS.size() else 0


func _register_game(count := 0) -> void:
	_close_lobby()   # a second hello replaces the lobby
	var code := ""
	for i in CODE_LENGTH:
		code += CODE_ALPHABET[_rng.randi_range(0, CODE_ALPHABET.length() - 1)]
	_session = {
		"gameId": "game_%s" % _token(),
		"pairingCode": code,
		"state": "waiting",
		"minPlayers": count if count > 0 else min_players,   # ready phones it takes to start
		"controllers": {},   # peer id -> controller, in join order
	}
	_to_host({"type": "game_registered", "protocolVersion": PROTOCOL_VERSION,
		"gameId": _session.gameId, "pairingCode": code, "state": "waiting"})
	_send_lobby_state()


func _token() -> String:
	return "%08x%08x" % [_rng.randi(), _rng.randi()]


func _slotted() -> Array:
	return _session.controllers.values().filter(func(c): return c.teamId != null and c.role != null)


func _slot_holder(team: int, role: String) -> Variant:
	for c in _session.controllers.values():
		if c.teamId == team and c.role == role:
			return c
	return null


func _is_ready() -> bool:
	var in_slots := _slotted()
	if in_slots.is_empty() or not in_slots.all(func(c): return c.ready):
		return false
	var need: int = _session.minPlayers
	if need < SLOTS.size():
		return in_slots.size() >= need
	return SLOTS.all(func(s): return _slot_holder(s.teamId, s.role) != null)


func _send_lobby_state() -> void:
	if _session == null:
		return
	if _session.state == "waiting" or _session.state == "ready":
		_session.state = "ready" if _is_ready() else "waiting"
	var assignments := []
	var players := []
	for c in _session.controllers.values():
		if c.teamId != null and c.role != null:
			assignments.append({"controllerId": c.controllerId, "teamId": c.teamId, "role": c.role, "connected": true})
		players.append({"controllerId": c.controllerId, "name": c.name, "teamId": c.teamId,
			"role": c.role, "ready": c.ready, "connected": true})
	_broadcast({"type": "lobby_state", "state": _session.state, "assignments": assignments,
		"players": players, "minPlayers": _session.minPlayers})


func _broadcast(msg: Dictionary) -> void:
	_to_host(msg)
	_to_phones(msg)


func _to_phones(msg: Dictionary) -> void:
	if _session == null:
		return
	for id in _session.controllers:
		_send(id, msg)


func _clean_name(raw: Variant, fallback: String) -> String:
	if typeof(raw) != TYPE_STRING:
		return fallback
	var text := ""
	for ch in (raw as String):
		if ch.unicode_at(0) >= 32:
			text += ch
	text = text.strip_edges().left(MAX_NAME)
	return text if not text.is_empty() else fallback


func _join_game(id: int, code: String, requested_role: Variant, raw_name: Variant) -> void:
	var peer: Dictionary = _peers[id]
	if peer.kind == "controller":
		_send(id, _rejection("invalid_message", "This connection is already in a lobby."))
		return
	if _session == null or not _host_inbox.is_valid() or code.strip_edges().to_upper() != _session.pairingCode:
		_send(id, _rejection("invalid_pairing_code", "That code doesn't match an open lobby. Check the code on the game screen."))
		return
	if _session.state == "playing" or _session.state == "ended":
		_send(id, _rejection("game_unavailable", "This match has already started."))
		return
	if _session.controllers.size() >= MAX_PLAYERS:
		_send(id, _rejection("slot_occupied", "This lobby is full."))
		return

	var slot: Variant = null
	if requested_role != null:
		# Older clients: take the first free slot for that role, ready straight away.
		for s in SLOTS:
			if s.role == requested_role and _slot_holder(s.teamId, s.role) == null:
				slot = s
				break
		if slot == null:
			_send(id, _rejection("slot_occupied", "The %s controller slots are occupied." % requested_role))
			return

	var c := {
		"controllerId": "controller_%s" % _token(),
		"name": _clean_name(raw_name, "Player %d" % (_session.controllers.size() + 1)),
		"teamId": slot.teamId if slot != null else null,
		"role": slot.role if slot != null else null,
		"ready": slot != null,
	}
	_session.controllers[id] = c
	peer.kind = "controller"
	_send(id, {"type": "lobby_joined", "controllerId": c.controllerId, "pairingCode": _session.pairingCode})
	if slot != null:
		_send_assigned(id, c)
	_send_lobby_state()


func _send_assigned(id: int, c: Dictionary) -> void:
	_send(id, {"type": "controller_assigned", "assignment": {
		"controllerId": c.controllerId, "teamId": c.teamId, "role": c.role, "connected": true}})


func _controller(id: int) -> Variant:
	if _session == null or _peers[id].kind != "controller":
		return null
	return _session.controllers.get(id)


func _select_slot(id: int, team_v: Variant, role: Variant) -> void:
	var c: Variant = _controller(id)
	if c == null:
		_send(id, _rejection("invalid_message", "Join a lobby before picking a team."))
		return
	if _session.state != "waiting" and _session.state != "ready":
		_send(id, _rejection("game_unavailable", "Teams are locked while a match is on."))
		return
	var team := int(team_v) if typeof(team_v) in [TYPE_INT, TYPE_FLOAT] and float(team_v) == floorf(float(team_v)) else 0
	if (team != 1 and team != 2) or not (role in ["movement", "aim"]):
		_send(id, _rejection("invalid_message", "Pick team 1 or 2 and role movement or aim."))
		return
	var holder: Variant = _slot_holder(team, role)
	if holder != null and holder != c:
		_send(id, _rejection("slot_occupied", "%s already has that spot." % holder.name))
		return
	c.teamId = team
	c.role = role
	c.ready = false
	_send_assigned(id, c)
	_send_lobby_state()


func _set_ready(id: int, ready: Variant) -> void:
	var c: Variant = _controller(id)
	if c == null:
		_send(id, _rejection("invalid_message", "Join a lobby first."))
		return
	if _session.state != "waiting" and _session.state != "ready":
		return
	if typeof(ready) != TYPE_BOOL:
		_send(id, _rejection("invalid_message", "Ready must be true or false."))
		return
	if ready == true and (c.teamId == null or c.role == null):
		_send(id, _rejection("invalid_message", "Pick a team and role before you ready up."))
		return
	c.ready = ready == true
	_send_lobby_state()


func _forward_input(id: int, msg: Dictionary) -> void:
	var c: Variant = _controller(id)
	if c == null or c.teamId == null:
		_send(id, _rejection("invalid_message", "Only a controller with a team and role can send input."))
		return
	if _session.state != "playing":
		_send(id, {"type": "broadcast", "error": "Input is ignored until the match is playing."})
		return
	if not _valid_input(msg, c.role):
		_send(id, _rejection("invalid_message", "Invalid input for this controller role."))
		return
	var out := msg.duplicate()
	out.sender = c.controllerId
	_to_host(out)


func _forward_feedback(msg: Dictionary) -> void:
	var feedback: Variant = msg.get("message")
	if _session == null or typeof(msg.get("controllerId")) != TYPE_STRING or typeof(feedback) != TYPE_DICTIONARY:
		return
	if not (feedback.get("t") in ["state", "buzz"]) or JSON.stringify(feedback).length() > 4096:
		_to_host(_rejection("invalid_message", "Invalid controller feedback."))
		return
	for id in _session.controllers:
		if _session.controllers[id].controllerId == msg.controllerId:
			_send(id, {"type": "controller_feedback", "message": feedback})
			return


## Swap on death: the team's movement and aim phones trade roles mid-match. Each phone gets its
## new assignment (its screen switches), the host gets the new lobby state (input re-routes),
## then roles_swapped. Ignored unless playing with both of the team's phones in.
func _swap_roles(team_v: Variant) -> void:
	if _session == null or _session.state != "playing" or not (typeof(team_v) in [TYPE_INT, TYPE_FLOAT]):
		return
	var team := int(team_v)
	var runner: Variant = _slot_holder(team, "movement")
	var gunner: Variant = _slot_holder(team, "aim")
	if runner == null or gunner == null:
		return
	runner.role = "aim"
	gunner.role = "movement"
	for id in _session.controllers:
		var c: Dictionary = _session.controllers[id]
		if c == runner or c == gunner:
			_send_assigned(id, c)
	_send_lobby_state()
	_to_host({"type": "roles_swapped", "teamId": team})


func _start_game() -> void:
	if _session == null:
		return
	if not (_session.state in ["waiting", "ready"]):
		_to_host(_rejection("game_unavailable", "This match has already started."))
		return
	if not _is_ready():
		_to_host(_rejection("game_unavailable",
			"At least %d controller(s) must pick a spot and ready up first." % _session.minPlayers if _session.minPlayers < SLOTS.size()
			else "All four spots must be taken and ready first."))
		return
	_session.state = "playing"
	_broadcast({"type": "broadcast", "state": "playing"})
	_send_lobby_state()


func _relay_match_status(msg: Dictionary) -> void:
	if _session == null or _session.state != "playing":
		return
	var scores: Variant = msg.get("scores")
	if typeof(scores) != TYPE_ARRAY or scores.size() != 2 or not (typeof(msg.get("timeLeft")) in [TYPE_INT, TYPE_FLOAT]):
		_to_host(_rejection("invalid_message", "Invalid match_status."))
		return
	_to_phones({"type": "match_status", "scores": [_num(scores[0]), _num(scores[1])],
		"timeLeft": maxf(0.0, float(msg.timeLeft)), "killTarget": _num(msg.get("killTarget"))})


func _num(v: Variant) -> int:
	return int(v) if _finite(v) else 0


func _finite(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value))


func _valid_version(msg: Dictionary) -> bool:
	var version: Variant = msg.get("protocolVersion")
	return _finite(version) and float(version) == float(PROTOCOL_VERSION)


func _vector(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	for axis in ["x", "y", "z"]:
		if not _finite(value.get(axis)) or absf(float(value[axis])) > 1000000.0:
			return false
	return true


func _rotation(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	for axis in ["alpha", "beta", "gamma"]:
		if not _finite(value.get(axis)) or absf(float(value[axis])) > 1000000.0:
			return false
	return true


func _valid_debug_reading(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY or not _rotation(value.get("rotation")) or not _vector(value.get("accelerationIncludingGravity")):
		return false
	return (value.get("rotationRate") == null or _rotation(value.rotationRate)) \
		and (value.get("acceleration") == null or _vector(value.acceleration))


## Never pass untrusted nonfinite values, malformed payloads or another role's actions
## into physics. The sender is still always taken from this socket's assignment.
func _valid_input(msg: Dictionary, role: String) -> bool:
	var payload: Variant = msg.get("payload")
	if typeof(payload) != TYPE_DICTIONARY or not _finite(msg.get("timestamp")) or float(msg.timestamp) < 0.0:
		return false
	if msg.type == "environment":
		var action: Variant = payload.get("action")
		var allowed: Array = MOVEMENT_ACTIONS if role == "movement" else AIM_ACTIONS
		if not (action in SHARED_ACTIONS or action in allowed) or typeof(payload.get("pressed")) != TYPE_BOOL:
			return false
		if action == "weapon":
			return _finite(payload.get("slot")) and float(payload.slot) == floorf(float(payload.slot)) and int(payload.slot) in [0, 1, 2]
		return true
	if payload.has("controls"):
		var controls: Variant = payload.controls
		if typeof(controls) != TYPE_DICTIONARY:
			return false
		for key in ["moveX", "moveY", "lookX", "lookY"]:
			if not _finite(controls.get(key)) or absf(float(controls[key])) > 1.0:
				return false
		# Optional gunner turn since the last message, in degrees.
		for key in ["lookDX", "lookDY"]:
			if controls.has(key) and (not _finite(controls.get(key)) or absf(float(controls[key])) > 180.0):
				return false
		return true
	return _vector(payload.get("accelerometer")) and _vector(payload.get("gyroscope"))


func _end_game(msg: Dictionary) -> void:
	if _session == null or _session.state != "playing":
		_to_host(_rejection("game_unavailable", "There's no match to end."))
		return
	_session.state = "ended"
	var winner: Variant = msg.get("winningTeam")
	var scores: Variant = msg.get("scores")
	var stats: Variant = msg.get("stats")
	var result := {
		"type": "match_ended",
		"winningTeam": int(winner) if typeof(winner) in [TYPE_INT, TYPE_FLOAT] and int(winner) in [1, 2] else null,
		"scores": [_num(scores[0]), _num(scores[1])] if typeof(scores) == TYPE_ARRAY and scores.size() == 2 else [0, 0],
		"stats": (stats as Array).slice(0, 2) if typeof(stats) == TYPE_ARRAY else [],
	}
	if msg.get("reason") in ["kills", "time", "host"]:
		result["reason"] = msg.reason
	_to_phones(result)
	_send_lobby_state()


func _reset_lobby() -> void:
	if _session == null:
		return
	if _session.state == "playing":
		_to_host(_rejection("game_unavailable", "End the match before reopening the lobby."))
		return
	_session.state = "waiting"
	for c in _session.controllers.values():
		c.ready = false
	_send_lobby_state()


# --- Debug relay (phone → web debugger) ---

func _handle_debug(id: int, peer: Dictionary, msg: Dictionary) -> void:
	if msg.type == "debug_join":
		var room: Variant = msg.get("room")
		var role: Variant = msg.get("role")
		if not _valid_version(msg) or typeof(room) != TYPE_STRING \
				or _debug_room_re.search(room) == null or not (role in ["phone", "viewer"]):
			_send(id, _rejection("invalid_message", "Invalid debug_join: room must be 1-32 letters, digits, _ or -, role phone or viewer."))
			return
		_leave_debug(id, peer)
		var members: Dictionary = _debug_rooms.get(room, {"phones": {}, "viewers": {}})
		_debug_rooms[room] = members
		members["phones" if role == "phone" else "viewers"][id] = true
		peer.kind = "debug"
		peer.room = room
		peer.debug_role = role
		_send(id, {"type": "debug_joined", "room": room, "role": role, "addresses": lan_urls()})
		_send_debug_status(room)
		return

	if peer.kind != "debug" or not _debug_rooms.has(peer.room):
		_send(id, _rejection("invalid_message", "Join a debug room before sending debug messages."))
		return
	var members: Dictionary = _debug_rooms[peer.room]
	if msg.type == "debug_motion":
		var readings: Variant = msg.get("readings")
		if peer.debug_role != "phone" or typeof(msg.get("platform")) != TYPE_STRING \
				or typeof(readings) != TYPE_ARRAY or readings.size() > MAX_DEBUG_READINGS:
			_send(id, _rejection("invalid_message", "Invalid debug_motion: only phones send it, with up to 50 readings."))
			return
		for reading in readings:
			if not _valid_debug_reading(reading):
				_send(id, _rejection("invalid_message", "Debug readings must contain finite sensor values."))
				return
		var relay := {"type": "debug_motion", "platform": msg.platform, "readings": readings}
		for viewer in members.viewers:
			_send(viewer, relay)
		return
	if msg.type != "debug_event" or not (msg.get("event") in ["recalibrate", "reset_counts"]):
		_send(id, _rejection("invalid_message", "Unknown debug event."))
		return
	for other in members.phones.keys() + members.viewers.keys():
		if other != id:
			_send(other, {"type": "debug_event", "event": msg.event})


func _leave_debug(id: int, peer: Dictionary) -> void:
	if peer.get("kind") != "debug" or not _debug_rooms.has(peer.get("room", "")):
		return
	var room: String = peer.room
	var members: Dictionary = _debug_rooms[room]
	members.phones.erase(id)
	members.viewers.erase(id)
	if members.phones.is_empty() and members.viewers.is_empty():
		_debug_rooms.erase(room)
	else:
		_send_debug_status(room)


func _send_debug_status(room: String) -> void:
	var members: Dictionary = _debug_rooms.get(room, {})
	if members.is_empty():
		return
	var status := {"type": "debug_status", "room": room, "phones": members.phones.size(), "viewers": members.viewers.size()}
	for id in members.phones.keys() + members.viewers.keys():
		_send(id, status)


# --- Helpers ---

func _set_status(new_state: String, new_message: String) -> void:
	state = new_state
	message = new_message
	if new_state == "failed":
		push_warning("LobbyServer: " + new_message)
	status_changed.emit(state, message)


func _port_open() -> bool:
	var tcp := StreamPeerTCP.new()
	if tcp.connect_to_host("127.0.0.1", port) != OK:
		return false
	for i in 20:
		tcp.poll()
		match tcp.get_status():
			StreamPeerTCP.STATUS_CONNECTED:
				tcp.disconnect_from_host()
				return true
			StreamPeerTCP.STATUS_ERROR, StreamPeerTCP.STATUS_NONE:
				return false
		await get_tree().create_timer(0.025).timeout
	tcp.disconnect_from_host()
	return false
