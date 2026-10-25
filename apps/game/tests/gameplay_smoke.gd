## Run: godot --headless --path apps/game --script res://tests/gameplay_smoke.gd
## Exercises production scenes and components. A failed check or timeout exits with 1.
extends SceneTree

const MENU := "res://ui/main_menu.tscn"
const ARENA := "res://modes/duo_sandbox.tscn"
const RESULTS := "res://ui/results.tscn"
const GRAPHICS_TEST_CONFIG := "user://graphics_smoke.cfg"

var _checks := 0
var _finished := false


func _initialize() -> void:
	_run.call_deferred()


func _check(condition: bool, description: String) -> bool:
	if not condition:
		push_error("GAMEPLAY_SMOKE_FAIL: " + description)
		_finished = true
		quit(1)
		return false
	_checks += 1
	return true


func _find_button(node: Node, text: String) -> Button:
	if node is Button and node.text == text:
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _wait_for_scene(path: String) -> bool:
	for frame in 1200:
		await process_frame
		if is_instance_valid(current_scene) and current_scene.scene_file_path == path:
			await process_frame
			return true
	return false


func _click(button: Button) -> void:
	await process_frame
	await process_frame
	var position := button.get_global_transform_with_canvas() * (button.size * 0.5)
	var motion := InputEventMouseMotion.new()
	motion.position = position
	root.push_input(motion, true)
	for pressed in [true, false]:
		var event := InputEventMouseButton.new()
		event.button_index = MOUSE_BUTTON_LEFT
		event.position = position
		event.pressed = pressed
		root.push_input(event, true)
	await process_frame


func _run() -> void:
	create_timer(15.0).timeout.connect(func():
		if not _finished:
			push_error("GAMEPLAY_SMOKE_FAIL: timed out")
			quit(1))
	var graphics := root.get_node("GraphicsSettings")
	# Exercise persistence with an isolated profile; never overwrite graphics.cfg.
	var invalid := ConfigFile.new()
	invalid.set_value("graphics", "resolution", Vector2i(-1, 0))
	invalid.set_value("graphics", "render_scale", "invalid")
	invalid.set_value("graphics", "window_mode", 99)
	invalid.set_value("graphics", "vsync", 123)
	if not _check(invalid.save(GRAPHICS_TEST_CONFIG) == OK and graphics.load_settings(GRAPHICS_TEST_CONFIG) == OK, "isolated graphics profile loads"):
		return
	if not _check(graphics.resolution == Vector2i(1920, 1080) and graphics.render_scale == 1.0 and graphics.window_mode == 0 and graphics.vsync, "invalid preferences fall back to 1080p defaults"):
		return
	if not _check(graphics.apply_settings(Vector2i(1280, 720), 0.5, 0, false) == OK, "720p output and 50 percent render scale apply and save"):
		return
	await process_frame
	if not _check(graphics.load_settings() == OK and graphics.resolution == Vector2i(1280, 720) and graphics.render_scale == 0.5 and not graphics.vsync, "graphics preferences survive reload"):
		return
	if not _check(graphics.apply_settings(Vector2i(2560, 1440), 1.25, 0, true) == OK, "1440p output and 125 percent supersampling apply"):
		return
	await process_frame
	if DisplayServer.get_name() != "headless" and not _check(root.size == Vector2i(2560, 1440), "display window uses selected 1440p output"):
		return
	if not _check(root.content_scale_size == Vector2i(1920, 1080), "graphics changes preserve logical 1080p HUD canvas"):
		return
	if not _check(ProjectSettings.get_setting("application/run/main_scene") == MENU, "project boots into main menu"):
		return
	if not _check(change_scene_to_file(MENU) == OK, "main menu loads"):
		return
	if not _check(await _wait_for_scene(MENU), "main menu becomes active"):
		return
	var graphics_button := _find_button(current_scene, "SETTINGS")
	if not _check(graphics_button != null, "main menu exposes settings"):
		return
	await _click(graphics_button)
	if not _check(current_scene._graphics.is_open(), "main-menu settings modal opens"):
		return
	var count: HSlider = current_scene._graphics._players
	if not _check(count != null and count.min_value == 1 and count.max_value == 4 and count.step == 1, "settings offer a player count slider (1-4)"):
		return
	await _click(_find_button(current_scene._graphics, "BACK"))
	if not _check(not current_scene._graphics.is_open(), "mouse closes graphics modal"):
		return
	current_scene._graphics.open_menu()
	await _click(_find_button(current_scene._graphics, "APPLY"))
	if not _check(not current_scene._graphics.is_open(), "applying settings closes the modal"):
		return
	var practice := _find_button(current_scene, "PRACTICE / KEYBOARD")
	if not _check(practice != null, "main menu exposes practice"):
		return
	await _click(practice)
	if not _check(await _wait_for_scene(ARENA), "practice enters arena"):
		return
	await physics_frame
	var mode = current_scene.get_node("DuoSandbox")
	if not _check(mode != null and mode.duos.size() == 2, "sandbox initializes both duos"):
		return
	var screen_view := current_scene.get_node("Screens/TeamAView/SubViewport") as SubViewport
	if not _check(is_equal_approx(screen_view.scaling_3d_scale, 1.25) and screen_view.get_parent().stretch_shrink == 1, "new split-screen viewports inherit full-resolution graphics settings"):
		return
	graphics.apply_settings(Vector2i(1280, 720), 0.67, 0, true, false)
	await process_frame
	await process_frame
	if not _check(is_equal_approx(screen_view.scaling_3d_scale, 0.67) and Vector2i(current_scene.get_node("Screens").size) == root.size, "existing viewports follow output changes and 67 percent upscaling"):
		return
	graphics.apply_settings(Vector2i(3840, 2160), 0.5, 0, true, false)
	await process_frame
	await process_frame
	if not _check(graphics.resolution == Vector2i(3840, 2160) and is_equal_approx(screen_view.scaling_3d_scale, 0.5), "4K output preset supports independent render downscaling"):
		return
	if DisplayServer.get_name() != "headless" and not _check(screen_view.size.y == root.size.y, "3D viewport renders at output pixel height independently of HUD scale"):
		return
	graphics.apply_settings(Vector2i(1920, 1080), 1.0, 0, true, false)
	await process_frame
	await process_frame
	mode.respawn_delay = 0.03
	mode.end_banner_seconds = 0.01
	mode.kill_target = 3
	for duo in mode.duos:
		duo.set_physics_process(false)
	var hud = current_scene.get_node("HUD/TeamHuds/TeamAHud")
	if not _check(hud != null and hud._duo == mode.duos[0], "gameplay HUD binds correct duo"):
		return
	if not _check(mode._score_blue.text == "0" and mode._score_red.text == "0", "scoreboard starts at zero"):
		return
	var pause_menu := current_scene.get_node("PauseMenu")
	if not _check(_find_button(pause_menu, "MENU / ESC") != null, "gameplay exposes match menu"):
		return
	var key := InputEventKey.new()
	key.physical_keycode = KEY_TAB
	key.keycode = KEY_TAB
	key.pressed = true
	root.push_input(key)
	if not _check(mode._details.visible, "menu button preserves hold-Tab scoreboard"):
		return
	key.pressed = false
	root.push_input(key)
	if not _check(not mode._details.visible, "Tab release hides scoreboard"):
		return
	key.physical_keycode = KEY_ESCAPE
	key.keycode = KEY_ESCAPE
	key.pressed = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	# The headless display driver may retain visible mode instead of capturing.
	var previous_mouse_mode := Input.mouse_mode
	root.push_input(key)
	if not _check(paused and pause_menu._shade.visible and Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "offline practice pauses and releases cursor"):
		return
	_find_button(pause_menu, "GRAPHICS").pressed.emit()
	if not _check(pause_menu._graphics.is_open() and paused, "graphics modal is usable during paused practice"):
		return
	root.push_input(key)
	if not _check(not pause_menu._graphics.is_open() and paused, "Escape closes graphics before resuming practice"):
		return
	root.push_input(key)
	if not _check(not paused and not pause_menu._shade.visible and Input.mouse_mode == previous_mouse_mode, "resume unpauses practice and restores cursor mode"):
		return
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	# Live matches must keep processing phone controls while navigation is open.
	pause_menu._networked_match = true
	pause_menu.open_menu()
	if not _check(not paused and pause_menu._note.text.contains("keeps running"), "live-match menu does not pause and explains it"):
		return
	pause_menu.resume()
	pause_menu._networked_match = false
	var weapons = mode.duos[0].weapons
	var data = weapons.current_data()
	var idle := DuoInput.new()
	var fire := DuoInput.new()
	fire.fire = true
	var reload_input := DuoInput.new()
	reload_input.reload = true
	var capacity = data.magazine_size
	if not _check(weapons.ammo_in_mag() == capacity, "spawn begins with full magazine"):
		return
	weapons.tick(fire, data.fire_interval + 0.3)
	if not _check(weapons.ammo_in_mag() == capacity - 1, "real shot consumes one round"):
		return
	for shot in capacity - 1:
		weapons.tick(fire, data.fire_interval + 0.01)
	if not _check(weapons.ammo_in_mag() == 0 and weapons.reloading, "empty magazine starts automatic reload"):
		return
	weapons.tick(fire, 0.05)
	if not _check(weapons.ammo_in_mag() == 0 and weapons.reloading, "firing is blocked during reload"):
		return
	weapons.tick(idle, data.reload_seconds + 0.01)
	if not _check(weapons.ammo_in_mag() == capacity and not weapons.reloading, "reload restores magazine"):
		return
	weapons.tick(fire, data.fire_interval + 0.01)
	weapons.tick(reload_input, 0.01)
	weapons.tick(idle, data.reload_seconds * 0.4)
	if not _check(weapons.reloading and weapons.reload_progress() > 0.0 and weapons.reload_progress() < 1.0, "manual reload reports radial progress"):
		return
	if not _check(weapons.give(weapons.loadout[1]), "weapon pickup unlocks shotgun"):
		return
	if not _check(weapons.current == 1 and not weapons.reloading, "switch cancels reload"):
		return
	weapons.select(0)
	if not _check(weapons.ammo_in_mag() == capacity - 1, "cancelled reload preserves rounds"):
		return
	mode.duos[0].respawn(mode._spawn_transform(0))
	if not _check(weapons.current == 0 and weapons.ammo_in_mag() == capacity and not weapons.owned[1], "respawn resets loadout and ammo"):
		return
	var stats := root.get_node("MatchStats")
	mode.duos[0].health.apply_damage(25.0, mode.duos[1])
	if not _check(hud._vitals.health == 75.0 and hud._damage > 0.0, "damage updates animated health and flash"):
		return
	mode.duos[0].health.kill(mode.duos[1])
	if not _check(mode.scores[1] == 1 and hud._death.visible, "death shows kill screen and increments score"):
		return
	if not _check(stats.teams[1].streak == 1 and stats.teams[1].best_streak == 1, "first kill starts streak"):
		return
	await create_timer(0.05).timeout
	if not _check(mode.duos[0].alive and not hud._death.visible, "respawn clears kill screen"):
		return
	mode.duos[0].health.kill(mode.duos[1])
	if not _check(stats.teams[1].streak == 2 and stats.teams[1].best_streak == 2, "consecutive kill advances streak"):
		return
	await create_timer(0.05).timeout
	mode.duos[1].health.kill(mode.duos[0])
	if not _check(stats.teams[1].streak == 0 and stats.teams[1].best_streak == 2, "death resets current streak and preserves record"):
		return
	mode._update_details()
	if not _check(mode._detail_cells[1][1].text == "2" and mode._detail_cells[1][4].text == "2", "detailed scoreboard reflects kills and best streak"):
		return
	await create_timer(0.05).timeout
	# Finish through actual hitscan to catch final-shot statistics being lost when
	# the death signal precedes hit_confirmed/fired on the same physics step.
	mode.duos[0].global_position = Vector3(0, 1, 4)
	mode.duos[1].global_position = Vector3(0, 1, 6)
	mode.duos[1].aim.face(0.0)
	mode.duos[0].health.apply_damage(99.0, mode.duos[1])
	await physics_frame
	await physics_frame
	var final_shots: int = stats.teams[1].shots
	mode.duos[1].weapons.tick(fire, 0.5)
	if not _check(not mode.duos[0].alive, "final hitscan shot reaches target"):
		return
	if not _check(await _wait_for_scene(RESULTS), "kill target opens results"):
		return
	if not _check(stats.teams[1].shots == final_shots + 1 and stats.teams[1].hits >= 1, "winning shot is included in final statistics"):
		return
	if not _check(not paused and stats.result.get("winner", -1) == 1 and stats.result.scores == [1, 3], "results preserve final score and unpause tree"):
		return
	var menu := _find_button(current_scene, "MAIN MENU")
	if not _check(menu != null, "results offer return to menu"):
		return
	await _click(menu)
	if not _check(await _wait_for_scene(MENU), "results return to main menu"):
		return
	_find_button(current_scene, "PRACTICE / KEYBOARD").pressed.emit()
	if not _check(await _wait_for_scene(ARENA), "practice can restart after results"):
		return
	var leave_menu := current_scene.get_node("PauseMenu")
	leave_menu.open_menu()
	if not _check(paused, "practice is paused before leaving"):
		return
	var practice_mode = current_scene.get_node("DuoSandbox")
	practice_mode.end_banner_seconds = 0.01
	if not _check(_find_button(leave_menu, "MAIN MENU") == null, "match menu cannot bypass final results"):
		return
	await _click(_find_button(leave_menu, "END MATCH"))
	if not _check(await _wait_for_scene(RESULTS) and not paused, "ending paused practice opens final results"):
		return
	if not _check(stats.result.reason == "host" and stats.result.winner == -1 and stats.result.scores == [0, 0], "early tied match ends in a draw"):
		return
	await process_frame
	if not _check(_find_button(current_scene, "PLAY AGAIN") == null, "host-ended results only offer main menu"):
		return
	await _click(_find_button(current_scene, "MAIN MENU"))
	if not _check(await _wait_for_scene(MENU) and not paused, "host-ended results return to usable main menu by mouse"):
		return
	print("GAMEPLAY_SMOKE_PASS ", _checks, " checks")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(GRAPHICS_TEST_CONFIG))
	_finished = true
	quit(0)
