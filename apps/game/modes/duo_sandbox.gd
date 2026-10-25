## Test match for the 2v2 split screen.
##
## Run res://modes/duo_sandbox.tscn (F6). That scene loads main.tscn unchanged and adds
## this script on top, so nobody's files are edited. It:
##   - spawns one Duo per team (crude placeholder geometry) into World/Entities
##   - puts Team A's first-person camera on the LEFT screen, Team B's on the RIGHT
##   - hides each team's own body from its own camera, shows the enemy's
##   - draws a crosshair, HP and gun list on each half, and a score at the top
##   - respawns a duo a few seconds after it dies (or falls off the map)
##   - works with the team's map as-is: at runtime it turns on collision for the map's CSG
##     pieces, adds a light if there is none, and uses the map's "Spawn*" pads
##   - builds a temporary test floor + cover only if the map has no geometry at all
##   Nothing is ever saved into the map or main.tscn.
##
## Match rules: first team to `kill_target` kills wins, or whoever leads when the
## `match_seconds` clock runs out (equal = draw). The live score and clock go to the phones
## every second; at the final whistle the action freezes, the result goes to the server and
## the phones, and the results screen (ui/results.tscn) loads.
##
## Controls work from phones (via the relay) and from the keyboard at the same time:
##   Team A (Blue, left): WASD move, Space jump, C crouch, hold Shift sprint, mouse aim (click to capture), left click fire, right click scope, Q / wheel swap gun
##   Team B (Red, right): IJKL move, U jump, O crouch, hold P sprint, arrow keys aim, Enter fire, / scope, . swap gun
##
## Weapon pickups: the map's "Sniper..." / "Shotgun..." spots become floating, spinning guns
## (entities/weapons/weapon_pickup.tscn) at runtime. Walk through one to own that gun; it
## comes back after `pickup_respawn_time`. On death you drop back to the pistol.
##   F3: debug view: hitbox zones on both duos (red head / yellow body / blue legs)
##       plus each team's live spread circle and spread value
class_name DuoSandbox
extends Node

@export var duo_scene: PackedScene = preload("res://entities/duo/duo.tscn")
## Which arena to fight in. Replaces main.tscn's World/ArenaBox at runtime (main.tscn itself is
## not edited). Options: maps/the_pit.tscn (default), maps/arena_v2.tscn, or clear the field to play
## on Brian's original arena_box.tscn.
@export var map_scene: PackedScene = preload("res://maps/the_pit.tscn")
@export var teams: Array[TeamData] = [
	preload("res://data/teams/team_blue.tres"),
	preload("res://data/teams/team_red.tres"),
]
@export var keyboard_controls := true
@export_group("Match rules")
@export var kill_target := 10
@export var match_seconds := 300.0
@export var results_scene := "res://ui/results.tscn"
@export var end_banner_seconds := 2.5
@export_group("")
@export var respawn_delay := 3.0
@export var fov := 80.0
@export var fall_kill_height := -30.0
## Used when the map has no nodes in the "spawn_team_a" / "spawn_team_b" groups.
@export var fallback_spawns: Array[Vector3] = [Vector3(0, 0.5, 12), Vector3(0, 0.5, -12)]
## Builds a floor, walls and a few boxes at runtime if the map has no collision yet.
## Nothing is saved into any scene. Turn this off once the real map exists.
@export var build_test_arena_if_empty := true
## The map's CSG boxes don't have "Use Collision" ticked yet. Turn it on at runtime so you
## can walk on the map (spawn pads are skipped so you don't spawn on top of them).
@export var make_map_csg_solid := true
## Adds a sun + sky at runtime if the world has no light / environment.
@export var add_light_if_missing := true
## Start with the F3 debug view on.
@export var debug_view := false

@export_group("Weapon pickups")
## Turn the map's gun spots (Area3D nodes named after a gun, e.g. "SniperSpawnObject") into
## floating gun pickups at runtime. The map file itself is not changed.
@export var place_weapon_pickups := true
@export var pickup_scene: PackedScene = preload("res://entities/weapons/weapon_pickup.tscn")
@export var pickup_respawn_time := 10.0
@export_group("")

@export_group("Scene paths (relative to this node; it sits directly under Main)")
@export var world_path: NodePath = ^"../World"
@export var entities_path: NodePath = ^"../World/Entities"
@export var screens_path: NodePath = ^"../Screens"
@export var hud_path: NodePath = ^"../HUD"
@export var camera_paths: Array[NodePath] = [
	^"../Screens/TeamAView/SubViewport/TeamACamera",
	^"../Screens/TeamBView/SubViewport/TeamBCamera",
]

var duos: Array[Duo] = []
var scores: Array[int] = [0, 0]

var _cameras: Array[Camera3D] = []
var _hud_halves: Array[Dictionary] = []
var _hint_label: Label
var _score_blue: Label
var _score_red: Label
var _clock: Label
var _banner: Control
var _details: PanelContainer
var _detail_cells: Array = []

var _time_left := 0.0
var _running := false
var _status_timer := 0.0
var _network_match := false


func _ready() -> void:
	# Wait one frame so every node in main.tscn has finished its own _ready.
	_setup.call_deferred()


func _setup() -> void:
	GraphicsSettings.register_screens(get_node(screens_path))
	var world := get_node(world_path) as Node3D
	if map_scene:
		_swap_map(world)
	if make_map_csg_solid:
		_make_csg_solid(world)
	if build_test_arena_if_empty and not _has_geometry(world):
		_build_test_arena(world)
	if add_light_if_missing:
		_add_light_if_missing(world)
	_let_input_through(get_node_or_null(screens_path))
	_build_hud()

	var entities := get_node(entities_path)
	for i in teams.size():
		var duo := duo_scene.instantiate() as Duo
		entities.add_child(duo)
		duo.setup(teams[i])
		duo.add_controller(PhoneDuoController.new(i))
		if keyboard_controls and not GameSession.is_playing() and not NetworkClient.is_connected_to_server():
			duo.add_controller(KeyboardDuoController.new(i))
		var cam := get_node(camera_paths[i]) as Camera3D
		_bind_camera(duo, cam)
		_cameras.append(cam)
		duo.respawn(_spawn_transform(i), false)   # no spawn protection at kick-off
		duos.append(duo)
		var team_huds := get_node_or_null("../HUD/TeamHuds")
		if team_huds and i < team_huds.get_child_count():
			(team_huds.get_child(i) as TeamHud).bind_duo(duo, respawn_delay)

	if place_weapon_pickups and not duos.is_empty():
		_place_weapon_pickups(world, duos[0].weapons.loadout)
	_add_scope_overlays()
	GameEvents.duo_killed.connect(_on_duo_killed)
	_update_score()
	set_debug_view(debug_view)
	_start_match()
	var match_menu := preload("res://ui/pause_menu.gd").new()
	get_parent().add_child(match_menu)
	match_menu.end_match_requested.connect(end_match_by_host)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.physical_keycode == KEY_TAB and not event.echo:
		_details.visible = event.pressed
		_update_details()
	if not _network_match and event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F3:
		set_debug_view(not debug_view)


## F3: show hitbox zones + spread circles. Purely visual; nothing changes in the game rules.
func set_debug_view(on: bool) -> void:
	debug_view = on
	for d in duos:
		if d.hitboxes:
			d.hitboxes.set_debug_visible(on)
	if _hint_label:
		if _network_match:
			_hint_label.text = "TAB  /  SCOREBOARD     ESC  /  HOST MENU"
		else:
			_hint_label.text = "TAB  /  SCOREBOARD     F3  /  DEBUG ON" if on else "TAB  /  SCOREBOARD     F3  /  HITBOXES"



# ---------------------------------------------------------------- cameras

func _bind_camera(duo: Duo, cam: Camera3D) -> void:
	# The camera stays inside its SubViewport; the Duo's head pushes its transform to it.
	duo.camera_mount.remote_path = duo.camera_mount.get_path_to(cam)
	# World + the ENEMY's body + your OWN gun. Your own body is hidden from you.
	cam.cull_mask = 1 \
		| TeamComponent.body_layer_bit(1 - duo.team_id) \
		| TeamComponent.viewmodel_layer_bit(duo.team_id)
	cam.fov = fov
	cam.near = 0.05


func _process(delta: float) -> void:
	_tick_match(delta)
	for i in duos.size():
		var duo := duos[i]
		var w := duo.weapons
		var target := fov
		if w.scoped and w.current_data():
			target = w.current_data().scope_fov
		_cameras[i].fov = lerpf(_cameras[i].fov, target, clampf(delta * 18.0, 0.0, 1.0))
		_update_half_hud(i, duo)


func _physics_process(_delta: float) -> void:
	if not _running:
		return
	for duo in duos:
		if duo.alive and duo.global_position.y < fall_kill_height:
			duo.health.kill(null)


# ---------------------------------------------------------------- weapon pickups

## Finds the map's gun spots by name ("SniperSpawnObject", "ShotgunSpawnObject2", ...), hides
## their placeholder spheres and puts a floating WeaponPickup in the same place. Runtime only.
func _place_weapon_pickups(world: Node3D, loadout: Array[WeaponData]) -> void:
	var placed := 0
	for spot in world.find_children("*", "Area3D", true, false):
		if spot is WeaponPickup or spot is Hurtbox:
			continue
		var data := _weapon_for_spot(spot.name, loadout)
		if data == null:
			continue
		# Use the placeholder's visible center if it has one (some are offset from the Area3D).
		var at: Vector3 = spot.global_position
		var visuals := spot.find_children("*", "GeometryInstance3D", true, false)
		if not visuals.is_empty():
			at = (visuals[0] as Node3D).global_position
		for v in visuals:
			(v as GeometryInstance3D).visible = false
		spot.set_deferred("monitoring", false)
		var p := pickup_scene.instantiate() as WeaponPickup
		p.name = "%sPickup%d" % [data.display_name, placed + 1]
		p.weapon = data
		p.respawn_time = pickup_respawn_time
		p.hover_height = 0.0          # the spot already marks where the gun floats
		world.add_child(p)
		p.global_position = at
		placed += 1
	if placed > 0:
		print("[DuoSandbox] Placed %d floating weapon pickup(s) on the map's gun spots (runtime only)." % placed)


## Sniper scope picture on each team's half of the screen (shows itself while scoped).
func _add_scope_overlays() -> void:
	for i in mini(duos.size(), _hud_halves.size()):
		var half := _hud_halves[i].get("half") as Control
		if half:
			var overlay := ScopeOverlay.new(duos[i].weapons)
			half.add_child(overlay)
			half.move_child(overlay, 0)   # under the text


func _weapon_for_spot(spot_name: String, loadout: Array[WeaponData]) -> WeaponData:
	var n := spot_name.to_lower()
	for i in range(1, loadout.size()):      # slot 0 is the starting pistol; no pickup needed
		if loadout[i] and n.contains(loadout[i].display_name.to_lower()):
			return loadout[i]
	return null


# ---------------------------------------------------------------- spawning / death

func _spawn_transform(team: int) -> Transform3D:
	var pos := Vector3.ZERO
	var group := "spawn_team_a" if team == 0 else "spawn_team_b"
	var points := get_tree().get_nodes_in_group(group)
	var facing = null   # a spawn point can say which way to face (metadata "face_yaw", degrees)
	if not points.is_empty():
		var point := points.pick_random() as Node3D
		pos = point.global_position + Vector3.UP * 0.1
		if point.has_meta("face_yaw"):
			facing = deg_to_rad(float(point.get_meta("face_yaw")))
	else:
		var pads := _map_spawn_pads()
		if pads.size() >= 2:
			# No spawn groups yet: first half of the "Spawn*" pads = Team A, second half = Team B.
			var half := pads.size() / 2
			var mine := pads.slice(0, half) if team == 0 else pads.slice(half)
			var pad := mine.pick_random() as Node3D
			pos = pad.global_position + Vector3.UP * 1.0   # drop onto the floor beside/over the pad
		else:
			pos = fallback_spawns[team % fallback_spawns.size()]
	var to_center := -Vector3(pos.x, 0, pos.z)
	var yaw: float = atan2(-to_center.x, -to_center.z) if to_center.length() > 0.01 else 0.0
	if facing != null:
		yaw = facing
	return Transform3D(Basis(Vector3.UP, yaw), pos)


## Nodes named Spawn1, Spawn2, ... in the world (sorted by name), excluding containers like "Spawns".
func _map_spawn_pads() -> Array[Node3D]:
	var out: Array[Node3D] = []
	var world := get_node(world_path)
	for n in world.find_children("Spawn*", "Node3D", true, false):
		if n.get_child_count() == 0 and not n.name.to_lower().begins_with("spawns") and not (n is Duo):
			out.append(n)
	out.sort_custom(func(a, b): return a.name.naturalnocasecmp_to(b.name) < 0)
	return out


## Listens to the team's GameEvents bus: duo_killed(victim_team, killer_team).
func _on_duo_killed(victim_team: int, killer_team: int) -> void:
	if not _running:
		return
	var v: Duo = null
	for d in duos:
		if d.team_id == victim_team:
			v = d
	if v == null:
		return
	if killer_team >= 0 and killer_team < scores.size() and killer_team != victim_team:
		scores[killer_team] += 1
		GameEvents.score_changed.emit(killer_team, scores[killer_team])
		_send_status()
		if scores[killer_team] >= kill_target:
			_end_match.call_deferred("kills")
	_update_score()
	await get_tree().create_timer(respawn_delay).timeout
	if _running and is_instance_valid(v) and not v.alive:
		# spawn protection after a death; skipped when respawns are near-instant (test setups)
		v.respawn(_spawn_transform(v.team_id), respawn_delay >= 1.0)


# ---------------------------------------------------------------- HUD (built at runtime)

func _build_hud() -> void:
	var hud := get_node(hud_path)
	var root := Control.new()
	root.name = "MatchHud"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(root)
	var halves := HBoxContainer.new()
	halves.set_anchors_preset(Control.PRESET_FULL_RECT)
	halves.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var screens := get_node_or_null(screens_path) as Control
	if screens:
		halves.add_theme_constant_override("separation", screens.get_theme_constant("separation"))
	root.add_child(halves)
	for i in teams.size():
		var half := Control.new()
		half.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		half.mouse_filter = Control.MOUSE_FILTER_IGNORE
		halves.add_child(half)
		var ring := Panel.new()
		ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		ring.set_anchors_preset(Control.PRESET_CENTER)
		var style := StyleBoxFlat.new()
		style.bg_color = Color.TRANSPARENT
		style.border_color = Color(1, 1, 1, 0.6)
		style.set_border_width_all(1)
		style.set_corner_radius_all(4096)
		style.anti_aliasing = true
		ring.add_theme_stylebox_override("panel", style)
		ring.visible = false
		half.add_child(ring)
		var spread := UiKit.label("", 14, UiKit.BODY_BOLD)
		spread.set_anchors_preset(Control.PRESET_CENTER)
		spread.position = Vector2(-60, 40)
		spread.custom_minimum_size = Vector2(120, 24)
		spread.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		spread.visible = false
		half.add_child(spread)
		_hud_halves.append({"half": half, "ring": ring, "spread": spread})
	root.add_child(_build_scoreboard())
	_hint_label = UiKit.label("TAB  /  SCOREBOARD     F3  /  HITBOXES", 12, UiKit.BODY_BOLD, UiKit.MUTED)
	_hint_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_hint_label.offset_left = -170
	_hint_label.offset_right = 170
	_hint_label.offset_top = 100
	_hint_label.offset_bottom = 122
	_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_hint_label)
	_build_details(root)
	_let_input_through(root)


func _update_half_hud(i: int, duo: Duo) -> void:
	if i >= _hud_halves.size():
		return
	var half: Dictionary = _hud_halves[i]
	var show: bool = debug_view and duo.alive
	half.ring.visible = show
	half.spread.visible = show
	if show:
		var degrees := duo.weapons.current_spread_degrees()
		var radius := tan(deg_to_rad(degrees)) / tan(deg_to_rad(_cameras[i].fov * 0.5)) * (half.half as Control).size.y * 0.5
		radius = maxf(radius, 3.0)
		half.ring.offset_left = -radius
		half.ring.offset_top = -radius
		half.ring.offset_right = radius
		half.ring.offset_bottom = radius
		half.spread.text = "SPREAD %.1f deg" % degrees


func _update_score() -> void:
	if _score_blue:
		_score_blue.text = str(scores[0])
		_score_red.text = str(scores[1])


# ---------------------------------------------------------------- match rules

func _start_match() -> void:
	scores = [0, 0]
	_time_left = match_seconds
	_running = true
	_network_match = NetworkClient.is_connected_to_server() and GameSession.is_playing()
	set_debug_view(false if _network_match else debug_view)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	GameSession.state_changed.connect(_on_session_state_changed)
	MatchStats.begin(duos)
	_update_score()
	_send_status()


## A replaced/lost host session needs a fresh lobby countdown, not a running arena
## attached to new phones. Keyboard practice has no network session to recover.
func _on_session_state_changed(state: String) -> void:
	if not _network_match or not _running or not (state in ["waiting", "ready"]):
		return
	_running = false
	MatchStats.abort()
	_return_to_lobby.call_deferred()


func _return_to_lobby() -> void:
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().change_scene_to_file("res://ui/lobby.tscn")


func _tick_match(delta: float) -> void:
	if not _running:
		return
	_time_left = maxf(_time_left - delta, 0.0)
	if _clock:
		_clock.text = "%d:%02d" % [int(_time_left) / 60, int(_time_left) % 60]
		_clock.add_theme_color_override("font_color", UiKit.GOLD if _time_left <= 30.0 else UiKit.INK)
	_status_timer -= delta
	if _status_timer <= 0.0:
		_send_status()
	if _time_left <= 0.0:
		_end_match("time")


func _send_status() -> void:
	_update_details()
	_status_timer = 1.0
	if NetworkClient.is_connected_to_server() and GameSession.is_playing():
		GameSession.send_match_status(scores, _time_left, kill_target)


func end_match_by_host() -> void:
	_end_match("host")


func _end_match(reason: String) -> void:
	if not _running:
		return
	_running = false
	var match_menu := get_parent().get_node_or_null("PauseMenu")
	if match_menu:
		match_menu.finish()
	var winner := -1
	if scores[0] != scores[1]:
		winner = 0 if scores[0] > scores[1] else 1
	MatchStats.finish(winner, scores, reason)
	if NetworkClient.is_connected_to_server() and GameSession.is_playing():
		GameSession.end_match(winner, scores, MatchStats.to_protocol(), reason)
	_show_banner(winner)
	get_tree().paused = true
	await get_tree().create_timer(end_banner_seconds, true).timeout
	get_tree().paused = false
	get_tree().change_scene_to_file(results_scene)


func _build_scoreboard() -> Control:
	var board := HBoxContainer.new()
	board.set_anchors_preset(Control.PRESET_CENTER_TOP)
	board.offset_left = -170
	board.offset_right = 170
	board.offset_top = 12
	board.offset_bottom = 94
	board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	board.add_theme_constant_override("separation", 4)
	_score_blue = _board_cell(board, UiKit.BLUE)
	var center := PanelContainer.new()
	var style := UiKit.panel_box(UiKit.LINE, Color(0.02, 0.03, 0.065, 0.94))
	style.set_content_margin_all(8)
	center.add_theme_stylebox_override("panel", style)
	center.custom_minimum_size.x = 154
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", -2)
	_clock = UiKit.display("5:00", 32)
	_clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_clock)
	var target := UiKit.label("FIRST TO %d" % kill_target, 13, UiKit.BODY_BOLD, UiKit.MUTED)
	target.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(target)
	center.add_child(col)
	board.add_child(center)
	_score_red = _board_cell(board, UiKit.RED)
	return board


func _board_cell(board: HBoxContainer, color: Color) -> Label:
	var cell := PanelContainer.new()
	var style := UiKit.panel_box(Color(color, 0.8), Color(color.r * 0.15, color.g * 0.15, color.b * 0.15, 0.94))
	style.set_content_margin_all(6)
	style.border_width_bottom = 4
	cell.add_theme_stylebox_override("panel", style)
	cell.custom_minimum_size.x = 88
	var label := UiKit.display("0", 48, color)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cell.add_child(label)
	board.add_child(cell)
	return label


func _build_details(root: Control) -> void:
	_details = PanelContainer.new()
	_details.set_anchors_preset(Control.PRESET_CENTER)
	_details.offset_left = -370
	_details.offset_right = 370
	_details.offset_top = -160
	_details.offset_bottom = 160
	_details.add_theme_stylebox_override("panel", UiKit.panel_box(UiKit.LINE, Color(0.02, 0.03, 0.065, 0.97)))
	_details.visible = false
	root.add_child(_details)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 20)
	_details.add_child(rows)
	rows.add_child(UiKit.eyebrow("LIVE MATCH  /  SCOREBOARD", UiKit.GOLD))
	var headings := HBoxContainer.new()
	headings.add_theme_constant_override("separation", 12)
	for title in ["SQUAD", "KILLS", "DEATHS", "ACCURACY", "BEST STREAK"]:
		var label := UiKit.label(title, 14, UiKit.BODY_BOLD, UiKit.MUTED)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.custom_minimum_size.x = 120
		headings.add_child(label)
	rows.add_child(headings)
	for i in 2:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		rows.add_child(row)
		var cells: Array[Label] = []
		for j in 5:
			var label := UiKit.display(UiKit.team_name(i) if j == 0 else "0", 28, UiKit.team_color(i) if j == 0 else UiKit.INK)
			label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			label.custom_minimum_size.x = 120
			row.add_child(label)
			cells.append(label)
		_detail_cells.append(cells)
	rows.add_child(UiKit.label("Hold TAB to view / Keep your squad together", 16, UiKit.BODY, UiKit.MUTED))


func _update_details() -> void:
	if MatchStats.teams.size() < 2:
		return
	for i in 2:
		var stats: Dictionary = MatchStats.teams[i]
		_detail_cells[i][1].text = str(stats.get("kills", 0))
		_detail_cells[i][2].text = str(stats.get("deaths", 0))
		_detail_cells[i][3].text = "%d%%" % roundi(MatchStats.accuracy(i) * 100.0)
		_detail_cells[i][4].text = str(stats.get("best_streak", 0))


func _show_banner(winner: int) -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_details.visible = false
	var hud := get_node_or_null(hud_path)
	if hud == null:
		return
	_banner = ColorRect.new()
	(_banner as ColorRect).color = Color(0, 0, 0, 0.55)
	_banner.set_anchors_preset(Control.PRESET_FULL_RECT)
	_banner.process_mode = Node.PROCESS_MODE_ALWAYS
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_banner.add_child(center)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(box)
	var top := UiKit.eyebrow("Match over", UiKit.INK)
	top.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(top)
	var text := "DRAW" if winner < 0 else "%s WINS" % UiKit.team_name(winner)
	var big := UiKit.display(text, 140, UiKit.INK if winner < 0 else UiKit.team_color(winner))
	big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(big)
	var line := UiKit.display("%d — %d" % [scores[0], scores[1]], 48)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(line)
	hud.add_child(_banner)


# ---------------------------------------------------------------- helpers

## The split-screen containers would otherwise swallow mouse clicks meant for the game.
func _let_input_through(node: Node) -> void:
	if node == null:
		return
	if node is Control:
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in node.get_children():
		_let_input_through(c)


## Swap main.tscn's arena for `map_scene` (runtime only).
func _swap_map(world: Node3D) -> void:
	var old := world.get_node_or_null("ArenaBox")
	var arena := map_scene.instantiate()
	arena.name = "Arena"
	if old:
		var idx := old.get_index()
		world.remove_child(old)
		old.queue_free()
		world.add_child(arena)
		world.move_child(arena, idx)
	else:
		world.add_child(arena)
		world.move_child(arena, 0)


func _has_geometry(root: Node) -> bool:
	for n in root.find_children("*", "", true, false):
		if n is CSGShape3D or (n is CollisionObject3D and not n is Duo):
			return true
	return false


## Runtime only: tick "Use Collision" on the map's top-level CSG pieces (not the spawn pads).
func _make_csg_solid(root: Node) -> void:
	var changed := 0
	for n in root.find_children("*", "CSGShape3D", true, false):
		var csg := n as CSGShape3D
		if csg.is_root_shape() and not csg.use_collision and not _is_spawn_pad(csg) and not csg.is_in_group("visual_only"):
			csg.use_collision = true
			changed += 1
	if changed > 0:
		print("[DuoSandbox] Turned on collision for %d map CSG piece(s) at runtime. Tick 'Use Collision' on them in the map to make it permanent." % changed)


func _is_spawn_pad(n: Node) -> bool:
	var p := n
	while p:
		if p.name.to_lower().begins_with("spawn"):
			return true
		p = p.get_parent()
	return false


func _add_light_if_missing(world: Node3D) -> void:
	if world.find_children("*", "DirectionalLight3D", true, false).is_empty():
		var sun := DirectionalLight3D.new()
		sun.name = "SandboxSun (runtime only)"
		sun.rotation_degrees = Vector3(-50, 35, 0)
		sun.shadow_enabled = true
		world.add_child(sun)
	if world.find_children("*", "WorldEnvironment", true, false).is_empty():
		var env := Environment.new()
		env.background_mode = Environment.BG_SKY
		env.sky = Sky.new()
		env.sky.sky_material = ProceduralSkyMaterial.new()
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		var we := WorldEnvironment.new()
		we.name = "SandboxEnvironment (runtime only)"
		we.environment = env
		world.add_child(we)


## Temporary greybox so you can test before the real map is in. Not saved anywhere.
func _build_test_arena(world: Node3D) -> void:
	var arena := Node3D.new()
	arena.name = "TestArena (runtime only)"
	world.add_child(arena)
	var grey := Color(0.45, 0.47, 0.52)
	_box(arena, Vector3(40, 1, 40), Vector3(0, -0.5, 0), Color(0.35, 0.37, 0.4))     # floor
	_box(arena, Vector3(40, 4, 1), Vector3(0, 2, 20.5), grey)                       # walls
	_box(arena, Vector3(40, 4, 1), Vector3(0, 2, -20.5), grey)
	_box(arena, Vector3(1, 4, 40), Vector3(20.5, 2, 0), grey)
	_box(arena, Vector3(1, 4, 40), Vector3(-20.5, 2, 0), grey)
	var crate := Color(0.62, 0.48, 0.32)
	for p in [Vector3(-5, 1, 4), Vector3(5, 1, -4), Vector3(9, 1, 6), Vector3(-9, 1, -6)]:
		_box(arena, Vector3(2, 2, 2), p, crate)                                     # crates (too tall to jump)
	var cover := Color(0.5, 0.56, 0.5)
	for p in [Vector3(0, 0.55, 6), Vector3(0, 0.55, -6), Vector3(-10, 0.55, 0), Vector3(10, 0.55, 0)]:
		_box(arena, Vector3(4, 1.1, 0.6), p, cover)                                  # low cover (jumpable)
	_box(arena, Vector3(4, 1.5, 4), Vector3(0, 0.75, 0), Color(0.55, 0.55, 0.62))    # center platform



func _box(parent: Node3D, size: Vector3, pos: Vector3, color: Color) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	var mesh := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mesh.mesh = bm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mesh.material_override = mat
	var shape := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	shape.shape = bs
	body.add_child(mesh)
	body.add_child(shape)
	parent.add_child(body)
