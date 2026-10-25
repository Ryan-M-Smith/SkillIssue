## Lobby: opens the in-game server, shows the join code, waits for four phones to pick a team
## and role and ready up, counts down, starts the match, loads split-screen gameplay.
## Coming back from the results screen (Play Again) reuses the open lobby and code.
extends Control

const MENU_SCENE := "res://ui/main_menu.tscn"
const GAME_SCENE := "res://modes/duo_sandbox.tscn"
const COUNTDOWN := 3

var _status: Label
var _error := ""          # why the lobby couldn't open; shown until Retry
var _code_row: HBoxContainer
var _slots := {}          # "team:role" -> {"panel", "name", "badge"}
var _waiting: Label
var _footer: Label
var _retry: Button
var _copy_ticket: Button
var _rendered_code := ""
var _countdown := -1.0
var _loading := false


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	theme = UiKit.make_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.background(0.5, 0.8))
	_build()

	LobbyServer.status_changed.connect(_on_server_status.unbind(2))
	GameSession.registered.connect(_refresh.unbind(2))
	GameSession.lobby_changed.connect(_refresh)
	GameSession.state_changed.connect(_on_state)
	GameSession.server_error.connect(_on_server_error)
	NetworkClient.connection_changed.connect(_refresh.unbind(1))
	UiKit.fade_in(self)

	if NetworkClient.is_connected_to_server() and not GameSession.pairing_code.is_empty():
		_refresh()   # back from Play Again: same lobby
		_on_state(GameSession.state)
	else:
		_open_lobby()


func _open_lobby() -> void:
	_error = ""
	_retry.visible = false
	_refresh()
	await GameSession.create_lobby()
	_refresh()


func _build() -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 72)
	margin.add_theme_constant_override("margin_top", 48)
	margin.add_theme_constant_override("margin_bottom", 40)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 22)
	margin.add_child(col)

	# Header
	var head := HBoxContainer.new()
	col.add_child(head)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(UiKit.eyebrow("Lobby"))
	titles.add_child(UiKit.display("JOIN WITH YOUR PHONE", 48))
	head.add_child(titles)
	var back := UiKit.button("BACK")
	back.pressed.connect(_on_back)
	head.add_child(back)

	# Join code
	var code_panel := PanelContainer.new()
	code_panel.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.22)))
	col.add_child(code_panel)
	var code_box := HBoxContainer.new()
	code_box.add_theme_constant_override("separation", 36)
	code_panel.add_child(code_box)
	var code_text := VBoxContainer.new()
	code_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	code_text.alignment = BoxContainer.ALIGNMENT_CENTER
	code_text.add_child(UiKit.eyebrow("Join code"))
	code_text.add_child(UiKit.label("Open the Skill Issue app → Join a Lobby → enter this code.", 22))
	_copy_ticket = UiKit.button("COPY CODE")
	_copy_ticket.pressed.connect(func():
		DisplayServer.clipboard_set(GameSession.pairing_code)
		_status.text = "Code copied.")
	_status = UiKit.label("", 20, UiKit.BODY_SEMI, UiKit.GOLD)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	code_text.add_child(_status)
	_retry = UiKit.button("RETRY")
	_retry.visible = false
	_retry.pressed.connect(_open_lobby)
	var retry_row := HBoxContainer.new()
	retry_row.add_child(_copy_ticket)
	retry_row.add_child(_retry)
	code_text.add_child(retry_row)
	code_box.add_child(code_text)
	_code_row = HBoxContainer.new()
	_code_row.add_theme_constant_override("separation", 10)
	_code_row.alignment = BoxContainer.ALIGNMENT_END
	code_box.add_child(_code_row)

	# Teams
	var teams := HBoxContainer.new()
	teams.add_theme_constant_override("separation", 28)
	teams.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(teams)
	for team in 2:
		teams.add_child(_team_column(team))

	_waiting = UiKit.label("", 20, UiKit.BODY, UiKit.MUTED)
	col.add_child(_waiting)
	_footer = UiKit.display("", 40)
	_footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_footer)


func _team_column(team: int) -> PanelContainer:
	var c := UiKit.team_color(team)
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", UiKit.panel_box(c, Color(c.r * 0.12, c.g * 0.12, c.b * 0.12, 0.88)))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	box.add_child(UiKit.display("TEAM %s" % UiKit.team_name(team), 40, c))
	for role in ["mover", "gunner"]:
		box.add_child(_slot(team, role))
	return panel


func _slot(team: int, role: String) -> PanelContainer:
	var slot := PanelContainer.new()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	slot.add_child(row)
	var info := VBoxContainer.new()
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.add_child(UiKit.eyebrow("Movement phone" if role == "mover" else "Aim phone"))
	var name_label := UiKit.label("Open", 30, UiKit.DISPLAY_SEMI, UiKit.MUTED)
	info.add_child(name_label)
	row.add_child(info)
	var badge := UiKit.label("", 20, UiKit.BODY_BOLD)
	badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(badge)
	_slots["%d:%s" % [team, role]] = {"panel": slot, "name": name_label, "badge": badge}
	return slot


func _refresh() -> void:
	if not is_inside_tree():
		return
	_render_code(GameSession.pairing_code)
	var server_ok := NetworkClient.is_connected_to_server()
	if LobbyServer.state == "failed":
		_status.text = LobbyServer.message
		_retry.visible = true
	elif not server_ok and not _error.is_empty():
		_status.text = _error
		_retry.visible = true
	elif not server_ok:
		_status.text = "Connecting to the Skill Issue servers…"
	elif GameSession.pairing_code.is_empty():
		_status.text = "Opening the lobby…"
	else:
		_status.text = ""
		_retry.visible = false
	_copy_ticket.disabled = not server_ok or GameSession.pairing_code.is_empty()

	var waiting := PackedStringArray()
	var slotted := 0
	var ready := 0
	for p in GameSession.players:
		if p.team < 0 or p.role.is_empty():
			waiting.append(p.name)
		else:
			slotted += 1
			if p.ready:
				ready += 1
	for team in 2:
		for role in ["mover", "gunner"]:
			_render_slot(team, role, GameSession.player_at(team, role))
	_waiting.text = ("Choosing a spot: " + ", ".join(waiting)) if not waiting.is_empty() else ""
	if _countdown < 0.0 and not _loading:
		# The host's Settings → Player Count decides `need` (the server reports it back).
		var need := GameSession.min_players
		_footer.text = "%d / %d READY" % [ready, maxi(need, slotted)] if server_ok else ""
		_footer.add_theme_color_override("font_color", UiKit.INK)


func _render_code(code: String) -> void:
	if code == _rendered_code and _code_row.get_child_count() > 0:
		return
	_rendered_code = code
	for c in _code_row.get_children():
		c.queue_free()
	var text := code if not code.is_empty() else "······"
	for i in text.length():
		var tile := PanelContainer.new()
		var accent := UiKit.BLUE if i < 3 else UiKit.RED
		tile.add_theme_stylebox_override("panel", UiKit.panel_box(accent, Color(0.04, 0.05, 0.09, 0.95)))
		var ch := UiKit.display(text[i], 76, UiKit.INK)
		ch.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		ch.custom_minimum_size = Vector2(64, 0)
		tile.add_child(ch)
		_code_row.add_child(tile)


func _render_slot(team: int, role: String, player: Dictionary) -> void:
	var s: Dictionary = _slots["%d:%s" % [team, role]]
	var c := UiKit.team_color(team)
	if player.is_empty():
		s.name.text = "Open"
		s.name.add_theme_color_override("font_color", UiKit.MUTED)
		s.badge.text = ""
		s.panel.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0.25)))
		return
	s.name.text = player.name
	s.name.add_theme_color_override("font_color", UiKit.INK)
	if player.ready:
		s.badge.text = "READY"
		s.badge.add_theme_color_override("font_color", UiKit.READY)
		s.panel.add_theme_stylebox_override("panel", UiKit.panel_box(c, Color(c.r * 0.3, c.g * 0.3, c.b * 0.3, 0.9)))
	else:
		s.badge.text = "PICKING…"
		s.badge.add_theme_color_override("font_color", UiKit.GOLD)
		s.panel.add_theme_stylebox_override("panel", UiKit.panel_box(Color(c.r, c.g, c.b, 0.5), Color(0, 0, 0, 0.3)))


func _on_server_status() -> void:
	_refresh()


func _on_server_error(error: String) -> void:
	if not NetworkClient.is_connected_to_server():
		_error = error
	_status.text = error
	_retry.visible = not NetworkClient.is_connected_to_server()


func _on_state(state: String) -> void:
	if state == "ready" and _countdown < 0.0 and not _loading:
		_countdown = COUNTDOWN
	elif state != "ready" and state != "playing":
		_countdown = -1.0
	if state == "playing" and not _loading:
		_loading = true
		_footer.text = "LOADING ARENA…"
		get_tree().change_scene_to_file.call_deferred(GAME_SCENE)
	_refresh()


func _process(delta: float) -> void:
	if _countdown < 0.0 or _loading:
		return
	var before := ceili(_countdown)
	_countdown -= delta
	if _countdown <= 0.0:
		_countdown = -1.0
		_footer.text = "GO!"
		GameSession.request_start()
		return
	var n := ceili(_countdown)
	_footer.text = "MATCH STARTS IN %d" % n
	_footer.add_theme_color_override("font_color", UiKit.GOLD)
	if n != before:
		_footer.pivot_offset = _footer.size * 0.5
		_footer.scale = Vector2(1.25, 1.25)
		create_tween().tween_property(_footer, "scale", Vector2.ONE, 0.25)


func _on_back() -> void:
	GameSession.leave_lobby()
	get_tree().change_scene_to_file(MENU_SCENE)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_on_back()
