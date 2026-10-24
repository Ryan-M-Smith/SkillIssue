## Procedural leg animation for the Duo's lower half (no animation files needed).
## Swings the hips while walking, tucks the legs mid-air, and squashes the legs when crouching.
## Swap the crude boxes for a real model later: keep the LeftHip / RightHip pivots (or
## point the exports at your model's hip bones/nodes) and this keeps working.
class_name DuoLegsAnimator
extends Node3D

@export var body: CharacterBody3D
@export var movement: MovementComponent
@export var left_hip: Node3D
@export var right_hip: Node3D
@export var pelvis: Node3D               ## bobs up and down a little while walking

@export var stride_per_meter := 2.6      ## leg cycles per meter walked
@export var max_swing_degrees := 38.0
@export var bob_height := 0.05
@export var air_tuck_degrees := 25.0

var _phase := 0.0
var _swing := 0.0
var _pelvis_base := Vector3.ZERO


func _ready() -> void:
	if pelvis:
		_pelvis_base = pelvis.position


func _process(delta: float) -> void:
	if body == null:
		return
	var v := Vector3(body.velocity.x, 0.0, body.velocity.z)
	var speed := v.length()
	var max_speed := movement.stats.walk_speed if movement and movement.stats else 6.0
	var amount := clampf(speed / max_speed, 0.0, 1.0)

	# Walk cycle (only advances on the ground)
	var grounded := body.is_on_floor()
	if grounded:
		_phase = fmod(_phase + speed * stride_per_meter * delta, TAU)
	var target_swing := deg_to_rad(max_swing_degrees) * amount if grounded else 0.0
	_swing = lerpf(_swing, target_swing, clampf(delta * 10.0, 0.0, 1.0))

	# Walking backwards? swing the other way so it looks right.
	var dir_sign := -1.0 if speed > 0.1 and v.normalized().dot(legs_forward()) < -0.3 else 1.0

	var s := sin(_phase) * _swing * dir_sign
	var tuck := 0.0 if grounded else deg_to_rad(air_tuck_degrees)
	if left_hip:
		left_hip.rotation.x = s + tuck
	if right_hip:
		right_hip.rotation.x = -s + tuck

	# Pelvis bob: twice per cycle
	if pelvis:
		pelvis.position = _pelvis_base + Vector3(0, absf(sin(_phase)) * bob_height * amount, 0)

	# Crouch: squash the whole lower half to match the shrunken collision capsule
	if movement and movement.stats:
		scale.y = movement.current_height() / movement.stats.stand_height


## The legs' facing direction in world space (the feet point this way, -Z).
func legs_forward() -> Vector3:
	var f := -global_basis.z
	return Vector3(f.x, 0.0, f.z).normalized()
