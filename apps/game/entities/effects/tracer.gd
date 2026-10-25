## Short-lived bullet streaks and impact marks. Spawned by WeaponComponent; visible on
## both screens. Width, lifetime, color and impact size come from each gun's WeaponData.
class_name Tracer
extends MeshInstance3D

var _life := 0.08
var _max := 0.08
var _mat: StandardMaterial3D
var _grow := 0.0          ## impacts swell slightly as they fade


static func _make(color: Color, lifetime: float) -> Tracer:
	var t := Tracer.new()
	t._mat = StandardMaterial3D.new()
	t._mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	t._mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	t._mat.albedo_color = color
	t.material_override = t._mat
	t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	t._life = maxf(lifetime, 0.01)
	t._max = t._life
	return t


## A streak from `from` to `to`.
static func spawn(parent: Node, from: Vector3, to: Vector3, color: Color, width := 0.03, lifetime := 0.08) -> void:
	var length := from.distance_to(to)
	if parent == null or length < 0.05 or width <= 0.0:
		return
	var t := _make(color, lifetime)
	var m := BoxMesh.new()
	m.size = Vector3(width, width, length)
	t.mesh = m
	parent.add_child(t)
	var dir := (to - from) / length
	var up := Vector3.UP if absf(dir.dot(Vector3.UP)) < 0.99 else Vector3.RIGHT
	t.global_transform = Transform3D(Basis.looking_at(dir, up), (from + to) * 0.5)


## A small puff where a pellet landed.
static func spawn_impact(parent: Node, at: Vector3, color: Color, size := 0.08, lifetime := 0.15) -> void:
	if parent == null or size <= 0.0:
		return
	var t := _make(color, lifetime)
	var m := BoxMesh.new()
	m.size = Vector3.ONE * size
	t.mesh = m
	t._grow = 1.5
	parent.add_child(t)
	t.global_position = at
	t.rotation = Vector3(randf() * TAU, randf() * TAU, 0)


func _process(delta: float) -> void:
	_life -= delta
	var k := clampf(_life / _max, 0.0, 1.0)
	_mat.albedo_color.a = k
	if _grow > 0.0:
		scale = Vector3.ONE * (1.0 + (1.0 - k) * _grow)
	if _life <= 0.0:
		queue_free()
