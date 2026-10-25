## Area that bullets hit. Points at a HealthComponent. Its zone decides the damage:
## HEAD uses the gun's headshot_multiplier, BODY / LEGS use `multiplier` (set from the
## HitboxProfile by HitboxComponent). Shape size/position can be changed at runtime.
class_name Hurtbox
extends Area3D

enum Zone { HEAD, BODY, LEGS }

@export var health: HealthComponent
@export var zone: Zone = Zone.BODY
@export var multiplier := 1.0
## Kept for older code: true when zone == HEAD.
@export var is_head := false

var _layer := 0
var _shape_node: CollisionShape3D
var _debug_mesh: MeshInstance3D


func _ready() -> void:
	_layer = collision_layer
	if is_head:
		zone = Zone.HEAD
	is_head = zone == Zone.HEAD
	for c in get_children():
		if c is CollisionShape3D:
			_shape_node = c
			break


## Returns the damage actually dealt.
func take_hit(amount: float, headshot_multiplier: float, source: Node) -> float:
	if health == null or health.dead:
		return 0.0
	var mult := headshot_multiplier if zone == Zone.HEAD else multiplier
	var dmg := amount * mult
	health.apply_damage(dmg, source)
	return dmg


func set_enabled(on: bool) -> void:
	collision_layer = _layer if on else 0


## Resize / move this zone to a box. Each Hurtbox gets its own shape, so duos never share one.
func configure_box(size: Vector3, offset: Vector3) -> void:
	if _shape_node == null:
		_shape_node = CollisionShape3D.new()
		add_child(_shape_node)
	var box := _shape_node.shape as BoxShape3D
	if box == null or not box.resource_local_to_scene:
		box = BoxShape3D.new()
		box.resource_local_to_scene = true
		_shape_node.shape = box
	box.size = size
	_shape_node.position = offset
	_shape_node.rotation = Vector3.ZERO
	if _debug_mesh:
		(_debug_mesh.mesh as BoxMesh).size = size
		_debug_mesh.position = offset


## Draws the zone as a see-through box on `layer` (the owner's body layer, so only the
## ENEMY camera sees it; your own boxes would otherwise wrap around your own camera).
func set_debug_visible(on: bool, color: Color, layer := 1) -> void:
	if on and _debug_mesh == null:
		_debug_mesh = MeshInstance3D.new()
		_debug_mesh.name = "DebugBox"
		var m := BoxMesh.new()
		_debug_mesh.mesh = m
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.no_depth_test = true
		_debug_mesh.material_override = mat
		_debug_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_debug_mesh)
		if _shape_node and _shape_node.shape is BoxShape3D:
			m.size = (_shape_node.shape as BoxShape3D).size
			_debug_mesh.position = _shape_node.position
	if _debug_mesh:
		(_debug_mesh.material_override as StandardMaterial3D).albedo_color = color
		_debug_mesh.layers = layer
		_debug_mesh.visible = on
