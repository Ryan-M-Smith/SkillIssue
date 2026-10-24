class_name MovementStats
extends Resource

@export var walk_speed := 6.0
@export var crouch_speed := 3.0
@export var ground_accel := 40.0
@export var air_accel := 12.0
@export var jump_velocity := 7.0
@export var gravity_scale := 1.6
@export_group("Crouch")
@export var stand_height := 1.8
@export var crouch_height := 1.1
@export var crouch_speed_lerp := 12.0
@export_group("Tank mode")
@export var tank_turn_speed := 2.5          ## rad/s when forward is relative to the legs
