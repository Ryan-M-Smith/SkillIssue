## Run: godot --headless --path apps/game --script res://tests/rules_smoke.gd
## The extra match rules: mystery boxes and every power-up effect, bounty
## expiry, and swap-on-death through the real embedded server with two WebSocket phones.
extends SceneTree

const ARENA := "res://modes/duo_sandbox.tscn"
const LOBBY := "res://ui/lobby.tscn"
## Loaded in _run, not named at the top: a --script test compiles before the autoloads exist,
## and these scripts reach GameEvents through Duo.
var PU: GDScript
var Effect: Dictionary

var _checks := 0
var _finished := false
var _phones: Array[WebSocketPeer] = []
var _assigned := {}   ## phone index -> latest role from controller_assigned


func _initialize() -> void:
	_run.call_deferred()


func _check(condition: bool, description: String) -> bool:
	if not condition:
		push_error("RULES_SMOKE_FAIL: " + description)
		_finished = true
		quit(1)
		return false
	_checks += 1
	return true


func _wait_scene(path: String) -> bool:
	var until := Time.get_ticks_msec() + 10000
	while Time.get_ticks_msec() < until:
		await process_frame
		_poll_phones()
		if is_instance_valid(current_scene) and current_scene.scene_file_path == path:
			await process_frame
			return true
	return false


func _physics(frames: int) -> void:
	for f in frames:
		await physics_frame


func _poll_phones() -> void:
	for i in _phones.size():
		_phones[i].poll()
		while _phones[i].get_available_packet_count() > 0:
			var message = JSON.parse_string(_phones[i].get_packet().get_string_from_utf8())
			if message is Dictionary and message.get("type") == "controller_assigned":
				_assigned[i] = message.assignment.role


## Puts a duo inside a pickup (or far away from everything).
func _move(duo: Node, at: Vector3) -> void:
	duo.global_position = at
	await _physics(3)


func _run() -> void:
	PU = load("res://components/powerup_component.gd")
	Effect = PU.Effect
	var mystery_script := load("res://entities/pickups/mystery_pickup.gd")
	create_timer(40.0).timeout.connect(func():
		if not _finished:
			push_error("RULES_SMOKE_FAIL: timed out")
			quit(1))
	if not _check(change_scene_to_file(ARENA) == OK and await _wait_scene(ARENA), "practice arena opens"):
		return
	await _physics(6)
	var mode = current_scene.get_node("DuoSandbox")
	mode.respawn_delay = 0.03
	for duo in mode.duos:
		duo.set_physics_process(false)
	var blue = mode.duos[0]
	var red = mode.duos[1]

	# --- mystery boxes are placed and settle onto the floor
	var boxes: Array = mode.arena_pickups.filter(func(p): return p.get_script() == mystery_script)
	if not _check(boxes.size() == 2 and boxes.size() == mode.arena_pickups.size(), "two mystery boxes on The Pit"):
		return
	if not _check(absf(boxes[0].global_position.y - 0.12) < 0.2, "mystery boxes rest on the floor"):
		return
	var away := Vector3(0, 30, 0)

	# --- mystery box gives a random effect
	boxes[0].rng.seed = 7
	await _move(blue, boxes[0].global_position + Vector3.UP * 0.5)
	if not _check(boxes[0].last_effect >= 0 and blue.powerups.has(boxes[0].last_effect) and not boxes[0].is_available(), "mystery box applies its effect and goes on cooldown"):
		return
	if not _check(mode._hud_halves[0].effects.text.contains(PU.display_name(boxes[0].last_effect)), "active effect shows on that team's HUD"):
		return
	blue.powerups.clear()
	await _move(blue, away)
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	var rolled := {}
	for i in 400:
		rolled[PU.roll(rng)] = true
	if not _check(rolled.size() == Effect.size(), "every effect can come out of a box"):
		return

	# --- a health pack (item_pickup.gd on The Pit) heals and flashes the green vignette
	var pack: Node3D = current_scene.find_child("HealthPickupObject", true, false)
	var blue_hud = current_scene.get_node("HUD/TeamHuds/TeamAHud")
	var red_hud = current_scene.get_node("HUD/TeamHuds/TeamBHud")
	if not _check(pack != null and blue_hud._heal == 0.0, "The Pit has health packs and no green flash yet"):
		return
	blue.health.apply_damage(50.0, null)
	await _move(blue, pack.global_position)
	if not _check(blue.health.hp == 70.0, "walking into a health pack heals 20"):
		return
	if not _check(blue_hud._heal > 0.5 and red_hud._heal == 0.0, "health pack flashes green on the picker's screen only"):
		return
	await create_timer(1.2).timeout
	if not _check(blue_hud._heal == 0.0, "green vignette fades out"):
		return
	await _move(blue, away)
	blue.health.reset()
	# Bullets fly through health packs: the same ray a gun casts (its hit_mask, areas included),
	# straight through the center of a pack nobody has taken (a taken one is switched off).
	var idle: Node3D = current_scene.find_child("HealthPickupObject3", true, false)
	var through := PhysicsRayQueryParameters3D.create(idle.global_position + Vector3(-2, 0, 0),
		idle.global_position + Vector3(2, 0, 0), blue.weapons.hit_mask)
	through.collide_with_areas = true
	var blocker: Dictionary = idle.get_world_3d().direct_space_state.intersect_ray(through)
	if not _check(blocker.is_empty() or blocker.collider != idle, "bullets pass through health packs"):
		return

	# --- shooting effects (red shoots blue from 2 m, like gameplay_smoke). A big health pool
	# keeps Blue standing through the test shots, and makes the one-shot check stricter.
	blue.health.max_health = 1000.0
	blue.health.reset()
	blue.global_position = Vector3(0, 1, 4)
	red.global_position = Vector3(0, 1, 6)
	red.aim.face(0.0)
	await _physics(2)
	var fire := DuoInput.new()
	fire.fire = true
	var dealt := []
	red.weapons.hit_confirmed.connect(func(_t, amount: float, _h): dealt.append(amount))

	red.weapons.tick(fire, 0.5)
	var normal: float = dealt.back() if not dealt.is_empty() else 0.0
	red.powerups.apply(Effect.EXTRA_DAMAGE)
	red.weapons.tick(fire, 0.5)
	if not _check(dealt.size() == 2 and is_equal_approx(dealt[1], normal * 1.5), "extra damage hits 50 percent harder"):
		return
	red.powerups.clear()
	red.powerups.apply(Effect.SCRAMBLER)
	red.weapons.tick(fire, 0.5)
	if not _check(blue.powerups.has(Effect.INVERTED) and not red.powerups.has(Effect.INVERTED), "scrambler hit inverts the enemy only"):
		return
	var input := DuoInput.new()
	input.move = Vector2(0.3, 1.0)
	input.aim_delta = Vector2(0.1, -0.2)
	blue.powerups.modify_input(input)
	if not _check(input.move == Vector2(-0.3, -1.0) and input.aim_delta == Vector2(-0.1, 0.2), "inverted flips move and aim"):
		return
	red.powerups.clear()
	blue.health.reset()
	red.powerups.apply(Effect.ONE_SHOT)
	red.weapons.tick(fire, 0.5)
	if not _check(not blue.alive and not red.powerups.has(Effect.ONE_SHOT), "one-shot round kills from full health and is spent"):
		return
	if not _check(blue.powerups.active().is_empty(), "dying clears your effects"):
		return
	await create_timer(0.1).timeout
	if not _check(blue.alive, "duo respawns after the one-shot kill"):
		return
	blue.health.max_health = 100.0
	blue.health.reset()
	red.powerups.apply(Effect.SPEED)
	red.powerups.apply(Effect.SLOWED)
	if not _check(is_equal_approx(red.powerups.speed_multiplier(), 1.35 * 0.6), "speed and slow multiply"):
		return
	red.powerups.apply(Effect.SPEED, 0.05)
	await create_timer(0.15).timeout
	if not _check(not red.powerups.has(Effect.SPEED) and red.powerups.has(Effect.SLOWED), "timed effects run out on their own"):
		return

	# --- bounty runs out
	if not _check(mode.bounty_left[0] > 0.0 and mode._hud_halves[0].bounty.text.contains("BOUNTY"), "the one-shot kill put a bounty on the HUD"):
		return
	mode.bounty_left[0] = 0.05
	await create_timer(0.15).timeout
	if not _check(mode.bounty_left[0] == 0.0 and mode._hud_halves[0].bounty.text.is_empty(), "bounty expires"):
		return
	var before: int = mode.scores[0]
	blue.global_position = Vector3(0, 1, 6)
	red.global_position = Vector3(0, 1, 4)
	blue.aim.face(0.0)
	await _physics(2)
	red.health.kill(blue)
	if not _check(mode.scores[0] == before + 1, "an expired bounty is worth a normal 1 point"):
		return

	if not await _swap_on_death():
		return
	print("RULES_SMOKE_PASS ", _checks, " checks")
	_finished = true
	quit(0)


## Two phones on Blue through the real embedded server; Blue dies with a 100% swap chance.
func _swap_on_death() -> bool:
	var server := root.get_node("LobbyServer")
	var session := root.get_node("GameSession")
	server.port = 20000 + randi() % 30000
	ProjectSettings.set_setting("network/control_plane_url", "")
	session.players_needed = 2
	if not _check(change_scene_to_file(LOBBY) == OK and await _wait_scene(LOBBY), "lobby opens"):
		return false
	var until := Time.get_ticks_msec() + 5000
	while session.pairing_code.is_empty() and Time.get_ticks_msec() < until:
		await process_frame
	if not _check(not session.pairing_code.is_empty(), "embedded server opens a lobby"):
		return false
	for role in ["movement", "aim"]:
		var phone := WebSocketPeer.new()
		_phones.append(phone)
		phone.connect_to_url("ws://127.0.0.1:%d" % server.port)
		until = Time.get_ticks_msec() + 5000
		while phone.get_ready_state() != WebSocketPeer.STATE_OPEN and Time.get_ticks_msec() < until:
			await process_frame
			phone.poll()
		phone.send_text(JSON.stringify({"type": "join_game", "protocolVersion": 1, "pairingCode": session.pairing_code, "name": role}))
		phone.send_text(JSON.stringify({"type": "select_slot", "teamId": 1, "role": role}))
		phone.send_text(JSON.stringify({"type": "set_ready", "ready": true}))
	if not _check(await _wait_scene(ARENA), "two ready phones start the match"):
		return false
	var mode = current_scene.get_node("DuoSandbox")
	await _physics(3)
	var runner: String = session.controller_at(0, "mover")
	var gunner: String = session.controller_at(0, "gunner")
	if not _check(not runner.is_empty() and not gunner.is_empty() and _assigned.get(0) == "movement", "both Blue phones are routed"):
		return false
	var swaps := [0]
	session.roles_swapped.connect(func(team: int): swaps[0] += 1 if team == 0 else 100)
	mode.swap_on_death_chance = 1.0
	mode.respawn_delay = 0.2
	mode.duos[0].health.kill(mode.duos[1])
	until = Time.get_ticks_msec() + 3000
	while swaps[0] == 0 and Time.get_ticks_msec() < until:
		await process_frame
		_poll_phones()
	await process_frame
	_poll_phones()
	if not _check(swaps[0] == 1, "server confirms the swap for Blue"):
		return false
	if not _check(session.controller_at(0, "mover") == gunner and session.controller_at(0, "gunner") == runner, "game re-routes the swapped phones"):
		return false
	if not _check(_assigned.get(0) == "aim" and _assigned.get(1) == "movement", "each phone is told its new role"):
		return false
	if not _check(mode._hud_halves[0].toast.text.contains("ROLE SWAP"), "Blue's screen announces the swap"):
		return false
	mode.swap_on_death_chance = 0.0
	mode.duos[0].health.reset()
	await create_timer(0.3).timeout
	mode.duos[0].health.kill(mode.duos[1])
	await create_timer(0.3).timeout
	_poll_phones()
	if not _check(swaps[0] == 1 and session.controller_at(0, "mover") == gunner, "no swap when the roll misses"):
		return false
	if not _check(not session.request_role_swap(1), "a team without both phones can't swap"):
		return false
	return true
