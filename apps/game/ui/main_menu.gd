## Main menu: Create a Lobby, How to Play, Quit.
extends Control

const LOBBY_SCENE := "res://ui/lobby.tscn"

var _how: Control
var _how_close: Button
var _graphics: CanvasLayer


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Music.play("menu")
	theme = UiKit.make_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.background(0.62, 1.0))

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 96)
	margin.add_theme_constant_override("margin_top", 72)
	margin.add_theme_constant_override("margin_bottom", 56)
	add_child(margin)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 48)
	margin.add_child(row)

	# Left: title and buttons
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.alignment = BoxContainer.ALIGNMENT_CENTER
	left.add_theme_constant_override("separation", 14)
	row.add_child(left)

	left.add_child(UiKit.script_line("HackPSU Fall 2026 presents", 36, UiKit.MUTED))
	left.add_child(UiKit.wordmark(132))
	left.add_child(UiKit.eyebrow("2 v 2  ·  two phones per team  ·  one screen"))
	var tag := UiKit.label("One of you moves. One of you shoots. Nobody has the full picture.", 28, UiKit.BODY, UiKit.INK)
	tag.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tag.custom_minimum_size.x = 560
	left.add_child(tag)

	var spacer := Control.new()
	spacer.custom_minimum_size.y = 28
	left.add_child(spacer)

	var create := UiKit.button("CREATE A LOBBY", true)
	create.custom_minimum_size = Vector2(420, 72)
	create.add_theme_font_size_override("font_size", 30)
	create.pressed.connect(_on_create)
	var how := UiKit.button("HOW TO PLAY")
	how.custom_minimum_size = Vector2(420, 60)
	how.pressed.connect(_show_how)
	var graphics := UiKit.button("SETTINGS")
	graphics.custom_minimum_size = Vector2(420, 60)
	graphics.pressed.connect(func(): _graphics.open_menu())
	var practice := UiKit.button("PRACTICE / KEYBOARD")
	practice.custom_minimum_size = Vector2(420, 60)
	practice.pressed.connect(func():
		GameSession.leave_lobby()
		get_tree().change_scene_to_file("res://modes/duo_sandbox.tscn"))
	var quit := UiKit.button("QUIT")
	quit.custom_minimum_size = Vector2(420, 60)
	quit.pressed.connect(func(): get_tree().quit())
	for b in [create, practice, how, graphics, quit]:
		var holder := HBoxContainer.new()
		holder.add_child(b)
		left.add_child(holder)

	var foot := UiKit.label("Phones: open the Skill Issue app and tap Join a Lobby.", 20, UiKit.BODY, UiKit.MUTED)
	left.add_child(foot)

	# Right: the two teams, face to face
	var right := VBoxContainer.new()
	right.alignment = BoxContainer.ALIGNMENT_CENTER
	right.custom_minimum_size.x = 420
	right.add_theme_constant_override("separation", 18)
	row.add_child(right)
	right.add_child(_team_card(0))
	var vs := UiKit.script_line("vs.", 64, UiKit.INK)
	vs.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	right.add_child(vs)
	right.add_child(_team_card(1))

	_how = _build_how_to_play()
	_how.visible = false
	add_child(_how)
	_graphics = preload("res://ui/graphics_menu.gd").new()
	_graphics.match_settings = true
	add_child(_graphics)
	_graphics.closed.connect(func(): graphics.grab_focus())

	UiKit.fade_in(self)
	create.grab_focus.call_deferred()


func _team_card(team: int) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UiKit.team_card_style(UiKit.team_color(team)))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	card.add_child(box)
	box.add_child(UiKit.display("TEAM %s" % UiKit.team_name(team), 44, UiKit.INK))
	box.add_child(UiKit.label("Gunner  +  Runner", 22, UiKit.BODY_SEMI, UiKit.INK))
	box.add_child(UiKit.label("Share one body. Talk or lose.", 20, UiKit.BODY, UiKit.MUTED))
	return card


func _on_create() -> void:
	get_tree().change_scene_to_file(LOBBY_SCENE)


func _show_how() -> void:
	_how.visible = true
	_how_close.grab_focus()


func _build_how_to_play() -> Control:
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.72)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.add_child(center)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.3), Color(0.09, 0.09, 0.095, 0.97)))
	panel.custom_minimum_size = Vector2(1100, 0)
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	box.add_child(UiKit.display("HOW TO PLAY", 52))
	box.add_child(UiKit.label("Each team is one character driven by two phones held sideways like a controller. First team to 10 kills wins, or whoever leads when the clock runs out (5 minutes by default; hosts can set 2 to 5 in Settings).", 22))

	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 28)
	box.add_child(cols)
	cols.add_child(_how_column("GUNNER · AIM PHONE", UiKit.RED, [
		["Turn the phone", "Look around (quick snaps turn 3x)"],
		["Hold an end dipped", "Keep turning that way"],
		["Hold FIRE", "Shoot"],
		["Tap AIM", "Aim down sights / scope"],
		["Tap RELOAD", "Reload"],
		["Tap SWITCH", "Next owned weapon"],
		["Pick up guns on the map", "Unlock them"],
	]))
	cols.add_child(_how_column("RUNNER · MOVEMENT PHONE", UiKit.BLUE, [
		["Tilt top away / toward you", "Walk forward / back"],
		["Tip an end down", "Strafe left / right"],
		["Flick forward", "Crouch (again to stand)"],
		["Flick back", "Jump"],
		["Twist 30 degrees, return to center", "Sprint on / off"],
	]))
	for l in [UiKit.label("Phones join with the 6-character code shown in the lobby, pick a team and role, then tap Ready. The match starts when all four are ready.", 20, UiKit.BODY, UiKit.MUTED)]:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		box.add_child(l)
	var close := UiKit.button("GOT IT", true)
	close.pressed.connect(func(): shade.visible = false)
	var holder := HBoxContainer.new()
	holder.alignment = BoxContainer.ALIGNMENT_END
	holder.add_child(close)
	box.add_child(holder)
	_how_close = close
	return shade


func _how_column(title: String, color: Color, rows: Array) -> VBoxContainer:
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 8)
	col.add_child(UiKit.display(title, 28, color))
	for r in rows:
		var line := HBoxContainer.new()
		var a := UiKit.label(r[0], 21, UiKit.BODY_SEMI)
		a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(a)
		line.add_child(UiKit.label(r[1], 21, UiKit.BODY, UiKit.MUTED))
		col.add_child(line)
	return col


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and _how.visible:
		_how.visible = false
		get_viewport().set_input_as_handled()
