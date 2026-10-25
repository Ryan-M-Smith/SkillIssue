## Tuning for one gun. A new gun = a new .tres file, no new code.
class_name WeaponData
extends Resource

enum SpreadPattern {
	RANDOM,  ## pellets land anywhere inside the spread cone
	RING,    ## one pellet dead center, the rest evenly around the edge (predictable, easy to tune)
}

@export var display_name := "Pistol"
@export var damage := 25.0                 ## per pellet
@export var pellets := 1
@export var fire_interval := 0.3           ## seconds between shots
@export var automatic := true              ## keep firing while FIRE is held
@export var max_range := 100.0
@export var headshot_multiplier := 2.0     ## used when a pellet hits the HEAD zone
@export_range(1, 100) var magazine_size := 12
@export_range(0.1, 10.0) var reload_seconds := 1.25

@export_group("Spread")
@export var spread_degrees := 0.5          ## base cone half-angle, standing still on the ground
@export var spread_pattern: SpreadPattern = SpreadPattern.RANDOM
@export var moving_spread_add := 1.0       ## extra degrees at full walking speed
@export var airborne_spread_add := 3.0     ## extra degrees while jumping / falling
@export var crouch_spread_multiplier := 0.7  ## ×spread while crouched (<1 = tighter)
@export var bloom_per_shot := 0.0          ## extra degrees added by each shot…
@export var max_bloom := 3.0               ## …up to this much…
@export var bloom_recovery := 6.0          ## …and recovering this many degrees per second

@export_group("Scope")
@export var has_scope := false
@export var scope_fov := 20.0
@export var scoped_spread_degrees := 0.0   ## replaces spread_degrees while scoped (movement still adds)

@export_group("Trail")
@export var tracer_color := Color(1.0, 0.9, 0.5)
@export var tracer_width := 0.03           ## meters
@export var tracer_lifetime := 0.08        ## seconds to fade out
@export var show_impacts := true
@export var impact_size := 0.08            ## meters
@export var impact_lifetime := 0.15

@export_group("Look")
@export var color := Color(0.8, 0.8, 0.85)
@export var model_size := Vector3(0.08, 0.12, 0.35)   ## view model / pickup box size
## The gun's model (entities/weapons/models/*.tscn): used in first person, on the Duo the
## enemy sees, and on the floating pickup. Leave empty to use a box of `model_size`.
@export var model_scene: PackedScene
