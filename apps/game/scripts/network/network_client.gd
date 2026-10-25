## Autoload `NetworkClient`: the game's link to the lobby server. Transport only:
## connect / reconnect, JSON decode, envelope validation, stats. Two transports:
## - local: the server runs inside this game (LobbyServer); messages are passed in-process.
## - WebSocket: a server elsewhere (e.g. apps/server run by hand), by URL. It does not know about
## teams, roles or Duos. GameSession and InputRouter listen to `game_event_received`.
## Protocol contract: docs/network-protocol.md and packages/protocol/events.ts (repo root).
extends Node

signal connection_changed(connected: bool)
signal game_event_received(event: Dictionary)
signal network_error(message: String)

const protocolVersion := 1
const DEFAULT_URL := "ws://127.0.0.1:8080"
const URL_SETTING := "network/server_url"   ## optional Project Settings override
const URL_ARG := "--server="                ## optional command-line override: -- --server=ws://...

## Every type the server may send. Anything else is counted and dropped.
const KNOWN_TYPES: PackedStringArray = [
	"game_registered", "lobby_state", "controller_assigned", "controller_disconnected",
	"join_rejected", "broadcast", "role", "motion", "environment", "player_auth",
]

## Off: the game connects when a lobby is created (GameSession.create_lobby).
@export var auto_connect := false
@export var reconnect_delay := 2.0         ## seconds between reconnect attempts
@export var max_reconnect_delay := 15.0    ## backoff cap
@export var log_stats_every := 0.0         ## seconds; 0 = never print stats

var url := ""
var _ws := WebSocketPeer.new()
var _local := false                        ## talking to LobbyServer in-process
var _local_inbox: Array = []               ## server → game messages, handled next frame
var _connected := false
var _want_connection := false
var _retry_in := 0.0
var _retry_delay := 0.0
var _warned_types := {}
var _stats_timer := 0.0

## Read with get_stats(). Counts reset with reset_stats().
var _stats := {
	"packets": 0, "by_type": {}, "rejected": 0, "unknown": 0,
	"last_poll_usec": 0, "max_poll_usec": 0,
}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # keep the link alive while the game is paused
	_retry_delay = reconnect_delay
	if auto_connect:
		connect_to_server(_configured_url())


func connect_to_server(new_url: String) -> void:
	disconnect_from_server()
	url = new_url
	_want_connection = true
	_open()


## Host the lobby on the server running inside this game (LobbyServer).
func connect_local() -> void:
	disconnect_from_server()
	url = LobbyServer.server_url()
	_local = true
	LobbyServer.attach_host(_receive_local)
	_set_connected(true)
	send_message("hello", {"clientType": "game"})


func is_local() -> bool:
	return _local


## Intentional disconnect: no automatic reconnect afterwards.
func disconnect_from_server() -> void:
	if _local:
		_local = false
		_local_inbox.clear()
		LobbyServer.host_left()
	_want_connection = false
	if _ws.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_ws.close(1000, "client closing")
	_set_connected(false)


func is_connected_to_server() -> bool:
	return _connected


## Sends one message. Control messages are flat ({type, protocolVersion, ...fields}),
## matching packages/protocol/events.ts. Returns false if not connected.
func send_message(type: String, fields: Dictionary = {}) -> bool:
	if not _connected:
		return false
	var msg := {"type": type, "protocolVersion": protocolVersion}
	msg.merge(fields)
	if _local:
		LobbyServer.host_message(msg)
		return true
	return _ws.send_text(JSON.stringify(msg)) == OK


## Feeds an event through the same validation and signal path as a real packet.
## For tests and simulated controllers (see scripts/network/sim_controllers.gd).
func inject_event(event: Variant) -> void:
	_handle_value(event)


func get_stats() -> Dictionary:
	return _stats.duplicate(true)


func reset_stats() -> void:
	_stats.packets = 0
	_stats.by_type = {}
	_stats.rejected = 0
	_stats.unknown = 0
	_stats.max_poll_usec = 0


func _process(delta: float) -> void:
	var start := Time.get_ticks_usec()
	if _local:
		var batch := _local_inbox
		_local_inbox = []
		for value in batch:
			_stats.packets += 1
			_handle_value(value)
		_stats.last_poll_usec = Time.get_ticks_usec() - start
		_stats.max_poll_usec = maxi(_stats.max_poll_usec, _stats.last_poll_usec)
		return
	_ws.poll()
	var state := _ws.get_ready_state()
	match state:
		WebSocketPeer.STATE_OPEN:
			if not _connected:
				_set_connected(true)
				_retry_delay = reconnect_delay
				send_message("hello", {"clientType": "game"})
			while _ws.get_available_packet_count() > 0:
				_handle_packet(_ws.get_packet())
		WebSocketPeer.STATE_CLOSED:
			if _connected:
				network_error.emit("connection closed (%d %s)" % [_ws.get_close_code(), _ws.get_close_reason()])
				_set_connected(false)
			if _want_connection:
				_retry_in -= delta
				if _retry_in <= 0.0:
					_open()
	_stats.last_poll_usec = Time.get_ticks_usec() - start
	_stats.max_poll_usec = maxi(_stats.max_poll_usec, _stats.last_poll_usec)

	if log_stats_every > 0.0:
		_stats_timer -= delta
		if _stats_timer <= 0.0:
			_stats_timer = log_stats_every
			print("[NetworkClient] ", _stats)


func _open() -> void:
	_ws = WebSocketPeer.new()
	var err := _ws.connect_to_url(url)
	# Whether connect_to_url failed or the attempt later closes, try again with backoff.
	_retry_in = _retry_delay
	_retry_delay = minf(_retry_delay * 2.0, max_reconnect_delay)
	if err != OK:
		network_error.emit("could not start connection to %s (error %d)" % [url, err])


func _receive_local(value: Variant) -> void:
	_local_inbox.append(value)


func _set_connected(on: bool) -> void:
	if on == _connected:
		return
	_connected = on
	connection_changed.emit(on)


func _handle_packet(bytes: PackedByteArray) -> void:
	_stats.packets += 1
	var text := bytes.get_string_from_utf8()
	var json := JSON.new()
	if json.parse(text) != OK:
		_reject("malformed JSON")
		return
	_handle_value(json.data)


func _handle_value(value: Variant) -> void:
	var event := _validate(value)
	if event.is_empty():
		return
	var type: String = event.type
	if not KNOWN_TYPES.has(type):
		_stats.unknown += 1
		if not _warned_types.has(type):
			_warned_types[type] = true
			push_warning("NetworkClient: ignoring unknown event type '%s'" % type)
		return
	_stats.by_type[type] = int(_stats.by_type.get(type, 0)) + 1
	game_event_received.emit(event)


## Checks the message shape and returns a normalized copy, or {} if invalid.
## Server control messages are flat (lobby_state.assignments, broadcast.state, ...) while
## input keeps its fields in `payload`; flat fields are folded into payload so handlers
## only look in one place.
func _validate(value: Variant) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		_reject("message is not a JSON object")
		return {}
	var raw: Dictionary = value
	var type: Variant = raw.get("type")
	if typeof(type) != TYPE_STRING or (type as String).is_empty():
		_reject("missing or non-string 'type'")
		return {}
	var payload: Variant = raw.get("payload", {})
	if typeof(payload) != TYPE_DICTIONARY:
		_reject("'payload' is not an object (type %s)" % type)
		return {}
	var sender: Variant = raw.get("sender", "")
	if typeof(sender) != TYPE_STRING:
		_reject("'sender' is not a string (type %s)" % type)
		return {}
	var timestamp: Variant = raw.get("timestamp", 0)
	if typeof(timestamp) != TYPE_FLOAT and typeof(timestamp) != TYPE_INT:
		_reject("'timestamp' is not a number (type %s)" % type)
		return {}
	var merged: Dictionary = (payload as Dictionary).duplicate()
	for key in raw:
		if not (key in ["type", "sender", "timestamp", "payload"]) and not merged.has(key):
			merged[key] = raw[key]
	return {"type": type, "sender": sender, "timestamp": float(timestamp), "payload": merged}


func _reject(reason: String) -> void:
	_stats.rejected += 1
	network_error.emit("rejected message: " + reason)


## The server given with `-- --server=ws://...` or the Project Setting, or "" if none.
func configured_override() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(URL_ARG):
			return arg.substr(URL_ARG.length())
	if ProjectSettings.has_setting(URL_SETTING):
		return str(ProjectSettings.get_setting(URL_SETTING))
	return ""


func _configured_url() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(URL_ARG):
			return arg.substr(URL_ARG.length())
	if ProjectSettings.has_setting(URL_SETTING):
		return str(ProjectSettings.get_setting(URL_SETTING))
	return DEFAULT_URL
