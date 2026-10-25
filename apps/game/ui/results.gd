## The end screen: "and the winner is…" the team, front and center; the final stats
## (kills, KDR, accuracy, damage, distance) beside the match MVP (see MvpJudge).
## Play Again reopens the same lobby; Main Menu closes it.
extends Control

const MENU_SCENE := "res://ui/main_menu.tscn"
const LOBBY_SCENE := "res://ui/lobby.tscn"
const GAME_SCENE := "res://modes/duo_sandbox.tscn"


var _mvp_box: VBoxContainer
var _mvp_card: PanelContainer
var _thinking: Label
var _shown: Control


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	theme = UiKit.make_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var r: Dictionary = MatchStats.result
	var winner: int = r.get("winner", -1)
	var scores: Array = r.get("scores", [0, 0])
	var split := 0.5 if winner < 0 else (0.78 if winner == 0 else 0.22)
	add_child(UiKit.background(split, 1.0))

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 72)
	margin.add_theme_constant_override("margin_top", 28)
	margin.add_theme_constant_override("margin_bottom", 32)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	margin.add_child(col)

	# The reveal, front and center: "and the winner is…" then the team.
	var reveal := VBoxContainer.new()
	reveal.add_theme_constant_override("separation", 4)
	col.add_child(reveal)
	var eyebrow := UiKit.eyebrow("MATCH COMPLETE  /  %s" % _reason_text(r.get("reason", "")), UiKit.MUTED)
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	reveal.add_child(eyebrow)
	var lead := UiKit.script_line("and the winner is…", 52, UiKit.INK)
	lead.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	reveal.add_child(lead)
	var name_holder := CenterContainer.new()
	var team_title := UiKit.title_3d("NOBODY" if winner < 0 else "%s TEAM" % UiKit.team_name(winner), 150,
		UiKit.INK if winner < 0 else UiKit.team_color(winner))
	name_holder.add_child(team_title)
	reveal.add_child(name_holder)
	var under := HBoxContainer.new()
	under.alignment = BoxContainer.ALIGNMENT_CENTER
	under.add_theme_constant_override("separation", 28)
	if winner < 0:
		under.add_child(UiKit.script_line("it's a draw", 40, UiKit.MUTED))
	under.add_child(UiKit.display("BLUE", 34, UiKit.MUTED))
	under.add_child(UiKit.display("%d" % scores[0], 44, UiKit.BLUE))
	under.add_child(UiKit.display("—", 44, UiKit.MUTED))
	under.add_child(UiKit.display("%d" % scores[1], 44, UiKit.RED))
	under.add_child(UiKit.display("RED", 34, UiKit.MUTED))
	reveal.add_child(under)

	# Below: the stats table and, beside it, the MVP.
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 24)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)

	var table := PanelContainer.new()
	table.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.16)))
	table.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	table.size_flags_stretch_ratio = 1.5
	body.add_child(table)
	var rows := VBoxContainer.new()
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rows.alignment = BoxContainer.ALIGNMENT_CENTER
	rows.add_theme_constant_override("separation", 26)
	table.add_child(rows)
	var head := HBoxContainer.new()
	head.add_child(_cell(UiKit.display("BLUE", 32, UiKit.BLUE), 180, HORIZONTAL_ALIGNMENT_RIGHT))
	head.add_child(_cell(UiKit.eyebrow("Final stats"), 0, HORIZONTAL_ALIGNMENT_CENTER, true))
	head.add_child(_cell(UiKit.display("RED", 32, UiKit.RED), 180, HORIZONTAL_ALIGNMENT_LEFT))
	rows.add_child(head)
	var t: Array = MatchStats.teams
	if t.size() == 2:
		_stat_row(rows, "Kills", t[0].kills, t[1].kills)
		_stat_row(rows, "KDR", MatchStats.kdr(0), MatchStats.kdr(1), "%.2f")
		_stat_row(rows, "Accuracy", MatchStats.accuracy(0) * 100.0, MatchStats.accuracy(1) * 100.0, "%d%%")
		_stat_row(rows, "Damage dealt", t[0].get("damage", 0.0), t[1].get("damage", 0.0))
		_stat_row(rows, "Distance traveled", t[0].distance, t[1].distance, "%d m")

	_mvp_card = PanelContainer.new()
	_mvp_card.add_theme_stylebox_override("panel", UiKit.team_card_style(Color(1, 1, 1, 0.3), "top"))
	_mvp_card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(_mvp_card)
	_mvp_box = VBoxContainer.new()
	_mvp_box.alignment = BoxContainer.ALIGNMENT_CENTER
	_mvp_box.add_theme_constant_override("separation", 6)
	_mvp_card.add_child(_mvp_box)
	_mvp_box.add_child(UiKit.eyebrow("Match MVP", UiKit.MUTED))
	_mvp_box.add_child(UiKit.script_line("most valuable player", 34, UiKit.MUTED))
	_thinking = UiKit.label("Reviewing the tape", 24, UiKit.BODY_SEMI, UiKit.MUTED)
	_mvp_box.add_child(_thinking)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 20)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	col.add_child(buttons)
	var menu := UiKit.button("MAIN MENU")
	menu.pressed.connect(_on_menu)
	var again := UiKit.button("PLAY AGAIN", true)
	again.custom_minimum_size.x = 320
	again.pressed.connect(_on_again)
	buttons.add_child(menu)
	if r.get("reason", "") == "host":
		again.queue_free()
		menu.grab_focus.call_deferred()
	else:
		buttons.add_child(again)
		again.grab_focus.call_deferred()
	UiKit.fade_in(self)

	# Reveal: the line, a beat, then the team; the rest follows.
	lead.modulate.a = 0.0
	team_title.modulate.a = 0.0
	team_title.pivot_offset = team_title.custom_minimum_size * 0.5
	team_title.scale = Vector2(0.8, 0.8)
	under.modulate.a = 0.0
	body.modulate.a = 0.0
	var tw := create_tween()
	tw.tween_property(lead, "modulate:a", 1.0, 0.5)
	tw.tween_interval(0.35)
	tw.tween_property(team_title, "modulate:a", 1.0, 0.25)
	tw.parallel().tween_property(team_title, "scale", Vector2.ONE, 0.5).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(under, "modulate:a", 1.0, 0.3)
	tw.tween_property(body, "modulate:a", 1.0, 0.35)
	_judge()


func _process(_delta: float) -> void:
	if _thinking and is_instance_valid(_thinking):
		_thinking.text = "Reviewing the tape" + ".".repeat(int(Time.get_ticks_msec() / 400.0) % 4)


## Ask for the MVP (Gemini via the control plane, or the local rule) and show it.
func _judge() -> void:
	var pick: Dictionary = await MvpJudge.decide(self)
	if not is_inside_tree():
		return
	show_mvp(pick)


func show_mvp(pick: Dictionary) -> void:
	if _thinking and is_instance_valid(_thinking):
		_thinking.queue_free()
		_thinking = null
	var has_mvp: bool = not str(pick.get("id", "")).is_empty()
	var team: int = pick.get("team", -1)
	var color: Color = UiKit.team_color(team) if has_mvp else UiKit.MUTED
	_mvp_card.add_theme_stylebox_override("panel", UiKit.team_card_style(color, "top"))
	if _shown:
		_shown.queue_free()
	var shown := VBoxContainer.new()
	shown.add_theme_constant_override("separation", 6)
	_shown = shown
	if has_mvp:
		var name_label := UiKit.display(str(pick.name).to_upper(), 56, UiKit.INK)
		name_label.clip_text = true
		name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		shown.add_child(name_label)
		shown.add_child(UiKit.label("%s TEAM  ·  %s" % [UiKit.team_name(team), str(pick.role).to_upper()], 22, UiKit.BODY_BOLD, color))
	else:
		shown.add_child(UiKit.display("NO MVP", 56, UiKit.INK))
	var bar := ColorRect.new()
	bar.color = color
	bar.custom_minimum_size = Vector2(120, 3)
	bar.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	shown.add_child(bar)
	if not str(pick.get("headline", "")).is_empty() and has_mvp:
		shown.add_child(UiKit.display(str(pick.headline).to_upper(), 30, UiKit.GOLD))
	var reason := UiKit.label(str(pick.get("reason", "")), 22, UiKit.BODY, UiKit.INK)
	reason.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	reason.custom_minimum_size.x = 420
	shown.add_child(reason)
	var source := "Judged by Gemini" if pick.get("source") == "gemini" else "Judged offline"
	shown.add_child(UiKit.eyebrow(source, UiKit.MUTED))
	_mvp_box.add_child(shown)
	shown.modulate.a = 0.0
	create_tween().tween_property(shown, "modulate:a", 1.0, 0.4)


func _reason_text(reason: String) -> String:
	match reason:
		"kills":
			return "first to the kill target"
		"time":
			return "time's up"
		"host":
			return "ended by the host"
	return "final whistle"


func _cell(node: Label, width: float, align: HorizontalAlignment, expand := false) -> Label:
	node.horizontal_alignment = align
	node.custom_minimum_size.x = width
	if expand:
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


## One stat: blue value, a head-to-head bar, red value.
func _stat_row(parent: Control, title: String, blue: float, red: float, fmt := "%d", lower_better := false) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var b := _cell(UiKit.display(_fmt(fmt, blue), 42, UiKit.INK if (blue <= red if lower_better else blue >= red) else UiKit.MUTED), 180, HORIZONTAL_ALIGNMENT_RIGHT)
	row.add_child(b)
	var mid := VBoxContainer.new()
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.add_theme_constant_override("separation", 2)
	var title_label := UiKit.label(title, 24, UiKit.BODY_SEMI, UiKit.MUTED)
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mid.add_child(title_label)
	var bar := _versus_bar(blue, red)
	mid.add_child(bar)
	row.add_child(mid)
	row.add_child(_cell(UiKit.display(_fmt(fmt, red), 42, UiKit.INK if (red <= blue if lower_better else red >= blue) else UiKit.MUTED), 180, HORIZONTAL_ALIGNMENT_LEFT))
	parent.add_child(row)


func _fmt(fmt: String, value: float) -> String:
	return fmt % value if fmt.contains("%.") else fmt % roundi(value)


func _versus_bar(blue: float, red: float) -> Control:
	var bar := HBoxContainer.new()
	bar.custom_minimum_size.y = 4
	bar.add_theme_constant_override("separation", 3)
	var total := blue + red
	var share := 0.5 if total <= 0.0 else blue / total
	for side in 2:
		var piece := ColorRect.new()
		piece.color = Color(UiKit.BLUE if side == 0 else UiKit.RED, 0.75)
		if total <= 0.0:
			piece.color.a = 0.25
		piece.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		piece.size_flags_stretch_ratio = maxf(0.02, share if side == 0 else 1.0 - share)
		bar.add_child(piece)
	return bar


func _on_again() -> void:
	if NetworkClient.is_connected_to_server() and not GameSession.pairing_code.is_empty():
		GameSession.reset_lobby()
		get_tree().change_scene_to_file(LOBBY_SCENE)
	else:
		get_tree().change_scene_to_file(GAME_SCENE)   # played without phones: straight back in


func _on_menu() -> void:
	GameSession.leave_lobby()
	get_tree().change_scene_to_file(MENU_SCENE)
