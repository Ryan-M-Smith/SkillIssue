## Reads fire / scope / weapon-slot intent. Hitscan from the Head (= the camera) so
## the shot goes exactly where the gunner's crosshair is. Tracers start at the Muzzle.
class_name WeaponComponent
extends Node

signal weapon_changed(index: int, data: WeaponData)
signal fired(data: WeaponData)
signal scope_changed(scoped: bool)
signal hit_confirmed(target: Node, damage: float, headshot: bool)

@export var loadout: Array[WeaponData] = []    ## slot order = phone buttons (pistol, shotgun, sniper)
@export var body: CharacterBody3D
@export var aim_origin: Node3D
@export var muzzle: Marker3D
@export var view_model: MeshInstance3D
## Optional: the gun in the Duo's hands that the ENEMY sees (on the body render layer).
@export var third_person_gun: MeshInstance3D
@export var third_person_scale := 1.3
@export_flags_3d_physics var hit_mask := 1 | 4   ## world + hurtbox
@export var view_model_scale := 0.8             ## first-person gun is drawn smaller than the pickup
## Optional: lets spread react to walking / jumping / crouching.
@export var movement: MovementComponent

var owned: Array[bool] = []
var current := 0
var scoped := false

var _cooldown := 0.0
var _fire_was := false
var _excluded: Array[RID] = []
var _vm_base := Vector3.ZERO
var _kick := 0.0
var _bloom := 0.0


func _ready() -> void:
	_vm_base = view_model.position
	reset_loadout()


func reset_loadout() -> void:
	owned.clear()
	for i in loadout.size():
		owned.append(i == 0)
	_cooldown = 0.0
	_bloom = 0.0
	select(0, true)


func set_excluded(rids: Array[RID]) -> void:
	_excluded = rids


func current_data() -> WeaponData:
	return loadout[current] if current < loadout.size() else null


## Pickups call this. Returns true if it was a new gun (pickup gets consumed).
func give(data: WeaponData) -> bool:
	var i := loadout.find(data)
	if i == -1 or owned[i]:
		return false
	owned[i] = true
	select(i)
	return true


func select(i: int, force := false) -> void:
	if i < 0 or i >= loadout.size() or not owned[i]:
		return
	if i == current and not force:
		return
	current = i
	_set_scoped(false)
	_cooldown = maxf(_cooldown, 0.25)   # small swap delay
	_update_view_model()
	weapon_changed.emit(i, loadout[i])


func tick(input: DuoInput, delta: float) -> void:
	_cooldown -= delta
	if input.weapon_slot >= 0:
		select(input.weapon_slot)
	var data := current_data()
	if data == null:
		return
	if input.scope_toggle and data.has_scope:
		_set_scoped(not scoped)
	if input.fire and _cooldown <= 0.0 and (data.automatic or not _fire_was):
		_shoot(data)
	_fire_was = input.fire
	_bloom = move_toward(_bloom, 0.0, data.bloom_recovery * delta)
	# view-model recoil
	_kick = move_toward(_kick, 0.0, delta * 0.6)
	view_model.position = _vm_base + Vector3(0, _kick * 0.3, _kick)


func _set_scoped(on: bool) -> void:
	if scoped == on:
		return
	scoped = on
	view_model.visible = not on
	scope_changed.emit(on)


## The spread cone (half-angle, degrees) the NEXT shot would use, from the gun's data
## plus what the mover is doing right now. The sandbox draws this as the spread circle.
func current_spread_degrees() -> float:
	var data := current_data()
	if data == null:
		return 0.0
	var s := (data.scoped_spread_degrees if scoped else data.spread_degrees) + _bloom
	if body:
		var walk := movement.stats.walk_speed if movement and movement.stats else 6.0
		var speed := Vector2(body.velocity.x, body.velocity.z).length()
		s += data.moving_spread_add * clampf(speed / walk, 0.0, 1.0)
		if not body.is_on_floor():
			s += data.airborne_spread_add
	if movement and movement.crouching:
		s *= data.crouch_spread_multiplier
	return maxf(s, 0.0)


## Direction offsets (x, y) inside a cone of radius 1, one per pellet.
static func pellet_offsets(data: WeaponData) -> Array[Vector2]:
	var out: Array[Vector2] = []
	var n := maxi(data.pellets, 1)
	if data.spread_pattern == WeaponData.SpreadPattern.RING and n > 1:
		out.append(Vector2.ZERO)
		for i in n - 1:
			var a := TAU * float(i) / float(n - 1)
			out.append(Vector2(cos(a), sin(a)))
	else:
		for i in n:
			var r := sqrt(randf())
			var a := randf() * TAU
			out.append(Vector2(cos(a) * r, sin(a) * r))
	return out


func _shoot(data: WeaponData) -> void:
	_cooldown = data.fire_interval
	_kick = 0.08
	var space := body.get_world_3d().direct_space_state
	var origin := aim_origin.global_position
	var basis := aim_origin.global_basis.orthonormalized()
	var spread := tan(deg_to_rad(current_spread_degrees()))
	_bloom = minf(_bloom + data.bloom_per_shot, data.max_bloom)
	var source: Node = owner if owner else body
	for off in pellet_offsets(data):
		var dir := (-basis.z + basis.x * off.x * spread + basis.y * off.y * spread).normalized()
		var to := origin + dir * data.max_range
		var q := PhysicsRayQueryParameters3D.create(origin, to, hit_mask, _excluded)
		q.collide_with_areas = true
		var hit := space.intersect_ray(q)
		var end := to
		if not hit.is_empty():
			end = hit.position
			var col = hit.collider
			if col is Hurtbox:
				var dealt: float = col.take_hit(data.damage, data.headshot_multiplier, source)
				if dealt > 0.0:
					hit_confirmed.emit(col.health.owner, dealt, col.zone == Hurtbox.Zone.HEAD)
			if data.show_impacts:
				Tracer.spawn_impact(body.get_parent(), end, data.tracer_color, data.impact_size, data.impact_lifetime)
		Tracer.spawn(body.get_parent(), muzzle.global_position, end, data.tracer_color, data.tracer_width, data.tracer_lifetime)
	fired.emit(data)


func _update_view_model() -> void:
	var data := current_data()
	if data == null:
		return
	var m := BoxMesh.new()
	m.size = data.model_size * view_model_scale
	view_model.mesh = m
	var mat := StandardMaterial3D.new()
	mat.albedo_color = data.color
	mat.metallic = 0.3
	mat.roughness = 0.4
	view_model.material_override = mat
	_vm_base.z = -data.model_size.z * view_model_scale * 0.5
	view_model.position = _vm_base
	muzzle.position = Vector3(0, 0, -data.model_size.z * view_model_scale)
	if third_person_gun:
		var tm := BoxMesh.new()
		tm.size = data.model_size * third_person_scale
		third_person_gun.mesh = tm
		third_person_gun.material_override = mat
		third_person_gun.position.z = -data.model_size.z * third_person_scale * 0.5
