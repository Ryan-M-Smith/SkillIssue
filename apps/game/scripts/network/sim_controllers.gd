## Four fake phones, no server needed. Add this node to any scene (e.g. under Main in
## duo_sandbox.tscn) and run: it registers a fake game, assigns all four controller slots,
## starts the match, then drives every Duo with a test pattern through the real
## NetworkClient → GameSession → InputRouter → PhoneDuoController path.
## Movers walk in circles and jump, gunners sweep left/right and shoot.
## Delete the node (or untick `enabled`) before playing with real phones.
extends Node

@export var enabled := true
@export var motion_hz := 30.0
@export var jump_every := 3.0
@export var shoot_every := 2.0

const IDS := ["sim_t1_movement", "sim_t1_aim", "sim_t2_movement", "sim_t2_aim"]

var _t := 0.0
var _send_timer := 0.0
var _jump_timer := 0.0
var _shoot_timer := 0.0


func _ready() -> void:
	if not enabled:
		return
	# Same flat messages apps/server sends the game.
	NetworkClient.inject_event({"type": "game_registered", "protocolVersion": 1,
		"gameId": "sim_game", "pairingCode": "000000", "state": "waiting"})
	var assignments := []
	for i in IDS.size():
		assignments.append({"controllerId": IDS[i], "teamId": 1 + i / 2,
			"role": "movement" if i % 2 == 0 else "aim", "connected": true})
	NetworkClient.inject_event({"type": "lobby_state", "state": "ready", "assignments": assignments})
	NetworkClient.inject_event({"type": "broadcast", "state": "playing"})


func _physics_process(delta: float) -> void:
	if not enabled:
		return
	_t += delta
	_send_timer -= delta
	if _send_timer <= 0.0:
		_send_timer = 1.0 / motion_hz
		for team in 2:
			var phase := _t * 0.8 + team * PI
			_inject("motion", IDS[team * 2], {
				"controls": {"moveX": sin(phase) * 0.6, "moveY": 0.8},
				"trackingStatus": "unavailable",
			})
			_inject("motion", IDS[team * 2 + 1], {
				"controls": {"lookX": sin(_t * 0.7 + team) * 0.4, "lookY": 0.0},
				"trackingStatus": "unavailable",
			})
	_jump_timer -= delta
	if _jump_timer <= 0.0:
		_jump_timer = jump_every
		for team in 2:
			_inject("environment", IDS[team * 2], {"action": "jump", "pressed": true})
	_shoot_timer -= delta
	if _shoot_timer <= 0.0:
		_shoot_timer = shoot_every
		for team in 2:
			_inject("environment", IDS[team * 2 + 1], {"action": "shoot", "pressed": true})
			_release_shot.call_deferred(IDS[team * 2 + 1])


func _release_shot(id: String) -> void:
	await get_tree().create_timer(0.1).timeout
	_inject("environment", id, {"action": "shoot", "pressed": false})


func _inject(type: String, sender: String, payload: Dictionary) -> void:
	NetworkClient.inject_event({
		"type": type,
		"sender": sender,
		"timestamp": Time.get_unix_time_from_system() * 1000.0,
		"payload": payload,
	})
