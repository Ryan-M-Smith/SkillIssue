@tool
extends Control
## Simple four-arm crosshair with a center dot, drawn in code so it can be tinted per team.

@export var color := Color.WHITE:
	set(v):
		color = v
		queue_redraw()
@export var arm_length := 10.0:
	set(v):
		arm_length = v
		queue_redraw()
@export var gap := 4.0:
	set(v):
		gap = v
		queue_redraw()
@export var thickness := 2.0:
	set(v):
		thickness = v
		queue_redraw()


func _draw() -> void:
	var c := size / 2.0
	for dir: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		draw_line(c + dir * gap, c + dir * (gap + arm_length), color, thickness, true)
	draw_circle(c, thickness * 0.75, color)
