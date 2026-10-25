## Scores + Stats: who won, the final score, and the two teams side by side.
## Play Again reopens the same lobby; Main Menu closes it.
extends Control

const MENU_SCENE := "res://ui/main_menu.tscn"
const LOBBY_SCENE := "res://ui/lobby.tscn"
const GAME_SCENE := "res://modes/duo_sandbox.tscn"


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	theme = UiKit.make_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var r: Dictionary = MatchStats.result
	var winner: int = r.get("winner", -1)
	var scores: Array = r.get("scores", [0, 0])
	var split := 0.5 if winner < 0 else (0.78 if winner == 0 else 0.22)
	add_child(UiKit.background(split, 1.4))

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 64)
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_bottom", 24)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	margin.add_child(col)

	col.add_child(UiKit.eyebrow("MATCH COMPLETE / %s" % _reason_text(r.get("reason", "")), UiKit.GOLD))
	var banner := UiKit.display("DRAW" if winner < 0 else "%s WINS" % UiKit.team_name(winner), 86,
		UiKit.INK if winner < 0 else UiKit.team_color(winner))
	col.add_child(banner)
	banner.pivot_offset = Vector2(0, 60)
	banner.scale = Vector2(0.85, 0.85)
	banner.modulate.a = 0.0
	var tw := create_tween().set_parallel()
	tw.tween_property(banner, "scale", Vector2.ONE, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(banner, "modulate:a", 1.0, 0.3)

	var score := HBoxContainer.new()
	score.add_theme_constant_override("separation", 28)
	score.add_child(UiKit.display("BLUE  %d" % scores[0], 56, UiKit.BLUE))
	score.add_child(UiKit.display("—", 56, UiKit.MUTED))
	score.add_child(UiKit.display("%d  RED" % scores[1], 56, UiKit.RED))
	col.add_child(score)

	var table := PanelContainer.new()
	table.add_theme_stylebox_override("panel", UiKit.panel_box(Color(1, 1, 1, 0.16)))
	table.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(table)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	table.add_child(scroll)
	var rows := VBoxContainer.new()
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rows.add_theme_constant_override("separation", 6)
	scroll.add_child(rows)
	var head := HBoxContainer.new()
	head.add_child(_cell(UiKit.display("BLUE", 28, UiKit.BLUE), 220, HORIZONTAL_ALIGNMENT_RIGHT))
	head.add_child(_cell(UiKit.eyebrow("Team stats"), 0, HORIZONTAL_ALIGNMENT_CENTER, true))
	head.add_child(_cell(UiKit.display("RED", 28, UiKit.RED), 220, HORIZONTAL_ALIGNMENT_LEFT))
	rows.add_child(head)

	var t: Array = MatchStats.teams
	if t.size() == 2:
		_stat_row(rows, "Kills", t[0].kills, t[1].kills)
		_stat_row(rows, "Deaths", t[0].deaths, t[1].deaths, "%d", true)
		_stat_row(rows, "Best kill streak", t[0].get("best_streak", 0), t[1].get("best_streak", 0))
		_stat_row(rows, "Projectiles fired", t[0].shots, t[1].shots)
		_stat_row(rows, "Accuracy", MatchStats.accuracy(0) * 100.0, MatchStats.accuracy(1) * 100.0, "%d%%")
		_stat_row(rows, "Headshots", t[0].headshots, t[1].headshots)
		_stat_row(rows, "Distance", t[0].distance, t[1].distance, "%d m")
		_stat_row(rows, "Jumps", t[0].jumps, t[1].jumps)
		_stat_row(rows, "Crouches", t[0].crouches, t[1].crouches)
		_stat_row(rows, "Sprint time", t[0].sprint_time, t[1].sprint_time, "%d s")

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
	var b := _cell(UiKit.display(fmt % roundi(blue), 30, UiKit.INK if (blue <= red if lower_better else blue >= red) else UiKit.MUTED), 220, HORIZONTAL_ALIGNMENT_RIGHT)
	row.add_child(b)
	var mid := VBoxContainer.new()
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.add_theme_constant_override("separation", 2)
	var title_label := UiKit.label(title, 18, UiKit.BODY_SEMI, UiKit.MUTED)
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mid.add_child(title_label)
	var bar := _versus_bar(blue, red)
	mid.add_child(bar)
	row.add_child(mid)
	row.add_child(_cell(UiKit.display(fmt % roundi(red), 30, UiKit.INK if (red <= blue if lower_better else red >= blue) else UiKit.MUTED), 220, HORIZONTAL_ALIGNMENT_LEFT))
	parent.add_child(row)


func _versus_bar(blue: float, red: float) -> Control:
	var bar := HBoxContainer.new()
	bar.custom_minimum_size.y = 10
	bar.add_theme_constant_override("separation", 3)
	var total := blue + red
	var share := 0.5 if total <= 0.0 else blue / total
	for side in 2:
		var piece := ColorRect.new()
		piece.color = UiKit.BLUE if side == 0 else UiKit.RED
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
