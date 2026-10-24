## Team identity: tints the body and puts meshes on the right render layers so each
## team's camera hides its own body but sees its own gun (and only the enemy's body).
class_name TeamComponent
extends Node

const BODY_LAYER_BASE := 2        ## render layer 2 = team0 body, 3 = team1 body
const VIEWMODEL_LAYER_BASE := 4   ## render layer 4 = team0 gun, 5 = team1 gun

@export var team: TeamData
@export var legs: Node3D
@export var torso: Node3D
@export var view_model_root: Node3D

var _material: StandardMaterial3D
var _flash_tween: Tween


func apply(data: TeamData) -> void:
	team = data
	_material = StandardMaterial3D.new()
	_material.albedo_color = data.color
	_material.roughness = 0.55
	_material.emission_enabled = true
	_material.emission = Color.WHITE
	_material.emission_energy_multiplier = 0.0
	for root in [legs, torso]:
		for mesh in root.find_children("*", "MeshInstance3D", true, false):
			if view_model_root.is_ancestor_of(mesh):
				mesh.layers = 1 << (VIEWMODEL_LAYER_BASE + data.id - 1)
				continue
			mesh.layers = 1 << (BODY_LAYER_BASE + data.id - 1)
			if not mesh.is_in_group("no_tint"):
				mesh.material_override = _material


## Brief white flash on the body so the shooter sees their hit land.
func flash(strength := 1.6, seconds := 0.12) -> void:
	if _material == null:
		return
	if _flash_tween and _flash_tween.is_valid():
		_flash_tween.kill()
	_material.emission_energy_multiplier = strength
	_flash_tween = create_tween()
	_flash_tween.tween_property(_material, "emission_energy_multiplier", 0.0, seconds)


static func body_layer_bit(team_id: int) -> int:
	return 1 << (BODY_LAYER_BASE + team_id - 1)


static func viewmodel_layer_bit(team_id: int) -> int:
	return 1 << (VIEWMODEL_LAYER_BASE + team_id - 1)
