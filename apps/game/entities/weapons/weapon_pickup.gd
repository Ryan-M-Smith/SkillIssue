## Quake-style floating gun. Walk the Duo through it to own that gun (it switches to it).
## Already own it? It stays for the other team. After pickup it comes back after `respawn_time`.
## Drop entities/weapons/weapon_pickup.tscn anywhere in a map and set `weapon`, or let the
## match mode place them on the map's existing "Sniper..." / "Shotgun..." spots at runtime.
class_name WeaponPickup
extends Area3D

signal picked_up(duo: Node, data: WeaponData)

@export var weapon: WeaponData:
	set(v):
		weapon = v
		_build_model()
@export var respawn_time := 10.0
@export var model_scale := 1.8           ## the floating gun is drawn bigger than the one in your hands
@export var hover_height := 1.0          ## gun center above this node's origin
@export var bob_height := 0.12
@export var spin_speed := 1.6            ## radians per second
## Drop the glowing pad onto the floor below (useful when the pickup is placed in mid-air).
@export var snap_pad_to_floor := true

var _holder: MeshInstance3D
var _pad: MeshInstance3D
var _timer := 0.0
var _t := 0.0
var _pad_snapped := false
var _physics_frames := 0


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2            # Duo bodies
	monitorable = false
	if get_child_count() == 0 or find_children("*", "CollisionShape3D", false, false).is_empty():
		var shape := CollisionShape3D.new()
		var cyl := CylinderShape3D.new()
		cyl.radius = 0.9
		cyl.height = 2.2
		shape.shape = cyl
		shape.position = Vector3(0, hover_height, 0)
		add_child(shape)
	_build_pad()
	_build_model()
	body_entered.connect(_on_body_entered)


func is_available() -> bool:
	return _timer <= 0.0


func _build_model() -> void:
	if not is_inside_tree():
		return
	if _holder == null:
		_holder = MeshInstance3D.new()
		_holder.name = "Gun"
		add_child(_holder)
	GunSkin.attach(_holder, weapon, model_scale)
	if weapon and _pad:
		var mat := _pad.material_override as StandardMaterial3D
		mat.emission = weapon.color


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
	mat.emission = Color(0.9, 0.85, 0.6)
	mat.emission_energy_multiplier = 0.6
	_pad.material_override = mat
	_pad.position = Vector3(0, 0.04, 0)
	add_child(_pad)


func _process(delta: float) -> void:
	_t += delta
	if _holder:
		# Center the gun (its origin is the grip) over the pad, then bob and spin it.
		_holder.position = Vector3(0, hover_height + sin(_t * 2.5) * bob_height, 0)
		_holder.rotation.y = _t * spin_speed
		var skin := GunSkin.get_skin(_holder)
		if skin:
			var tip := GunSkin.muzzle_offset(skin)
			skin.position = Vector3(0, 0, -tip.z * 0.5)
	if _timer > 0.0:
		_timer -= delta
		if _timer <= 0.0:
			_holder.visible = true
			for b in get_overlapping_bodies():
				_on_body_entered(b)


func _physics_process(_delta: float) -> void:
	if _pad_snapped:
		return
	# Wait a few physics frames: lets the map's collision appear, and ignores Duos that were
	# still at the world origin for a frame before being moved to their spawn.
	_physics_frames += 1
	if _physics_frames < 3:
		return
	_pad_snapped = true
	for b in get_overlapping_bodies():
		_on_body_entered(b)
	if not snap_pad_to_floor:
		return
	var from := global_position + Vector3.UP * 0.5
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 6.0, 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty():
		_pad.global_position = hit.position + Vector3.UP * 0.04


func _on_body_entered(body: Node3D) -> void:
	if not is_available() or weapon == null or not _pad_snapped:
		return
	if body is Duo and body.alive and body.weapons.give(weapon):
		_timer = respawn_time
		_holder.visible = false
		picked_up.emit(body, weapon)
