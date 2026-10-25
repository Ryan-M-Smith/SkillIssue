## Base for floating map pickups (mystery boxes, and any future kind): a glowing pad, a
## bobbing / spinning visual, and a respawn timer. A Duo walks through it to use it.
## A new kind of pickup only overrides two methods:
##   _build_visual() -> Node3D   what floats above the pad
##   _give(duo) -> bool          do the thing; false = not used (it stays for someone else)
## Placed by DuoSandbox._place_arena_pickups.
## (Weapon pickups are older and have their own script: entities/weapons/weapon_pickup.gd.)
class_name ArenaPickup
extends Area3D

signal picked_up(duo: Node)

@export var respawn_time := 15.0
@export var hover_height := 1.0
@export var bob_height := 0.12
@export var spin_speed := 1.2           ## radians per second
@export var pad_color := Color(0.9, 0.85, 0.6)
## Settle onto the floor below once the map's collision exists (placed spots can be rough).
@export var snap_to_floor := true

var _visual: Node3D
var _pad: MeshInstance3D
var _timer := 0.0
var _t := 0.0
var _settled := false
var _physics_frames := 0


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2            # Duo bodies
	monitorable = false
	var shape := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = 0.9
	cyl.height = 2.2
	shape.shape = cyl
	shape.position = Vector3(0, hover_height, 0)
	add_child(shape)
	_build_pad()
	_visual = _build_visual()
	if _visual:
		add_child(_visual)
	body_entered.connect(_on_body_entered)


func is_available() -> bool:
	return _timer <= 0.0


## Override: the model that floats over the pad.
func _build_visual() -> Node3D:
	return null


## Override: apply the pickup to `duo`. Return false if it doesn't need it (e.g. full health).
func _give(_duo: Duo) -> bool:
	return false


func _build_pad() -> void:
	_pad = MeshInstance3D.new()
	_pad.name = "Pad"
	var m := CylinderMesh.new()
	m.top_radius = 0.6
	m.bottom_radius = 0.75
	m.height = 0.08
	_pad.mesh = m
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.15, 0.17, 0.22)
	mat.emission_enabled = true
	mat.emission = pad_color
	mat.emission_energy_multiplier = 0.6
	_pad.material_override = mat
	_pad.position = Vector3(0, 0.04, 0)
	add_child(_pad)


func _process(delta: float) -> void:
	_t += delta
	if _visual:
		_visual.position = Vector3(0, hover_height + sin(_t * 2.5) * bob_height, 0)
		_visual.rotation.y = _t * spin_speed
	if _timer > 0.0:
		_timer -= delta
		if _timer <= 0.0:
			_set_shown(true)
			for b in get_overlapping_bodies():
				_on_body_entered(b)


func _physics_process(_delta: float) -> void:
	if _settled:
		return
	# Wait a few physics frames: lets the map's collision appear, and ignores Duos that sit at
	# the world origin for a frame before moving to their spawn.
	_physics_frames += 1
	if _physics_frames < 3:
		return
	_settled = true
	if snap_to_floor:
		var from := global_position + Vector3.UP * 0.5
		var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 6.0, 1)
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty():
			global_position = hit.position
	for b in get_overlapping_bodies():
		_on_body_entered(b)


func _on_body_entered(body: Node3D) -> void:
	if not is_available() or not _settled:
		return
	if body is Duo and body.alive and _give(body):
		_timer = respawn_time
		_set_shown(false)
		picked_up.emit(body)


func _set_shown(on: bool) -> void:
	if _visual:
		_visual.visible = on
	(_pad.material_override as StandardMaterial3D).emission_energy_multiplier = 0.6 if on else 0.1


## An emissive, unshaded-looking material for simple placeholder shapes.
static func glow_material(color: Color, energy := 1.5) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = energy
	return mat
