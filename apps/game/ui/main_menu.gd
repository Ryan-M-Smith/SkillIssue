## Main menu: Create a Lobby, How to Play, Sign In / Account, Quit.
extends Control

const LOBBY_SCENE := "res://ui/lobby.tscn"
const SIGN_IN_SCENE := "res://ui/sign_in.tscn"

var _how: Control
var _how_close: Button
var _account: Button
var _who: Label


func _ready() -> void:
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

	left.add_child(UiKit.eyebrow("2 v 2  ·  two phones per team  ·  one screen"))
	left.add_child(UiKit.wordmark(132))
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
	_account = UiKit.button("SIGN IN")
	_account.custom_minimum_size = Vector2(420, 60)
	_account.pressed.connect(func(): get_tree().change_scene_to_file(SIGN_IN_SCENE))
	var quit := UiKit.button("QUIT")
	quit.custom_minimum_size = Vector2(420, 60)
	quit.pressed.connect(func(): get_tree().quit())
	for b in [create, how, _account, quit]:
		var holder := HBoxContainer.new()
		holder.add_child(b)
		left.add_child(holder)

	var foot := UiKit.label("Phones: open the SkillIssue app and tap Join a Lobby.", 20, UiKit.BODY, UiKit.MUTED)
	left.add_child(foot)
	_who = UiKit.label("", 20, UiKit.BODY_SEMI, UiKit.MUTED)
	left.add_child(_who)
	Account.changed.connect(_render_account)
	_render_account()

	# Right: the two teams, face to face
	var right := VBoxContainer.new()
	right.alignment = BoxContainer.ALIGNMENT_CENTER
	right.custom_minimum_size.x = 420
	right.add_theme_constant_override("separation", 18)
	row.add_child(right)
	right.add_child(_team_card(0))
	var vs := UiKit.display("VS", 64, UiKit.INK)
	vs.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	right.add_child(vs)
	right.add_child(_team_card(1))

	_how = _build_how_to_play()
	_how.visible = false
	add_child(_how)

	UiKit.fade_in(self)
	create.grab_focus.call_deferred()


func _team_card(team: int) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UiKit.panel_box(UiKit.team_color(team), _panel_for(team), 0.12 if team == 0 else -0.12))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	card.add_child(box)
	box.add_child(UiKit.display("TEAM %s" % UiKit.team_name(team), 44, UiKit.team_color(team)))
	box.add_child(UiKit.label("Movement phone  +  Aim phone", 22, UiKit.BODY_SEMI, UiKit.INK))
	box.add_child(UiKit.label("Share one body. Talk or lose.", 20, UiKit.BODY, UiKit.MUTED))
	return card


static func _panel_for(team: int) -> Color:
	var c := UiKit.team_color(team)
	return Color(c.r * 0.16, c.g * 0.16, c.b * 0.16, 0.9)


func _render_account() -> void:
	if not is_inside_tree():
		return
	if Account.is_signed_in():
		_account.text = "ACCOUNT · %s" % str(Account.profile.name).to_upper()
		_who.text = "Signed in: matches you host go on the all-time leaderboard."
		_who.add_theme_color_override("font_color", UiKit.READY)
	else:
		_account.text = "SIGN IN"
		_who.text = "Not signed in: matches aren't saved to the leaderboard."
		_who.add_theme_color_override("font_color", UiKit.MUTED)


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
	panel.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.3), Color(0.05, 0.06, 0.1, 0.97)))
	panel.custom_minimum_size = Vector2(1100, 0)
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	box.add_child(UiKit.display("HOW TO PLAY", 52))
	box.add_child(UiKit.label("Each team is one character driven by two phones held sideways like a controller. First team to 10 kills wins, or whoever leads when the 5-minute clock runs out.", 22))

	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 28)
	box.add_child(cols)
	cols.add_child(_how_column("MOVEMENT PHONE", UiKit.BLUE, [
		["Tilt top away / toward you", "Walk forward / back"],
		["Tip an end down", "Strafe left / right"],
		["Flick forward", "Crouch (again to stand)"],
		["Flick back", "Jump"],
		["Twist like a wheel", "Sprint on / off"],
	]))
	cols.add_child(_how_column("AIM PHONE", UiKit.RED, [
		["Turn the phone", "Look around"],
		["Jab forward or hold FIRE", "Shoot"],
		["SCOPE button", "Zoom (sniper)"],
		["Weapon buttons", "Pistol, shotgun, sniper"],
		["Pick up guns on the map", "Unlock them"],
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
