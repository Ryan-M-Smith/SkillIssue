## Headless host fixture used by apps/server/network.integration.test.ts.
## The test exercises real WebSocket phones against the production embedded server.
extends SceneTree

var server: Node
var _started := false
var _ended := false


func _initialize() -> void:
	call_deferred("_start")


func _start() -> void:
	_test_input_router()
	server = root.get_node("LobbyServer")
	server.stop()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--test-port="):
			server.port = arg.get_slice("=", 1).to_int()
	server.min_players = 4
	await server.ensure_running()
	if not server.is_local():
		push_error("Network fixture could not start its embedded server.")
		quit(1)
		return
	server.attach_host(_on_host)
	server.host_message({"type": "hello", "protocolVersion": 1, "clientType": "game"})
	create_timer(30.0).timeout.connect(func(): quit(0))


func _test_input_router() -> void:
	var link := root.get_node("NetworkClient")
	var session := root.get_node("GameSession")
	var router := root.get_node("InputRouter")
	var controller := PhoneDuoController.new(0)
	root.add_child(controller)
	var resets := [0]
	var on_reset := func(_team, _role): resets[0] += 1
	router.phone_left.connect(on_reset)
	link.inject_event({"type": "lobby_state", "state": "playing", "assignments": [
		{"controllerId": "fixture_mover", "teamId": 1, "role": "movement"},
		{"controllerId": "fixture_gunner", "teamId": 1, "role": "aim"},
	], "players": []})
	var now := Time.get_unix_time_from_system() * 1000.0
	for id in ["fixture_mover", "fixture_gunner"]:
		link.inject_event({"type": "motion", "sender": id, "timestamp": now,
			"payload": {"controls": {"moveX": 0.5, "moveY": 0.5, "lookX": 0.2, "lookY": 0.1}}})
	for action in ["sprint", "crouch"]:
		link.inject_event({"type": "environment", "sender": "fixture_mover", "timestamp": now,
			"payload": {"action": action, "pressed": true}})
	for action in ["shoot", "reload"]:
		link.inject_event({"type": "environment", "sender": "fixture_gunner", "timestamp": now,
			"payload": {"action": action, "pressed": true}})
	router._physics_process(0.016)
	var input := DuoInput.new()
	controller.poll(input, 0.016)
	assert(input.fire and input.sprint and input.crouch and input.reload and input.move.length() > 0.0,
		"Router must deliver motion, held buttons and reload.")
	var last_input: Dictionary = router.get("_last_input_msec")
	last_input["fixture_mover"] = Time.get_ticks_msec() - 300
	last_input["fixture_gunner"] = Time.get_ticks_msec() - 300
	router._physics_process(0.016)
	input.reset()
	controller.poll(input, 0.016)
	assert(not input.fire and not input.sprint and not input.crouch and input.move == Vector2.ZERO,
		"Stale input must release all held controls.")
	assert(resets[0] == 2, "Each stale role should reset once.")
	router._physics_process(0.016)
	assert(resets[0] == 2, "Stale roles must not emit repeated reset signals.")
	link.inject_event({"type": "motion", "sender": "fixture_gunner", "timestamp": now + 1.0,
		"payload": {"controls": {"moveX": 0.0, "moveY": 0.0, "lookX": 0.0, "lookY": 0.0}}})
	link.inject_event({"type": "environment", "sender": "fixture_gunner", "timestamp": now + 1.0,
		"payload": {"action": "shoot", "pressed": true}})
	link.inject_event({"type": "broadcast", "state": "ended"})
	input.reset()
	controller.poll(input, 0.016)
	assert(not input.fire and resets[0] == 3, "Ending a match must release held input immediately.")
	router.phone_left.disconnect(on_reset)
	session._on_connection_changed(false)
	controller.free()
	print("INPUT_ROUTER_TESTS passed")


func _on_host(message: Dictionary) -> void:
	match message.type:
		"game_registered":
			print("NETWORK_FIXTURE ", JSON.stringify({"code": message.pairingCode}))
		"lobby_state":
			if message.state == "ready" and not _started:
				_started = true
				server.host_message({"type": "start_game"})
		"motion":
			server.host_message({"type": "to_controller", "controllerId": message.sender,
				"message": {"t": "state", "hp": 75, "ammo": 8, "magazine_size": 12, "testSender": message.sender}})
		"environment":
			if message.payload.action == "reload" and not _ended:
				_ended = true
				server.host_message({"type": "end_game", "winningTeam": 1, "scores": [10, 4], "stats": []})
				server.call_deferred("host_message", {"type": "reset_lobby"})
