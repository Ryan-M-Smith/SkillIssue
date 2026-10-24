## Upper body: reads aim intent → Torso yaw (turn) and Head pitch (look up/down).
class_name AimComponent
extends Node

@export var stats: AimStats
@export var torso: Node3D
@export var head: Node3D
@export var weapons: WeaponComponent     ## optional — slows aim while scoped


func tick(input: DuoInput, _delta: float) -> void:
	var s := stats.sensitivity
	if weapons and weapons.scoped:
		s *= stats.scoped_multiplier
	torso.rotation.y -= input.aim_delta.x * s
	var limit := deg_to_rad(stats.pitch_limit_degrees)
	head.rotation.x = clampf(head.rotation.x + input.aim_delta.y * s, -limit, limit)


func face(yaw: float) -> void:
	torso.rotation.y = yaw
	head.rotation.x = 0.0
