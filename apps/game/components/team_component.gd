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
var _dark: StandardMaterial3D        ## darker team color for meshes in the "team_dark" group
var _flash_tween: Tween
var _shimmering := false


func apply(data: TeamData) -> void:
	team = data
	_material = StandardMaterial3D.new()
	_material.albedo_color = data.color
	_material.roughness = 0.55
	_material.emission_enabled = true
	_material.emission = Color.WHITE
	_material.emission_energy_multiplier = 0.0
	_dark = _material.duplicate() as StandardMaterial3D
	_dark.albedo_color = data.color.darkened(0.45)
	for root in [legs, torso]:
		for mesh in root.find_children("*", "MeshInstance3D", true, false):
			if view_model_root.is_ancestor_of(mesh):
				mesh.layers = 1 << (VIEWMODEL_LAYER_BASE + data.id - 1)
				continue
			mesh.layers = 1 << (BODY_LAYER_BASE + data.id - 1)
			if mesh.is_in_group("team_dark"):
				mesh.material_override = _dark
			elif not mesh.is_in_group("no_tint"):
				mesh.material_override = _material


## Spawn-protection shimmer: a soft white pulse on the coat while it's on.
func set_shimmer(on: bool, time: float) -> void:
	if _material == null:
		return
	if on:
		_material.emission_energy_multiplier = 0.25 + 0.25 * sin(time * 12.0)
		if _dark:
			_dark.emission_energy_multiplier = _material.emission_energy_multiplier
		_shimmering = true
	elif _shimmering:
		_shimmering = false
		if not (_flash_tween and _flash_tween.is_valid()):
			_material.emission_energy_multiplier = 0.0
			if _dark:
				_dark.emission_energy_multiplier = 0.0


## Brief white flash on the body so the shooter sees their hit land.
func flash(strength := 1.6, seconds := 0.12) -> void:
	if _material == null:
		return
	if _flash_tween and _flash_tween.is_valid():
		_flash_tween.kill()
	_material.emission_energy_multiplier = strength
	_flash_tween = create_tween()
	_flash_tween.tween_property(_material, "emission_energy_multiplier", 0.0, seconds)
	if _dark:
		_dark.emission_energy_multiplier = strength
		_flash_tween.parallel().tween_property(_dark, "emission_energy_multiplier", 0.0, seconds)


static func body_layer_bit(team_id: int) -> int:
	return 1 << (BODY_LAYER_BASE + team_id - 1)


static func viewmodel_layer_bit(team_id: int) -> int:
	return 1 << (VIEWMODEL_LAYER_BASE + team_id - 1)
