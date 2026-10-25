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
## Controls work from phones (via the relay) and from the keyboard at the same time:
##   Team A: WASD, Space jump, Ctrl crouch, hold Q sprint, mouse aim (click to capture), LMB fire, RMB scope, 1/2/3 guns
##   Team B: IJKL, Shift jump, N crouch, hold U sprint, arrow keys aim, Enter fire, M scope, 8/9/0 guns
class_name DuoSandbox
extends Node

@export var duo_scene: PackedScene = preload("res://entities/duo/duo.tscn")
@export var teams: Array[TeamData] = [
	preload("res://data/teams/team_blue.tres"),
	preload("res://data/teams/team_red.tres"),
]
@export var keyboard_controls := true
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
var _score_label: Label


func _ready() -> void:
	# Wait one frame so every node in main.tscn has finished its own _ready.
	_setup.call_deferred()


func _setup() -> void:
	var world := get_node(world_path) as Node3D
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
		if keyboard_controls:
			duo.add_controller(KeyboardDuoController.new(i))
		var cam := get_node(camera_paths[i]) as Camera3D
		_bind_camera(duo, cam)
		_cameras.append(cam)
		duo.respawn(_spawn_transform(i))
		duos.append(duo)

	GameEvents.duo_killed.connect(_on_duo_killed)
	_update_score()


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
	for i in duos.size():
		var duo := duos[i]
		var w := duo.weapons
		var target := fov
		if w.scoped and w.current_data():
			target = w.current_data().scope_fov
		_cameras[i].fov = lerpf(_cameras[i].fov, target, clampf(delta * 18.0, 0.0, 1.0))
		_update_half_hud(i, duo)


func _physics_process(_delta: float) -> void:
	for duo in duos:
		if duo.alive and duo.global_position.y < fall_kill_height:
			duo.health.kill(null)


# ---------------------------------------------------------------- spawning / death

func _spawn_transform(team: int) -> Transform3D:
	var pos := Vector3.ZERO
	var group := "spawn_team_a" if team == 0 else "spawn_team_b"
	var points := get_tree().get_nodes_in_group(group)
	if not points.is_empty():
		pos = (points.pick_random() as Node3D).global_position + Vector3.UP * 0.1
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
	var yaw := atan2(-to_center.x, -to_center.z) if to_center.length() > 0.01 else 0.0
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
	var v: Duo = null
	for d in duos:
		if d.team_id == victim_team:
			v = d
	if v == null:
		return
	if killer_team >= 0 and killer_team != victim_team:
		scores[killer_team] += 1
		GameEvents.score_changed.emit(killer_team, scores[killer_team])
	_update_score()
	await get_tree().create_timer(respawn_delay).timeout
	if is_instance_valid(v) and not v.alive:
		v.respawn(_spawn_transform(v.team_id))


# ---------------------------------------------------------------- HUD (built at runtime)

func _build_hud() -> void:
	var hud := get_node_or_null(hud_path)
	if hud == null:
		hud = CanvasLayer.new()
		get_parent().add_child.call_deferred(hud)
	var root := Control.new()
	root.name = "DuoSandboxHud"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(root)

	# Two halves laid out the same way as the Screens HBoxContainer.
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

		var crosshair := _label("+", 30)
		crosshair.set_anchors_preset(Control.PRESET_CENTER)
		crosshair.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		crosshair.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		crosshair.custom_minimum_size = Vector2(40, 40)
		crosshair.position = -crosshair.custom_minimum_size * 0.5
		half.add_child(crosshair)

		var title := _label("%s TEAM" % teams[i].display_name.to_upper(), 24)
		title.add_theme_color_override("font_color", teams[i].color)
		title.position = Vector2(16, 52)
		half.add_child(title)

		var info := _label("", 18)
		info.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
		info.position = Vector2(16, -64)
		half.add_child(info)

		var dead := _label("RESPAWNING…", 40)
		dead.set_anchors_preset(Control.PRESET_CENTER)
		dead.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		dead.custom_minimum_size = Vector2(400, 60)
		dead.position = Vector2(-200, -90)
		dead.visible = false
		half.add_child(dead)

		_hud_halves.append({"crosshair": crosshair, "info": info, "dead": dead})

	_score_label = _label("", 26)
	_score_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_score_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_score_label.custom_minimum_size = Vector2(320, 40)
	_score_label.position = Vector2(-160, 8)
	root.add_child(_score_label)


func _label(text: String, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 6)
	return l


func _update_half_hud(i: int, duo: Duo) -> void:
	if i >= _hud_halves.size():
		return
	var h: Dictionary = _hud_halves[i]
	var w := duo.weapons
	var guns: PackedStringArray = []
	for g in w.loadout.size():
		var n := w.loadout[g].display_name.to_upper()
		guns.append("[%s]" % n if g == w.current else (n if w.owned[g] else "·"))
	h.info.text = "HP %d\n%s" % [ceili(duo.health.hp), "   ".join(guns)]
	h.crosshair.visible = duo.alive
	h.crosshair.text = "( + )" if w.scoped else "+"
	h.dead.visible = not duo.alive


func _update_score() -> void:
	if _score_label:
		_score_label.text = "%s %d  —  %d %s" % [
			teams[0].display_name.to_upper(), scores[0], scores[1], teams[1].display_name.to_upper()]


# ---------------------------------------------------------------- helpers

## The split-screen containers would otherwise swallow mouse clicks meant for the game.
func _let_input_through(node: Node) -> void:
	if node == null:
		return
	if node is Control:
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in node.get_children():
		_let_input_through(c)


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
		if csg.is_root_shape() and not csg.use_collision and not _is_spawn_pad(csg):
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
