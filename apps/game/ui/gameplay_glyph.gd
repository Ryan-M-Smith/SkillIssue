extends Control
## Resolution-independent weapon silhouettes and a reload progress ring.

var kind := 0:
	set(value):
		if value != kind:
			kind = value
			queue_redraw()
var slot := 0:
	set(value):
		if value != slot:
			slot = value
			queue_redraw()
var progress := 0.0:
	set(value):
		if value != progress:
			progress = value
			queue_redraw()
var tint := UiKit.INK:
	set(value):
		if value != tint:
			tint = value
			queue_redraw()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _draw() -> void:
	if kind == 1:
		var center := size * 0.5
		var radius := minf(size.x, size.y) * 0.36
		draw_arc(center, radius, 0, TAU, 40, UiKit.LINE, 3, true)
		if progress > 0.0:
			draw_arc(center, radius, -PI * 0.5, -PI * 0.5 + TAU * clampf(progress, 0, 1), 40, UiKit.GOLD, 3, true)
		return
	var scale_factor := minf(size.x / 64.0, size.y / 32.0)
	draw_set_transform((size - Vector2(64, 32) * scale_factor) * 0.5, 0, Vector2.ONE * scale_factor)
	if slot == 0:
		draw_rect(Rect2(8, 8, 43, 10), tint)
		draw_colored_polygon(PackedVector2Array([Vector2(17, 16), Vector2(31, 16), Vector2(26, 30), Vector2(13, 30)]), tint)
		draw_rect(Rect2(36, 6, 4, 4), tint)
	elif slot == 1:
		draw_rect(Rect2(18, 10, 44, 6), tint)
		draw_rect(Rect2(35, 17, 21, 5), tint)
		draw_colored_polygon(PackedVector2Array([Vector2(1, 15), Vector2(25, 12), Vector2(22, 20), Vector2(4, 26)]), tint)
		draw_rect(Rect2(25, 15, 6, 12), tint)
	else:
		draw_rect(Rect2(13, 14, 50, 4), tint)
		draw_rect(Rect2(26, 6, 21, 5), tint)
		draw_rect(Rect2(34, 10, 5, 5), tint)
		draw_rect(Rect2(23, 17, 7, 9), tint)
		draw_colored_polygon(PackedVector2Array([Vector2(1, 15), Vector2(22, 13), Vector2(20, 20), Vector2(3, 26)]), tint)
