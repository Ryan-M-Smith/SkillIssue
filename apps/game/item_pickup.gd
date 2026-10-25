extends Area3D

@export var respawn_time: float = 3.0
@export var health_amount: int = 25

# Adjust $CSGSphere3D to match whatever your visual child node is named
@onready var visual_mesh = $CollisionShape3D/Pickup 
@onready var collision_shape: CollisionShape3D = $CollisionShape3D
@export var armor_collision_shape: CollisionShape3D
@export var armor_visual_mesh: CSGSphere3D


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	# Detect players (the mask) without being something bullets can hit: guns ray-cast the
	# world and hurtbox layers, so a pickup on those layers would stop shots. Layer 0 = nothing
	# hits it; the mask is untouched, so walking into it still works.
	collision_layer = 0



# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass


func _on_body_entered(body: Node3D) -> void:
	if body is Duo:
		if ('health' in name) or ('Health' in name): 
			print('has health')
			if body.has_method("modify_health"):
				print('Player got health')
				body.modify_health(20)
				respawn()
	
		if ('armor' in name) or ('Armor' in name):
			if body.has_method("modify_armor"):
				print('Player got armor')
				body.modify_armor(20)
				respawn()
				
		if ('shotgun' in name) or ('Shotgun' in name) or ('sniper' in name) or ('Sniper' in name):
			if 'Shotgun' in name: 
				if body.has_method("modify_ammo"):
					body.modify_ammo(1, 10)
					respawn()
			else:
				if body.has_method("modify_ammo"):
					body.modify_ammo(2, 5)
					respawn()


func respawn() -> void:
	visual_mesh.visible = false
	collision_shape.set_deferred("disabled", true) 
				
	await get_tree().create_timer(respawn_time).timeout
				
	visual_mesh.visible = true
	collision_shape.set_deferred("disabled", false)
