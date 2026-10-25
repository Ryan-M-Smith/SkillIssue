## Arena v2: Brian's arena (arena_box.tscn, instanced unchanged as "Base") plus a multi-level,
## Quake-style layout on top: a center tower (deck + crow's nest), two side towers, bridges,
## ramps, and cover on every level with walkable space underneath.
## Brian keeps owning the base layout: spawns, gun spots and floor come from his file, so his
## edits still show up here. At runtime this script lifts the sniper spot onto the crow's nest and switches off
## two leftovers:
##   - the old single-player test character (PlayerMovement) standing in the middle
##   - the health/armor spheres, which only work with that old test character
## Nothing is saved into arena_box.tscn.
extends Node3D

@export var disable_test_player := true
@export var disable_health_armor_pickups := true
## Lift the map's sniper spot (Brian's SniperSpawnObject at the center) onto the top of the
## center tower, so the sniper sits on the highest, most exposed spot. (0,0,0) = leave it.
@export var sniper_spot_offset := Vector3(0, 4.0, 0)


func _ready() -> void:
	var base := get_node_or_null("Base")
	if base == null:
		return
	if disable_test_player:
		for n in base.find_children("*", "CharacterBody3D", true, false):
			if n.is_in_group("Player"):
				_switch_off(n)
	if sniper_spot_offset != Vector3.ZERO:
		for n in base.find_children("*", "Area3D", true, false):
			if String(n.name).to_lower().contains("sniper"):
				(n as Node3D).global_position += sniper_spot_offset
	if disable_health_armor_pickups:
		for n in base.find_children("*", "Area3D", true, false):
			var lower := String(n.name).to_lower()
			if lower.contains("health") or lower.contains("armor"):
				_switch_off(n)


func _switch_off(n: Node) -> void:
	n.process_mode = Node.PROCESS_MODE_DISABLED
	if n is Node3D:
		(n as Node3D).visible = false
	if n is CollisionObject3D:
		(n as CollisionObject3D).collision_layer = 0
		(n as CollisionObject3D).collision_mask = 0
	if n is Area3D:
		(n as Area3D).set_deferred("monitoring", false)
	for cam in n.find_children("*", "Camera3D", true, false):
		(cam as Camera3D).current = false
