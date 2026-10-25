## Run: godot --headless --path apps/game --script res://tests/lifecycle_smoke.gd
## Real WebSocket joins verify lobby countdown, host loss and a fresh playable match.
extends SceneTree

const LOBBY := "res://ui/lobby.tscn"
const ARENA := "res://modes/duo_sandbox.tscn"
const MENU := "res://ui/main_menu.tscn"
const RESULTS := "res://ui/results.tscn"

var _checks := 0
var _finished := false
var _phones: Array[WebSocketPeer] = []
var _match_ended: Array[Dictionary] = []


func _initialize() -> void:
	_run.call_deferred()


func _check(condition: bool, description: String) -> bool:
	if not condition:
		push_error("LIFECYCLE_SMOKE_FAIL: " + description)
		_finished = true
		quit(1)
		return false
	_checks += 1
	return true


func _poll_phones() -> void:
	for phone in _phones:
		phone.poll()
		while phone.get_available_packet_count() > 0:
			var message = JSON.parse_string(phone.get_packet().get_string_from_utf8())
			if message is Dictionary and message.get("type") == "match_ended":
				_match_ended.append(message)


func _wait_scene(path: String) -> bool:
	var until := Time.get_ticks_msec() + 10000
	while Time.get_ticks_msec() < until:
		await process_frame
		_poll_phones()
		if is_instance_valid(current_scene) and current_scene.scene_file_path == path:
			await process_frame
			return true
	return false


func _wait_code() -> String:
	var session := root.get_node("GameSession")
	var until := Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < until:
		await process_frame
		_poll_phones()
		if not session.pairing_code.is_empty():
			return session.pairing_code
	return ""


func _join_and_ready(code: String) -> bool:
	var server := root.get_node("LobbyServer")
	var phone := WebSocketPeer.new()
	_phones.append(phone)
	if phone.connect_to_url("ws://127.0.0.1:%d" % server.port) != OK:
		return false
	var until := Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < until and phone.get_ready_state() != WebSocketPeer.STATE_OPEN:
		await process_frame
		_poll_phones()
	if phone.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	phone.send_text(JSON.stringify({"type": "join_game", "protocolVersion": 1, "pairingCode": code, "name": "Recovery test"}))
	phone.send_text(JSON.stringify({"type": "select_slot", "teamId": 1, "role": "movement"}))
	phone.send_text(JSON.stringify({"type": "set_ready", "ready": true}))
	return true


func _run() -> void:
	create_timer(25.0).timeout.connect(func():
		if not _finished:
			push_error("LIFECYCLE_SMOKE_FAIL: timed out")
			quit(1))
	var server := root.get_node("LobbyServer")
	var link := root.get_node("NetworkClient")
	var session := root.get_node("GameSession")
	var stats := root.get_node("MatchStats")
	server.port = 20000 + randi() % 30000
	server.min_players = 1
	# Host locally (development mode): no control plane, and the host asks for 1 phone.
	ProjectSettings.set_setting("network/control_plane_url", "")
	session.players_needed = 1
	if not _check(change_scene_to_file(LOBBY) == OK and await _wait_scene(LOBBY), "lobby scene opens"):
		return
	var first_code := await _wait_code()
	if not _check(not first_code.is_empty() and server.is_local(), "embedded host registers a lobby"):
		return
	if not _check(await _join_and_ready(first_code), "real phone joins and readies"):
		return
	if not _check(await _wait_scene(ARENA), "ready countdown starts actual arena"):
		return
	var mode = current_scene.get_node("DuoSandbox")
	if not _check(mode._running and mode._network_match and session.is_playing(), "arena is tied to live network match"):
		return
	for duo in mode.duos:
		for controller in duo.controllers.get_children():
			if not _check(not controller is KeyboardDuoController, "live host cannot control either team by keyboard"):
				return
	var rogue := KeyboardDuoController.new()
	rogue._mouse_accum = Vector2(2, 3)
	var host_input := DuoInput.new()
	rogue.poll(host_input, 0.1)
	rogue.free()
	if not _check(host_input.move == Vector2.ZERO and host_input.aim_delta == Vector2.ZERO and not host_input.fire,
		"desktop gameplay controller ignores live host input defensively"):
		return
	if not _check(Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "live host retains clickable mouse cursor"):
		return
	# Simulate the transport losing its host session while gameplay is active.
	paused = true
	link.disconnect_from_server()
	if not _check(await _wait_scene(LOBBY), "lost host session returns to lobby"):
		return
	if not _check(not paused and Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "recovery unpauses and releases mouse"):
		return
	if not _check(not stats._running and stats._duos.is_empty() and stats.result.is_empty(), "abandoned match stats stop and release scene references"):
		return
	var next_code := await _wait_code()
	if not _check(not next_code.is_empty() and next_code != first_code, "recovery registers a fresh lobby"):
		return
	if not _check(await _join_and_ready(next_code), "phone can join new lobby and ready again"):
		return
	if not _check(await _wait_scene(ARENA), "recovered lobby countdown starts a fresh arena"):
		return
	mode = current_scene.get_node("DuoSandbox")
	if not _check(mode._running and mode.scores == [0, 0] and session.is_playing(), "recovered match starts with reset scores"):
		return
	mode.scores[0] = 4
	mode.scores[1] = 2
	mode.end_banner_seconds = 0.01
	var match_menu := current_scene.get_node("PauseMenu")
	match_menu.open_menu()
	match_menu._end_match()
	if not _check(await _wait_scene(RESULTS), "host end shows normal match results"):
		return
	if not _check(stats.result.winner == 0 and stats.result.scores == [4, 2] and stats.result.reason == "host", "host end awards leading team and retains final scores"):
		return
	_poll_phones()
	var deadline := Time.get_ticks_msec() + 1000
	while _match_ended.is_empty() and Time.get_ticks_msec() < deadline:
		await process_frame
		_poll_phones()
	if not _check(not _match_ended.is_empty(), "phones receive results before lobby closes"):
		return
	if not _check(int(_match_ended.back().winningTeam) == 1 and int(_match_ended.back().scores[0]) == 4 and int(_match_ended.back().scores[1]) == 2, "phone results contain the winning team and final scores"):
		return
	if not _check(_match_ended.back().get("reason") == "host", "phones know replay is unavailable after host ends early"):
		return
	if not _check(session.state == "ended" and link.is_connected_to_server(), "host end keeps lobby connected through results"):
		return
	current_scene._on_menu()
	if not _check(await _wait_scene(MENU) and not paused and not link.is_connected_to_server(), "results main menu closes lobby and releases cursor"):
		return
	# Direct keyboard practice must remain independent of lobby state changes.
	change_scene_to_file(ARENA)
	if not _check(await _wait_scene(ARENA), "keyboard practice opens without a lobby"):
		return
	mode = current_scene.get_node("DuoSandbox")
	session._set_state("ready")
	await process_frame
	if not _check(not mode._network_match and mode._running and current_scene.scene_file_path == ARENA,
		"network state changes do not interrupt keyboard practice"):
		return
	for phone in _phones:
		phone.close()
	print("LIFECYCLE_SMOKE_PASS ", _checks, " checks")
	_finished = true
	quit(0)
