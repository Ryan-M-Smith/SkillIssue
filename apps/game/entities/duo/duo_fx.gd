## Raccoon reactions, all visual (no gameplay rules here):
##   - spawn protection: the coat shimmers while the Duo can't be hurt
##   - headshot: the fedora flies off (comes back on respawn)
##   - death: the two raccoons tumble out of the coat in opposite directions
## Debris pieces are copies of the model on the shared world layer, so BOTH screens see them,
## and they never block bullets or players.
class_name DuoFx
extends Node

@export var duo: Duo
@export var hat_path: NodePath = ^"Torso/Head/Model/Fedora"
@export var hat_pop_speed := 4.5
@export var split_up_speed := 4.0
@export var split_side_speed := 2.2
@export var debris_lifetime := 3.0

const DEBRIS_LAYER := 1 << 4     # physics layer 5: collides with the world only

## The last zone that took damage, so the kill feed can mark headshot kills.
var last_hit_zone: int = Hurtbox.Zone.BODY
var _hat: Node3D
var _hat_gone := false


func _ready() -> void:
	if duo == null:
		duo = owner as Duo
	_hat = duo.get_node_or_null(hat_path) as Node3D
	for h in duo.find_children("*", "Area3D", true, false):
		if h is Hurtbox:
			(h as Hurtbox).hit_taken.connect(_on_hit_taken)
	# connected before Duo._ready hides the body, so the model is still in place when we copy it
	# (Duo's @onready shortcuts aren't set yet at this point, so look the node up directly)
	(duo.get_node("Components/Health") as HealthComponent).died.connect(_on_died)
	duo.respawned.connect(_on_respawned)


func _process(_delta: float) -> void:
	if duo.team and duo.health:
		var shield := duo.health.is_protected() and duo.alive
		duo.team.set_shimmer(shield, Time.get_ticks_msec() / 1000.0)


func _on_hit_taken(_amount: float, zone: int, source: Node) -> void:
	last_hit_zone = zone
	if zone == Hurtbox.Zone.HEAD:
		_pop_hat(source)


func _pop_hat(source: Node) -> void:
	if _hat == null or _hat_gone or not _hat.is_visible_in_tree():
		return
	_hat_gone = true
	var away := Vector3.UP
	if source is Node3D:
		var d := duo.global_position - (source as Node3D).global_position
		d.y = 0.0
		if d.length() > 0.01:
			away = d.normalized()
	var body := _debris(_hat.global_transform, [_hat], BoxShape3D.new(), Vector3(0.6, 0.25, 0.55), Vector3.ZERO)
	body.linear_velocity = away * 2.0 + Vector3.UP * hat_pop_speed
	body.angular_velocity = Vector3(randf_range(-8, 8), randf_range(-4, 4), randf_range(-8, 8))
	_hat.visible = false


func _on_died(_killer: Node) -> void:
	var torso := duo.torso
	var side := torso.global_basis.x
	# top raccoon: coat top, arms, head, hat (if still on), gun
	var top_parts: Array[Node3D] = [duo.get_node("Torso/Model") as Node3D, duo.get_node("Torso/Head/Model") as Node3D]
	var top := _debris(torso.global_transform, top_parts, BoxShape3D.new(), Vector3(0.6, 0.9, 0.5), Vector3(0, 1.3, 0))
	top.linear_velocity = side * split_side_speed + Vector3.UP * split_up_speed
	top.angular_velocity = torso.global_basis.z * -3.0 + Vector3(0, randf_range(-2, 2), 0)
	# bottom raccoon: skirt, face in the coat, legs
	var legs := duo.legs
	var bottom := _debris(legs.global_transform, [duo.get_node("Legs/Model") as Node3D], BoxShape3D.new(), Vector3(0.7, 0.9, 0.55), Vector3(0, 0.5, 0))
	bottom.linear_velocity = -side * split_side_speed + Vector3.UP * split_up_speed * 0.6
	bottom.angular_velocity = torso.global_basis.z * 3.0


func _on_respawned() -> void:
	_hat_gone = false
	last_hit_zone = Hurtbox.Zone.BODY
	if _hat:
		_hat.visible = true


## A short-lived rigid body carrying COPIES of the given model parts, placed exactly where they are.
func _debris(at: Transform3D, parts: Array, shape: BoxShape3D, size: Vector3, center: Vector3) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.collision_layer = DEBRIS_LAYER
	body.collision_mask = 1
	body.mass = 1.0
	body.center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	body.center_of_mass = center
	var cs := CollisionShape3D.new()
	shape.size = size
	cs.shape = shape
	cs.position = center
	body.add_child(cs)
	for p in parts:
		var part := p as Node3D
		if part == null:
			continue
		var copy := part.duplicate(Node.DUPLICATE_GROUPS) as Node3D   # no scripts (no leg animator)
		copy.visible = true
		body.add_child(copy)
		copy.transform = at.affine_inverse() * part.global_transform
		for m in copy.find_children("*", "VisualInstance3D", true, false):
			(m as VisualInstance3D).layers = 1     # world layer: both teams see it
		if copy is VisualInstance3D:
			(copy as VisualInstance3D).layers = 1
	duo.get_parent().add_child(body)
	body.global_transform = at
	get_tree().create_timer(debris_lifetime).timeout.connect(body.queue_free)
	return body
