## Base class for anything that drives a Duo (two phones, keyboard, a bot...).
## Subclasses override poll() and ADD their contribution to `input`.
class_name DuoController
extends Node

## Set by Duo.add_controller().
var duo: Node = null


func poll(_input: DuoInput, _delta: float) -> void:
	pass


## Called when the duo is assigned, so a controller can hook into duo signals.
func _on_attached() -> void:
	pass
