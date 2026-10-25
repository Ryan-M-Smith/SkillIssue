extends Area3D


# Called when the node enters the scene tree for the first time.
func _ready() -> void:
	pass # Replace with function body.



# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta: float) -> void:
	pass


func _on_body_entered(body: Node3D) -> void:
	# print('touched', name)
	
	if body is PlayerMovement:
		if body.has_method("modify_health"):
			print('Player got health')
			body.modify_health(20)
	
	pass # Replace with function body.


func _on_armor_pickup_object_body_entered(body: Node3D) -> void:
	# print('touched armor ', name)
	
	if body is PlayerMovement:
		if body.has_method("modify_armor"):
			print('Player got armor')
			body.modify_armor(20)
