## One frame of intent for a Duo. Controllers write into it; components only read it.
## The Duo resets it every physics frame and then lets each controller add its share,
## so phones and keyboard can drive the same Duo at the same time.
class_name DuoInput
extends RefCounted

# --- mover (lower body)
var move := Vector2.ZERO        ## x = right, y = forward, length 0..1
var jump := false               ## pressed this frame
var crouch := false             ## held
var sprint := false             ## held (the phone toggles it; the game just reads the state)
# --- gunner (upper body)
var aim_delta := Vector2.ZERO   ## radians this frame; x = turn right, y = look up
var fire := false               ## held
var reload := false             ## pressed this frame
var scope_toggle := false       ## pressed this frame
var weapon_slot := -1           ## requested slot this frame, -1 = none
var weapon_cycle := 0           ## +1 next gun / -1 previous gun this frame (skips guns you don't own)


func reset() -> void:
	move = Vector2.ZERO
	jump = false
	crouch = false
	sprint = false
	aim_delta = Vector2.ZERO
	fire = false
	reload = false
	scope_toggle = false
	weapon_slot = -1
	weapon_cycle = 0


func clamp_values() -> void:
	move = move.limit_length(1.0)
