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


var _hit := 0.0
var _headshot := false
var _kick := 0.0


func confirm_hit(headshot: bool) -> void:
	_hit = 1.0
	_headshot = headshot


func recoil() -> void:
	_kick = 5.0


func _process(delta: float) -> void:
	_hit = move_toward(_hit, 0.0, delta * 4.0)
	_kick = move_toward(_kick, 0.0, delta * 35.0)
	queue_redraw()


func _draw() -> void:
	var c := size / 2.0
	for dir: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		draw_line(c + dir * (gap + _kick), c + dir * (gap + _kick + arm_length * 0.7), Color(0, 0, 0, 0.6), thickness + 2.0, true)
		draw_line(c + dir * (gap + _kick), c + dir * (gap + _kick + arm_length * 0.7), color, thickness, true)
	draw_circle(c, thickness * 0.75, color)
	if _hit > 0.0:
		var hit_color := UiKit.GOLD if _headshot else Color.WHITE
		hit_color.a = _hit
		for direction: Vector2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(c + direction * 8.0, c + direction * 14.0, hit_color, 2.5, true)
