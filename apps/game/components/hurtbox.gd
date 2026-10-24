## Area that bullets hit. Points at a HealthComponent; heads get the weapon's headshot multiplier.
class_name Hurtbox
extends Area3D

@export var health: HealthComponent
@export var is_head := false

var _layer := 0


func _ready() -> void:
	_layer = collision_layer


## Returns the damage actually dealt.
func take_hit(amount: float, headshot_multiplier: float, source: Node) -> float:
	if health == null or health.dead:
		return 0.0
	var dmg := amount * (headshot_multiplier if is_head else 1.0)
	health.apply_damage(dmg, source)
	return dmg


func set_enabled(on: bool) -> void:
	collision_layer = _layer if on else 0
