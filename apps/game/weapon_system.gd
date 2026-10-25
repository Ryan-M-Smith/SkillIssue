extends Node3D

var currentWeapon = 0

var WeaponList = [0, 1, 2, 3]

var WeaponAmmo = [30, 0, 0, 0]

# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.

func Shoot() -> void:
	
	
	match currentWeapon:
		0:
			print('shoot pistol') # shoot gun
			if WeaponAmmo[currentWeapon] > 0:
				WeaponAmmo[currentWeapon] -= 1
			else:
				print('no ammo')
		1:
			print('shoot shotgun')
			if WeaponAmmo[currentWeapon] > 0:
				WeaponAmmo[currentWeapon] -= 1
			else:
				print('no ammo')
		2: 
			print('shoot sniper')
			if WeaponAmmo[currentWeapon] > 0:
				WeaponAmmo[currentWeapon] -= 1
			else:
				print('no ammo')
		3: 
			print('shoot rpg')
			if WeaponAmmo[currentWeapon] > 0:
				WeaponAmmo[currentWeapon] -= 1
			else:
				print('no ammo')
	
	pass
	

func SwitchWeapon(new: int) -> void:
	
	if new in WeaponList:
		currentWeapon = new
	
	pass
	
func addAmmo(weapon: int, amt: int) -> void:
	
	if weapon in WeaponList:
		WeaponAmmo[weapon] += amt
		print("weapon: ", weapon, " got, ", amt)
	
	pass

# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	
	if Input.is_action_just_pressed("fire"):
		Shoot()
	
	pass
