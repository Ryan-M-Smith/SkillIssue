## Short-lived bullet streak. Spawned by WeaponComponent; visible on both screens.
class_name Tracer
extends MeshInstance3D

var _life := 0.08
var _max := 0.08
var _mat: StandardMaterial3D


static func spawn(parent: Node, from: Vector3, to: Vector3, color: Color) -> void:
	var length := from.distance_to(to)
	if parent == null or length < 0.05:
		return
	var t := Tracer.new()
	var m := BoxMesh.new()
	m.size = Vector3(0.03, 0.03, length)
	t.mesh = m
	t._mat = StandardMaterial3D.new()
	t._mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	t._mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	t._mat.albedo_color = color
	t.material_override = t._mat
	t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(t)
	var dir := (to - from) / length
	var up := Vector3.UP if absf(dir.dot(Vector3.UP)) < 0.99 else Vector3.RIGHT
	t.global_transform = Transform3D(Basis.looking_at(dir, up), (from + to) * 0.5)


func _process(delta: float) -> void:
	_life -= delta
	_mat.albedo_color.a = clampf(_life / _max, 0.0, 1.0)
	if _life <= 0.0:
		queue_free()
