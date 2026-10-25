extends CanvasLayer
## One modal shared by the main menu and the in-match menu. From the main menu it also
## holds the match setting (player count); in a match only graphics can change.

signal closed()

## Show the "Player Count" row (main menu). Set before the node enters the tree.
var match_settings := false

var _shade: ColorRect
var _players: HSlider
var _players_value: Label
var _resolution: OptionButton
var _scale: OptionButton
var _mode: OptionButton
var _vsync: CheckButton
var _status: Label


func _ready() -> void:
	name = "GraphicsMenu"
	layer = 80
	process_mode = Node.PROCESS_MODE_ALWAYS
	_shade = ColorRect.new()
	_shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_shade.color = Color(0.03, 0.03, 0.032, 0.9)
	_shade.theme = UiKit.make_theme()
	add_child(_shade)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_shade.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size.x = 760
	panel.add_theme_stylebox_override("panel", UiKit.panel_box(UiKit.LINE, Color(0.085, 0.085, 0.09, 0.98)))
	center.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 18)
	panel.add_child(col)
	col.add_child(UiKit.eyebrow("MATCH / DISPLAY / QUALITY" if match_settings else "DISPLAY / QUALITY", UiKit.GOLD))
	col.add_child(UiKit.display("SETTINGS" if match_settings else "GRAPHICS", 56))
	if match_settings:
		# Phones a match needs before it can start: 1 (testing) to 4 (full match).
		var slider_row := HBoxContainer.new()
		slider_row.add_theme_constant_override("separation", 18)
		_players = HSlider.new()
		_players.min_value = 1
		_players.max_value = 4
		_players.step = 1
		_players.tick_count = 4
		_players.ticks_on_borders = true
		_players.value = 4
		_players.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_players.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		slider_row.add_child(_players)
		_players_value = UiKit.display("4", 32)
		_players_value.custom_minimum_size.x = 28
		_players_value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		slider_row.add_child(_players_value)
		_players.value_changed.connect(func(v: float): _players_value.text = str(int(v)))
		_add_row(col, "Player Count", slider_row)
	_resolution = OptionButton.new()
	for size_value in GraphicsSettings.RESOLUTIONS:
		var suffix := " / 4K" if size_value == Vector2i(3840, 2160) else (" / QHD" if size_value == Vector2i(2560, 1440) else (" / 3:2" if size_value == Vector2i(2160, 1440) else ""))
		_resolution.add_item("%d x %d%s" % [size_value.x, size_value.y, suffix])
	_add_row(col, "Output resolution", _resolution)
	_scale = OptionButton.new()
	for value in GraphicsSettings.SCALES:
		_scale.add_item("%d%%%s" % [roundi(value * 100), " / native" if value == 1.0 else (" / supersampling" if value > 1.0 else " / upscaling")])
	_add_row(col, "3D render scale", _scale)
	_mode = OptionButton.new()
	for text in ["Windowed", "Fullscreen", "Borderless window"]:
		_mode.add_item(text)
	_add_row(col, "Window mode", _mode)
	_vsync = CheckButton.new()
	_vsync.text = "V-SYNC"
	_add_row(col, "Frame synchronization", _vsync)
	var note := UiKit.label("Lower render scale improves performance. Higher scale sharpens 3D edges. HUD text stays sharp. Fullscreen uses your display's desktop resolution.", 20, UiKit.BODY, UiKit.MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 720
	col.add_child(note)
	_status = UiKit.label("", 20, UiKit.BODY_SEMI, UiKit.READY)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_status)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	col.add_child(buttons)
	var back := UiKit.button("BACK")
	back.pressed.connect(close_menu)
	buttons.add_child(back)
	var reset := UiKit.button("DEFAULTS")
	reset.pressed.connect(func():
		_resolution.select(2)
		_scale.select(3)
		_mode.select(0)
		_vsync.button_pressed = true
		if _players:
			_players.value = 4
		_status.text = "Default settings selected. Apply to save.")
	buttons.add_child(reset)
	var apply := UiKit.button("APPLY", true)
	apply.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	apply.pressed.connect(_apply)
	buttons.add_child(apply)
	_shade.visible = false


func _add_row(parent: VBoxContainer, text: String, control: Control) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 28)
	var label := UiKit.label(text, 24, UiKit.BODY_SEMI)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	control.custom_minimum_size = Vector2(360, 48)
	control.add_theme_font_override("font", UiKit.font(UiKit.BODY_SEMI))
	control.add_theme_font_size_override("font_size", 22)
	row.add_child(control)
	parent.add_child(row)


func open_menu() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_resolution.select(GraphicsSettings.RESOLUTIONS.find(GraphicsSettings.resolution))
	_scale.select(GraphicsSettings.SCALES.find(GraphicsSettings.render_scale))
	_mode.select(GraphicsSettings.window_mode)
	_vsync.button_pressed = GraphicsSettings.vsync
	if _players:
		_players.value = GameSession.players_needed
	_status.text = ""
	_shade.visible = true
	(_players if _players else _resolution).grab_focus()


func is_open() -> bool:
	return _shade.visible


func close_menu() -> void:
	_shade.visible = false
	closed.emit()


func _apply() -> void:
	var error := GraphicsSettings.apply_settings(GraphicsSettings.RESOLUTIONS[_resolution.selected], GraphicsSettings.SCALES[_scale.selected], _mode.selected, _vsync.button_pressed)
	if _players:
		var saved := GameSession.set_players_needed(int(_players.value))
		if error == OK:
			error = saved
	if error == OK:
		close_menu()   # applied and saved: nothing left to do here
		return
	# Keep the dialog open so the problem stays visible.
	_status.text = "Applied, but settings could not be saved (%s)." % error_string(error)
	_status.add_theme_color_override("font_color", UiKit.GOLD)


func _input(event: InputEvent) -> void:
	if _shade.visible and event.is_action_pressed("ui_cancel") and not event.is_echo():
		close_menu()
		get_viewport().set_input_as_handled()
