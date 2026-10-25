class_name HealthComponent
extends Node

signal damaged(amount: float, source: Node)
signal health_changed(hp: float, max_hp: float)
signal died(killer: Node)

@export var max_health := 100.0

var hp := 100.0
var dead := false
## Spawn protection: bullets do nothing while this is > 0 (seconds left). The Hurtbox checks it,
## so other damage (falling off the map, scripted damage) still applies.
var protected_left := 0.0


func _process(delta: float) -> void:
	if protected_left > 0.0:
		protected_left = maxf(protected_left - delta, 0.0)


func protect(seconds: float) -> void:
	protected_left = maxf(seconds, 0.0)


func is_protected() -> bool:
	return protected_left > 0.0


func _ready() -> void:
	reset()


func reset() -> void:
	hp = max_health
	dead = false
	health_changed.emit(hp, max_health)


func apply_damage(amount: float, source: Node = null) -> void:
	if dead or amount <= 0.0:
		return
	hp = maxf(hp - amount, 0.0)
	damaged.emit(amount, source)
	health_changed.emit(hp, max_health)
	if hp <= 0.0:
		dead = true
		died.emit(source)


func kill(source: Node = null) -> void:
	apply_damage(hp, source)
