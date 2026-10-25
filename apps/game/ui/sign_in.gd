## Sign in: Google or GitHub through Auth0, in the system browser. Signed in, every
## match this game hosts is saved to the all-time leaderboard (Tiger Data). Signed in
## already: who you are, where the leaderboard lives, sign out.
extends Control

const MENU_SCENE := "res://ui/main_menu.tscn"

var _body: VBoxContainer
var _status: Label
var _buttons: VBoxContainer


func _ready() -> void:
	theme = UiKit.make_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.background(0.58, 1.0))

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 96)
	margin.add_theme_constant_override("margin_top", 72)
	margin.add_theme_constant_override("margin_bottom", 56)
	add_child(margin)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 72)
	margin.add_child(row)

	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.alignment = BoxContainer.ALIGNMENT_CENTER
	_body.add_theme_constant_override("separation", 16)
	row.add_child(_body)

	var side := VBoxContainer.new()
	side.alignment = BoxContainer.ALIGNMENT_CENTER
	side.custom_minimum_size.x = 520
	side.add_theme_constant_override("separation", 16)
	row.add_child(side)
	_buttons = VBoxContainer.new()
	_buttons.add_theme_constant_override("separation", 16)
	side.add_child(_buttons)
	_status = UiKit.label("", 22, UiKit.BODY_SEMI, UiKit.GOLD)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 520
	side.add_child(_status)

	Account.changed.connect(_render)
	Account.sign_in_progress.connect(_render.unbind(1))
	_render()
	UiKit.fade_in(self)


func _render() -> void:
	if not is_inside_tree():
		return
	for c in _body.get_children() + _buttons.get_children():
		c.queue_free()

	if Account.is_signed_in():
		_body.add_child(UiKit.eyebrow("Signed in"))
		var who := HBoxContainer.new()
		who.add_theme_constant_override("separation", 22)
		who.add_child(_avatar(96))
		var names := VBoxContainer.new()
		names.alignment = BoxContainer.ALIGNMENT_CENTER
		names.add_child(UiKit.display(str(Account.profile.name).to_upper(), 64))
		names.add_child(UiKit.label("with %s" % _provider_name(str(Account.profile.provider)), 24, UiKit.BODY, UiKit.MUTED))
		who.add_child(names)
		_body.add_child(who)
		_body.add_child(_para("Every match you host is saved to the all-time leaderboard. Players who sign in on their phones get the stats on their own accounts."))
		_body.add_child(_para("Leaderboard and your stats: %s" % Account.api_url, UiKit.MUTED))
		var done := UiKit.button("DONE", true)
		done.pressed.connect(_back)
		var out := UiKit.button("SIGN OUT")
		out.pressed.connect(Account.sign_out)
		_add_buttons([done, out])
		done.grab_focus.call_deferred()
		_status.text = ""
		return

	_body.add_child(UiKit.eyebrow("Sign in"))
	_body.add_child(UiKit.wordmark(110))
	_body.add_child(_para("Sign in to save every match you host to the all-time leaderboard. Players sign in on their phones; their wins, kills and accuracy follow them online."))
	_body.add_child(_para("Signing in opens your web browser. Come back here when it says you're done.", UiKit.MUTED))

	if Account.is_signing_in():
		var copy := UiKit.button("COPY THE SIGN-IN LINK")
		copy.pressed.connect(func():
			DisplayServer.clipboard_set(Account.authorize_url)
			copy.text = "COPIED: PASTE IT IN A BROWSER")
		var cancel := UiKit.button("CANCEL")
		cancel.pressed.connect(Account.cancel_sign_in)
		_add_buttons([copy, cancel])
		_status.text = "Finish signing in in your browser… (no browser opened? copy the link)"
		cancel.grab_focus.call_deferred()
		return

	var google := _provider_button("google")
	var github := _provider_button("github")
	var back := UiKit.button("BACK")
	back.pressed.connect(_back)
	_add_buttons([google, github, back])
	var ready := Account.auth_ready()
	google.disabled = not ready
	github.disabled = not ready
	(google if ready else back).grab_focus.call_deferred()
	_status.text = Account.config_error if not Account.config_error.is_empty() else ("" if ready else "Checking the server at %s…" % Account.api_url)


func _provider_button(provider: String) -> Button:
	var google := provider == "google"
	var b := UiKit.button("SIGN IN WITH GOOGLE" if google else "SIGN IN WITH GITHUB", google)
	b.custom_minimum_size = Vector2(520, 72)
	b.add_theme_font_size_override("font_size", 26)
	if not google:
		# GitHub: near-black slab with a light border.
		for state in ["normal", "hover", "pressed", "focus"]:
			var box: StyleBoxFlat = (b.get_theme_stylebox(state) as StyleBoxFlat).duplicate()
			box.bg_color = Color(0.05, 0.07, 0.09, 0.98) if state != "focus" else Color(0, 0, 0, 0)
			box.border_color = UiKit.INK if state in ["hover", "focus"] else Color(1, 1, 1, 0.35)
			b.add_theme_stylebox_override(state, box)
	var badge := Badge.new()
	badge.letters = "G" if google else "GH"
	badge.fill = Color(0.26, 0.52, 0.96) if google else UiKit.INK
	badge.ink = Color.WHITE if google else UiKit.BG
	badge.position = Vector2(30, 16)
	b.add_child(badge)
	b.pressed.connect(func(): Account.sign_in(provider))
	return b


## The provider's mark on its button: a colored disc with its initials.
class Badge extends Control:
	var letters := ""
	var fill := Color.WHITE
	var ink := Color.BLACK

	func _init() -> void:
		custom_minimum_size = Vector2(40, 40)
		size = custom_minimum_size
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_circle(size * 0.5, size.x * 0.5, fill)
		var font := UiKit.font(UiKit.DISPLAY)
		var font_size := 20 if letters.length() == 1 else 15
		var w := font.get_string_size(letters, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
		var baseline := size.y * 0.5 + font.get_ascent(font_size) * 0.36
		draw_string(font, Vector2((size.x - w) * 0.5, baseline), letters, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, ink)


func _avatar(size: int) -> Control:
	var holder := PanelContainer.new()
	var box := UiKit.panel_box(Color(1, 1, 1, 0.3), UiKit.PANEL)
	box.set_corner_radius_all(size / 2)
	box.set_content_margin_all(3)
	holder.add_theme_stylebox_override("panel", box)
	if Account.avatar:
		var pic := TextureRect.new()
		pic.texture = Account.avatar
		pic.custom_minimum_size = Vector2(size, size)
		pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		holder.add_child(pic)
	else:
		var initial := UiKit.display(str(Account.profile.get("name", "?")).left(1).to_upper(), int(size * 0.55))
		initial.custom_minimum_size = Vector2(size, size)
		initial.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initial.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		holder.add_child(initial)
	return holder


func _para(text: String, color := UiKit.INK) -> Label:
	var l := UiKit.label(text, 24, UiKit.BODY, color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 640
	return l


func _add_buttons(list: Array) -> void:
	for b in list:
		if b.custom_minimum_size.x < 520:
			b.custom_minimum_size = Vector2(520, 60)
		_buttons.add_child(b)


static func _provider_name(provider: String) -> String:
	return "GitHub" if provider.begins_with("github") else "Google"


func _back() -> void:
	Account.cancel_sign_in()
	get_tree().change_scene_to_file(MENU_SCENE)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_back()
