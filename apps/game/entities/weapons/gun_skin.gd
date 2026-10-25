## Puts a gun's model (WeaponData.model_scene) inside a MeshInstance3D "host", so the same
## pistol / shotgun / sniper model is used for the first-person gun, the gun the enemy sees,
## and the floating pickup. Falls back to the old colored box if a gun has no model yet.
##
## Model convention (entities/weapons/models/*.tscn): origin = the grip, barrel points -Z,
## and a Marker3D called "Muzzle" sits at the barrel tip (tracers start there).
class_name GunSkin
extends RefCounted

const SKIN_NAME := "Skin"


## Replaces whatever gun `host` shows. Returns the new model (or null for the box fallback).
static func attach(host: MeshInstance3D, data: WeaponData, model_scale: float) -> Node3D:
	clear(host)
	if data == null:
		return null
	if data.model_scene == null:
		var m := BoxMesh.new()
		m.size = data.model_size * model_scale
		host.mesh = m
		var mat := StandardMaterial3D.new()
		mat.albedo_color = data.color
		mat.metallic = 0.3
		mat.roughness = 0.4
		host.material_override = mat
		return null
	var skin := data.model_scene.instantiate() as Node3D
	skin.name = SKIN_NAME
	skin.scale = Vector3.ONE * model_scale
	host.add_child(skin)
	for mesh in skin.find_children("*", "MeshInstance3D", true, false):
		mesh.layers = host.layers           # same render layer as the host (own gun vs enemy-visible gun)
		mesh.add_to_group("no_tint")        # keep the gun's own colors (TeamComponent skips these)
	return skin


static func clear(host: MeshInstance3D) -> void:
	host.mesh = null
	host.material_override = null
	var old := host.get_node_or_null(SKIN_NAME)
	if old:
		host.remove_child(old)
		old.queue_free()


static func get_skin(host: MeshInstance3D) -> Node3D:
	return host.get_node_or_null(SKIN_NAME) as Node3D


## Where the barrel tip is, in the host's space.
static func muzzle_offset(skin: Node3D) -> Vector3:
	var marker := skin.get_node_or_null("Muzzle") as Node3D
	if marker == null:
		return Vector3(0, 0, -0.4) * skin.scale.x
	return marker.position * skin.scale.x


## Sniper scope glint (a hidden "Glint" mesh in the model). Shown on the ENEMY-visible gun while scoped.
static func set_glint(host: MeshInstance3D, on: bool) -> void:
	if host == null:
		return
	var skin := get_skin(host)
	if skin == null:
		return
	var glint := skin.get_node_or_null("Glint") as Node3D
	if glint:
		glint.visible = on
