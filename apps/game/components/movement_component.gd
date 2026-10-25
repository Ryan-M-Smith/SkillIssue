## Lower body: reads move / jump / crouch intent → velocity, gravity, crouch height.
class_name MovementComponent
extends Node

enum ForwardMode {
	AIM_RELATIVE,  ## "forward" = where the gunner is looking (easier to learn)
	TANK,          ## "forward" = where the legs face; tilting left/right turns the legs (more talking!)
}

@export var stats: MovementStats
@export var forward_mode: ForwardMode = ForwardMode.AIM_RELATIVE
@export var body: CharacterBody3D
@export var legs: Node3D
@export var torso: Node3D
@export var collision: CollisionShape3D
@export var jump_buffer_time := 0.15     ## a JUMP tap just before landing still counts

var crouching := false
## Power-ups scale walking / sprinting / crouching speed (1 = normal). Set by the Duo.
var speed_scale := 1.0
var _crouch_amount := 0.0                ## 0 = standing, 1 = fully crouched
var _jump_buffer := 0.0
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)


func reset() -> void:
	crouching = false
	_crouch_amount = 0.0
	_jump_buffer = 0.0
	_apply_crouch()
	body.velocity = Vector3.ZERO


func tick(input: DuoInput, delta: float) -> void:
	# --- direction
	var dir := Vector3.ZERO
	if forward_mode == ForwardMode.AIM_RELATIVE:
		var yaw := torso.global_rotation.y
		var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var right := Vector3(cos(yaw), 0.0, -sin(yaw))
		dir = right * input.move.x + fwd * input.move.y
	else:
		legs.rotation.y -= input.move.x * stats.tank_turn_speed * delta
		var ly := legs.global_rotation.y
		dir = Vector3(-sin(ly), 0.0, -cos(ly)) * input.move.y

	# --- crouch (stay down if something is above our head)
	var want_crouch := input.crouch
	if not want_crouch and crouching and _blocked_above():
		want_crouch = true
	crouching = want_crouch
	_crouch_amount = move_toward(_crouch_amount, 1.0 if crouching else 0.0, stats.crouch_speed_lerp * delta)
	_apply_crouch()

	# --- horizontal velocity (sprint only speeds up forward movement, never a crouch)
	var sprinting := input.sprint and not crouching and input.move.y > 0.1
	var base_speed: float = stats.sprint_speed if sprinting else stats.walk_speed
	var speed := lerpf(base_speed, stats.crouch_speed, _crouch_amount)
	var target := dir * speed * speed_scale
	var accel := stats.ground_accel if body.is_on_floor() else stats.air_accel
	var h := Vector3(body.velocity.x, 0.0, body.velocity.z).move_toward(target, accel * delta)
	body.velocity.x = h.x
	body.velocity.z = h.z

	# --- jump + gravity
	if input.jump:
		_jump_buffer = jump_buffer_time
	_jump_buffer = maxf(_jump_buffer - delta, 0.0)
	if body.is_on_floor():
		if _jump_buffer > 0.0:
			body.velocity.y = stats.jump_velocity
			_jump_buffer = 0.0
	else:
		body.velocity.y -= _gravity * stats.gravity_scale * delta

	body.move_and_slide()

	# --- legs face the way we walk (aim-relative mode)
	if forward_mode == ForwardMode.AIM_RELATIVE and h.length() > 0.5:
		legs.rotation.y = lerp_angle(legs.rotation.y, atan2(-h.x, -h.z), 12.0 * delta)


func current_height() -> float:
	return lerpf(stats.stand_height, stats.crouch_height, _crouch_amount)


func _apply_crouch() -> void:
	var height := current_height()
	var capsule := collision.shape as CapsuleShape3D
	if capsule:
		capsule.height = height
	collision.position.y = height * 0.5
	torso.position.y = -(stats.stand_height - height)


func _blocked_above() -> bool:
	var rise := stats.stand_height - current_height()
	return rise > 0.01 and body.test_move(body.global_transform, Vector3(0.0, rise, 0.0))
