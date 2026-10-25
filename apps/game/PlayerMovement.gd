extends CharacterBody3D

class_name PlayerMovement

const SPEED = 5.0
const JUMP_VELOCITY = 4.5
const MOUSE_SENSITIVITY = 0.003

@onready var head = $head
@onready var camera = $head/Camera3D
@onready var health_system = $HealthSystem
@onready var inventory_system = $WeaponSystem

func _ready():
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event):
	if event is InputEventMouseMotion:
		rotate_y(-event.relative.x * MOUSE_SENSITIVITY)
		head.rotate_x(-event.relative.y * MOUSE_SENSITIVITY)
		# head.rotation.x -= event.relative.y * MOUSE_SENSITIVITY
		head.rotation.x = clamp(head.rotation.x, deg_to_rad(-89), deg_to_rad(89))

func _physics_process(delta: float) -> void:
	# Add the gravity.
	if not is_on_floor():
		velocity += get_gravity() * delta

	# Handle jump.
	if Input.is_action_just_pressed("ui_accept") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	# Get the input direction and handle the movement/deceleration.
	# As good practice, you should replace UI actions with custom gameplay actions.
	var input_dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	if direction:
		velocity.x = direction.x * SPEED
		velocity.z = direction.z * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)
		velocity.z = move_toward(velocity.z, 0, SPEED)

	move_and_slide()

func modify_health(add: int) -> void:
	
	if health_system.has_method("addHealth"):
		health_system.addHealth(add)

func modify_armor(add: int) -> void:
	if health_system.has_method("addArmor"):
		health_system.addArmor(add)

func modify_ammo(weapon, amt) -> void:
	if inventory_system.has_method("addAmmo"):
		inventory_system.addAmmo(weapon, amt)
		
	
