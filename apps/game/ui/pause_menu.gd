extends CanvasLayer
## Shared match navigation. Practice pauses; live matches continue for the phones.

const MENU_SCENE := "res://ui/main_menu.tscn"

var _shade: ColorRect
var _resume_button: Button
var _title: Label
var _note: Label
var _paused_by_menu := false
var _mouse_was_captured := false
var _networked_match := false
var _graphics: CanvasLayer


func _ready() -> void:
	name = "PauseMenu"
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS
	_networked_match = NetworkClient.is_connected_to_server() or GameSession.is_playing()
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UiKit.make_theme()
	add_child(root)
	var menu := UiKit.button("MENU / ESC")
	menu.focus_mode = Control.FOCUS_NONE
	menu.position = Vector2(24, 20)
	menu.add_theme_font_size_override("font_size", 16)
	menu.pressed.connect(open_menu)
	root.add_child(menu)
	_shade = ColorRect.new()
	_shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_shade.color = Color(0.01, 0.015, 0.035, 0.78)
	_shade.visible = false
	root.add_child(_shade)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_shade.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size.x = 560
	panel.add_theme_stylebox_override("panel", UiKit.panel_box(UiKit.LINE, Color(0.035, 0.045, 0.085, 0.98)))
	center.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 16)
	panel.add_child(col)
	col.add_child(UiKit.eyebrow("SKILL ISSUE / MATCH", UiKit.GOLD))
	_title = UiKit.display("PAUSED", 60)
	col.add_child(_title)
	_note = UiKit.label("", 22, UiKit.BODY, UiKit.MUTED)
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.custom_minimum_size.x = 520
	col.add_child(_note)
	_resume_button = UiKit.button("RESUME", true)
	_resume_button.pressed.connect(resume)
	col.add_child(_resume_button)
	var graphics := UiKit.button("GRAPHICS")
	graphics.pressed.connect(func(): _graphics.open_menu())
	col.add_child(graphics)
	var leave := UiKit.button("MAIN MENU")
	leave.pressed.connect(return_to_menu)
	col.add_child(leave)
	_graphics = preload("res://ui/graphics_menu.gd").new()
	add_child(_graphics)
	_graphics.closed.connect(func(): graphics.grab_focus())


func _input(event: InputEvent) -> void:
	if _graphics.is_open():
		return
	if event.is_action_pressed("ui_cancel") and not event.is_echo():
		if _shade.visible:
			resume()
		else:
			open_menu()
		get_viewport().set_input_as_handled()


func open_menu() -> void:
	if _shade.visible:
		return
	_mouse_was_captured = Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_paused_by_menu = not _networked_match and not get_tree().paused
	if _paused_by_menu:
		get_tree().paused = true
	_title.text = "MATCH MENU" if _networked_match else "PAUSED"
	_note.text = "The live match keeps running. Main Menu closes the lobby." if _networked_match else "Practice is paused. Take a breath and jump back in."
	_shade.visible = true
	_resume_button.grab_focus()


func resume() -> void:
	_shade.visible = false
	if _paused_by_menu:
		get_tree().paused = false
	_paused_by_menu = false
	get_viewport().gui_release_focus()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if _mouse_was_captured else Input.MOUSE_MODE_VISIBLE


func return_to_menu() -> void:
	get_tree().paused = false
	_paused_by_menu = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	GameSession.leave_lobby()
	get_tree().change_scene_to_file.call_deferred(MENU_SCENE)


func _exit_tree() -> void:
	if _paused_by_menu:
		get_tree().paused = false
