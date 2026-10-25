extends Node3D

var health = 100
var armor = 0

const MAX_HEALTH = 100
const MAX_ARMOR = 100

# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.

func addHealth(add: int) -> void:
	
	print('health added: ', add)
	
	var new_hp = health + add
	
	if new_hp > MAX_HEALTH:
		var diff = new_hp - MAX_HEALTH
		new_hp -= diff
	
	health = new_hp
	
func addArmor(add: int) -> void:
	
	print('armor added: ', add)
	
	var new_arm = armor + add
	
	if new_arm > MAX_ARMOR:
		var diff = new_arm - MAX_ARMOR
		new_arm -= diff
		
	armor = new_arm

func takeDamage(dam: int) -> void:
	
	if armor > 0: # if you have armor -> get damage absorbed
		var dam_absorb = min(dam, armor)
		var dam_remain = dam - dam_absorb
		
		armor -= dam # apply the damage
		
		health -= dam_absorb * 0.5
		health -= dam_remain
	
	else:
		health -= dam
		
	
	if health <= 0:
		# kill player
		# respawn
		pass
	
	pass

# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass
