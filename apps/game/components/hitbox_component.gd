## Sizes the Duo's three hurtbox zones (head / body / legs) from a HitboxProfile,
## keeps the legs box matched to crouch, and can draw all zones for tuning.
## Change the model → retune data/hitboxes/*.tres, no code changes.
class_name HitboxComponent
extends Node

@export var profile: HitboxProfile
@export var head: Hurtbox
@export var body: Hurtbox
@export var legs: Hurtbox
@export var movement: MovementComponent      ## optional, for crouch
@export var team: TeamComponent              ## optional: debug boxes go on this team's body layer

var debug_visible := false


func _ready() -> void:
	apply_profile()


func apply_profile() -> void:
	if profile == null:
		return
	if head:
		head.zone = Hurtbox.Zone.HEAD
		head.is_head = true
		head.configure_box(profile.head_size, profile.head_offset)
	if body:
		body.zone = Hurtbox.Zone.BODY
		body.multiplier = profile.body_multiplier
		body.configure_box(profile.body_size, profile.body_offset)
	if legs:
		legs.zone = Hurtbox.Zone.LEGS
		legs.multiplier = profile.legs_multiplier
		legs.configure_box(profile.legs_size, profile.legs_offset)
	_apply_debug()


func _physics_process(_delta: float) -> void:
	if profile == null or legs == null or not profile.legs_follow_crouch:
		return
	if movement == null or movement.stats == null:
		return
	var k := movement.current_height() / movement.stats.stand_height
	var size := profile.legs_size
	var offset := profile.legs_offset
	legs.configure_box(Vector3(size.x, size.y * k, size.z), Vector3(offset.x, offset.y * k, offset.z))


func set_debug_visible(on: bool) -> void:
	debug_visible = on
	_apply_debug()


func _apply_debug() -> void:
	if profile == null:
		return
	# Only the enemy's camera sees a duo's body layer, so each screen shows the OTHER duo's zones.
	var layer := 1
	if team and team.team:
		layer = TeamComponent.body_layer_bit(team.team.id)
	if head:
		head.set_debug_visible(debug_visible, profile.debug_head_color, layer)
	if body:
		body.set_debug_visible(debug_visible, profile.debug_body_color, layer)
	if legs:
		legs.set_debug_visible(debug_visible, profile.debug_legs_color, layer)
