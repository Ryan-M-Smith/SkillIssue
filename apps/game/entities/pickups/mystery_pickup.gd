## Mystery box: a see-through red/blue cube. Grab it for a random effect: usually a buff
## (One-Shot Round, Extra Damage, Scrambler, Speed), sometimes a debuff (Inverted, Slowed).
## See components/powerup_component.gd for the effects and their odds.
## Placeholder art: swap _build_visual() for a real model when there is one.
class_name MysteryPickup
extends ArenaPickup

const SHADER := preload("res://entities/pickups/mystery_box.gdshader")

## The effect the last pickup rolled (for the HUD / tests).
var last_effect := -1
var rng := RandomNumberGenerator.new()


func _init() -> void:
	respawn_time = 20.0
	spin_speed = 0.9
	pad_color = Color(0.75, 0.45, 0.9)
	rng.randomize()


func _build_visual() -> Node3D:
	var root := Node3D.new()
	root.name = "Box"
	var cube := MeshInstance3D.new()
	cube.name = "Cube"
	var box := BoxMesh.new()
	box.size = Vector3(0.7, 0.7, 0.7)
	cube.mesh = box
	var mat := ShaderMaterial.new()
	mat.shader = SHADER
	cube.material_override = mat
	cube.rotation = Vector3(deg_to_rad(20.0), 0.0, deg_to_rad(15.0))   # tilted, like it's tumbling
	cube.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(cube)
	# A small bright core so it reads as "something inside", and a soft light so it stands
	# out from the map even in the dark.
	var core := MeshInstance3D.new()
	core.name = "Core"
	var core_mesh := BoxMesh.new()
	core_mesh.size = Vector3(0.18, 0.18, 0.18)
	core.mesh = core_mesh
	core.material_override = ArenaPickup.glow_material(Color(1.0, 0.95, 0.9), 2.0)
	root.add_child(core)
	var light := OmniLight3D.new()
	light.name = "Glow"
	light.light_color = Color(0.8, 0.5, 0.95)
	light.light_energy = 1.2
	light.omni_range = 3.5
	root.add_child(light)
	return root


func _give(duo: Duo) -> bool:
	if duo.powerups == null:
		return false
	last_effect = PowerupComponent.roll(rng)
	duo.powerups.apply(last_effect)
	return true
