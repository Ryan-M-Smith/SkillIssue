## Where a Duo can be hit, and how much each zone hurts. One file per body shape:
## when the raccoon model changes, retune these numbers (F3 in the sandbox shows them).
##
## Sizes are box sizes in meters. Offsets are the box center, relative to the node the
## zone hangs off: Head zone → Torso/Head, Body zone → Torso, Legs zone → Legs.
## The head zone uses each gun's own headshot_multiplier (sniper 2×, shotgun 1.5×…);
## body and legs use the multipliers below.
class_name HitboxProfile
extends Resource

@export_group("Head (relative to Torso/Head)")
@export var head_size := Vector3(0.54, 0.36, 0.5)
@export var head_offset := Vector3(0, 0.08, 0)

@export_group("Body (relative to Torso)")
@export var body_size := Vector3(0.84, 0.62, 0.56)
@export var body_offset := Vector3(0, 1.22, 0)
@export var body_multiplier := 1.0

@export_group("Legs (relative to Legs)")
@export var legs_size := Vector3(0.62, 0.92, 0.48)
@export var legs_offset := Vector3(0, 0.46, 0)
@export var legs_multiplier := 0.75
## Squash the legs box with crouch, the same way the leg model squashes.
@export var legs_follow_crouch := true

@export_group("Debug view (F3 in the sandbox)")
@export var debug_head_color := Color(1.0, 0.25, 0.25, 0.35)
@export var debug_body_color := Color(1.0, 0.85, 0.2, 0.3)
@export var debug_legs_color := Color(0.3, 0.8, 1.0, 0.3)
