extends Control
## A segmented health meter with a delayed damage trail and readable numeric HP.

var accent := UiKit.BLUE
var health := 100.0
var maximum := 100.0
var _display := 100.0
var _trail := 100.0
var _trail_delay := 0.0
var _flash := 0.0
var _number: Label
var _panel_style: StyleBoxFlat


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel_style = UiKit.panel_box(UiKit.LINE, Color(0.055, 0.055, 0.06, 0.9))
	var title := UiKit.label("VITALS", 13, UiKit.BODY_BOLD, UiKit.MUTED)
	title.position = Vector2(14, 7)
	add_child(title)
	_number = UiKit.display("100", 32)
	_number.position = Vector2(14, 19)
	add_child(_number)
	var hp := UiKit.label("HP", 15, UiKit.BODY_BOLD, UiKit.MUTED)
	hp.position = Vector2(84, 34)
	add_child(hp)
	for child in get_children():
		child.mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_health(value: float, max_value: float, instant := false) -> void:
	maximum = maxf(max_value, 1.0)
	health = clampf(value, 0.0, maximum)
	if instant or health > _display:
		_display = health
		_trail = health
	else:
		_trail_delay = 0.4
		_flash = 1.0
	queue_redraw()


func _process(delta: float) -> void:
	_display = lerpf(_display, health, 1.0 - exp(-delta * 22.0))
	_trail_delay = maxf(_trail_delay - delta, 0.0)
	if _trail_delay <= 0.0:
		_trail = move_toward(_trail, health, delta * maximum * 0.7)
	_flash = move_toward(_flash, 0.0, delta * 3.0)
	_number.text = str(ceili(health))
	_number.add_theme_color_override("font_color", UiKit.RED if health <= maximum * 0.25 else UiKit.INK)
	queue_redraw()


func _draw() -> void:
	draw_style_box(_panel_style, Rect2(Vector2.ZERO, size))
	draw_rect(Rect2(0, 12, 3, size.y - 24), accent)
	var bar := Rect2(14, size.y - 22, size.x - 28, 9)
	draw_rect(bar, Color(1, 1, 1, 0.08))
	var ghost := bar
	ghost.size.x *= clampf(_trail / maximum, 0.0, 1.0)
	draw_rect(ghost, UiKit.GOLD)
	var fill := bar
	fill.size.x *= clampf(_display / maximum, 0.0, 1.0)
	var color := UiKit.READY if health > maximum * 0.25 else UiKit.RED
	draw_rect(fill, color.lerp(Color.WHITE, _flash))
	for i in range(1, 10):
		var x := bar.position.x + bar.size.x * i / 10.0
		draw_line(Vector2(x, bar.position.y), Vector2(x, bar.end.y), Color(0.055, 0.055, 0.06, 0.8), 2.0)
