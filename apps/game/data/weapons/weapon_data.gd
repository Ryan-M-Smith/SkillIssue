## Tuning for one gun. A new gun = a new .tres file, no new code.
class_name WeaponData
extends Resource

@export var display_name := "Pistol"
@export var damage := 25.0                 ## per pellet
@export var pellets := 1
@export var spread_degrees := 0.5          ## cone half-angle per shot
@export var fire_interval := 0.3           ## seconds between shots
@export var automatic := true              ## keep firing while FIRE is held
@export var max_range := 100.0
@export var headshot_multiplier := 2.0
@export_group("Scope")
@export var has_scope := false
@export var scope_fov := 20.0
@export var scoped_spread_degrees := 0.0
@export_group("Look")
@export var color := Color(0.8, 0.8, 0.85)
@export var tracer_color := Color(1.0, 0.9, 0.5)
@export var model_size := Vector3(0.08, 0.12, 0.35)   ## view model / pickup box size
