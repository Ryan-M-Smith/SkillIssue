class_name TeamHud
extends Control
## Presentation for one viewport. The Duo and MatchStats remain the source of truth.

const VITALS = preload("res://ui/gameplay_vitals.gd")
const GLYPH = preload("res://ui/gameplay_glyph.gd")
const RETICLE = preload("res://crosshair.gd")
const DAMAGE_SHADER := "shader_type canvas_item; uniform float strength = 0.0; uniform float downed = 0.0; void fragment(){ vec2 edge = abs(UV - vec2(0.5)) * 2.0; float rim = pow(max(edge.x, edge.y), 5.0); vec3 tint = mix(vec3(1.0, 0.08, 0.12), vec3(0.08, 0.01, 0.025), downed); COLOR = vec4(tint, clamp(rim * strength + downed * 0.52, 0.0, 0.85)); }"

@export var team_data: TeamData

var team: int:
	get: return team_data.id if team_data else 0

var _duo: Duo
var _vitals: Control
var _reticle: Control
var _ammo: Label
var _ammo_max: Label
var _weapon_icon: Control
var _reload: Control
var _reload_label: Label
var _slots: Array[Control] = []
var _death: PanelContainer
var _death_detail: Label
var _respawn_label: Label
var _celebration: VBoxContainer
var _kill_title: Label
var _kill_streak: Label
var _streak: Label
var _effect: ShaderMaterial
var _damage := 0.0
var _death_remaining := 0.0
var _respawn_duration := 3.0
var _celebration_tween: Tween


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UiKit.make_theme()
	_build()
	GameEvents.health_changed.connect(_on_health_changed)
	GameEvents.duo_killed.connect(_on_duo_killed)


func bind_duo(duo: Duo, respawn_seconds: float) -> void:
	_duo = duo
	_respawn_duration = respawn_seconds
	duo.killed.connect(_on_killed)
	duo.respawned.connect(_on_respawned)
	duo.weapons.hit_confirmed.connect(func(_target: Node, _amount: float, headshot: bool):
		_reticle.confirm_hit(headshot))
	duo.weapons.fired.connect(func(_data: WeaponData): _reticle.recoil())
	_vitals.set_health(duo.health.hp, duo.health.max_health, true)


func _build() -> void:
	var damage := ColorRect.new()
	damage.set_anchors_preset(Control.PRESET_FULL_RECT)
	damage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = DAMAGE_SHADER
	_effect = ShaderMaterial.new()
	_effect.shader = shader
	damage.material = _effect
	add_child(damage)

	_reticle = RETICLE.new()
	_reticle.set_anchors_preset(Control.PRESET_CENTER)
	_reticle.offset_left = -24
	_reticle.offset_top = -24
	_reticle.offset_right = 24
	_reticle.offset_bottom = 24
	_reticle.color = UiKit.INK
	_reticle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_reticle)

	_vitals = VITALS.new()
	_vitals.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_vitals.position = Vector2(20, -106)
	_vitals.size = Vector2(226, 86)
	_vitals.accent = UiKit.team_color(team)
	add_child(_vitals)

	var ammo_card := PanelContainer.new()
	ammo_card.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	ammo_card.offset_left = -202
	ammo_card.offset_top = -106
	ammo_card.offset_right = -20
	ammo_card.offset_bottom = -20
	var box := UiKit.panel_box(UiKit.LINE, Color(0.02, 0.03, 0.065, 0.9))
	box.set_content_margin_all(10)
	ammo_card.add_theme_stylebox_override("panel", box)
	add_child(ammo_card)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 0)
	ammo_card.add_child(content)
	var ammo_row := HBoxContainer.new()
	ammo_row.add_theme_constant_override("separation", 8)
	content.add_child(ammo_row)
	_weapon_icon = GLYPH.new()
	_weapon_icon.custom_minimum_size = Vector2(46, 38)
	ammo_row.add_child(_weapon_icon)
	_ammo = UiKit.display("12", 32)
	ammo_row.add_child(_ammo)
	_ammo_max = UiKit.label("/ 12", 18, UiKit.DISPLAY_SEMI, UiKit.MUTED)
	_ammo_max.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ammo_row.add_child(_ammo_max)
	_reload = GLYPH.new()
	_reload.kind = 1
	_reload.custom_minimum_size = Vector2(25, 30)
	_reload.visible = false
	ammo_row.add_child(_reload)
	var slots := HBoxContainer.new()
	slots.add_theme_constant_override("separation", 9)
	content.add_child(slots)
	for i in 3:
		var icon := GLYPH.new()
		icon.slot = i
		icon.custom_minimum_size = Vector2(36, 18)
		_slots.append(icon)
		slots.add_child(icon)
	_reload_label = UiKit.label("", 14, UiKit.BODY_BOLD, UiKit.GOLD)
	_reload_label.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_reload_label.offset_left = -202
	_reload_label.offset_top = -132
	_reload_label.offset_right = -20
	_reload_label.offset_bottom = -108
	_reload_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	add_child(_reload_label)

	_streak = UiKit.label("", 16, UiKit.DISPLAY_SEMI, UiKit.GOLD)
	_streak.position = Vector2(24, 88)
	add_child(_streak)
	_build_death_card()
	_build_celebration()
	_ignore_mouse(self)


func _build_death_card() -> void:
	_death = PanelContainer.new()
	_death.set_anchors_preset(Control.PRESET_CENTER)
	_death.offset_left = -170
	_death.offset_right = 170
	_death.offset_top = -95
	_death.offset_bottom = 95
	_death.add_theme_stylebox_override("panel", UiKit.panel_box(UiKit.RED, Color(0.045, 0.015, 0.035, 0.96)))
	_death.visible = false
	add_child(_death)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	_death.add_child(col)
	var eyebrow := UiKit.eyebrow("SIGNAL LOST", UiKit.RED)
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(eyebrow)
	var title := UiKit.display("ELIMINATED", 38)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(title)
	_death_detail = UiKit.label("", 18, UiKit.BODY_SEMI, UiKit.MUTED)
	_death_detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_death_detail)
	_respawn_label = UiKit.label("", 20, UiKit.DISPLAY_SEMI, UiKit.GOLD)
	_respawn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_respawn_label)


func _build_celebration() -> void:
	_celebration = VBoxContainer.new()
	_celebration.set_anchors_preset(Control.PRESET_CENTER)
	_celebration.position = Vector2(-175, -150)
	_celebration.custom_minimum_size = Vector2(350, 90)
	_celebration.visible = false
	add_child(_celebration)
	_kill_title = UiKit.display("ELIMINATION", 34, UiKit.GOLD)
	_kill_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_kill_title.add_theme_color_override("font_outline_color", UiKit.BG)
	_kill_title.add_theme_constant_override("outline_size", 5)
	_celebration.add_child(_kill_title)
	_kill_streak = UiKit.label("", 20, UiKit.DISPLAY_SEMI)
	_kill_streak.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_kill_streak.add_theme_color_override("font_outline_color", UiKit.BG)
	_kill_streak.add_theme_constant_override("outline_size", 4)
	_celebration.add_child(_kill_streak)


func _process(delta: float) -> void:
	_damage = move_toward(_damage, 0.0, delta * 1.8)
	var critical := is_instance_valid(_duo) and _duo.alive and _duo.health.hp <= _duo.health.max_health * 0.25
	var pulse := (0.12 + 0.08 * sin(Time.get_ticks_msec() * 0.008)) if critical else 0.0
	_effect.set_shader_parameter("strength", maxf(_damage, pulse))
	_effect.set_shader_parameter("downed", 1.0 if is_instance_valid(_duo) and not _duo.alive else 0.0)
	if not is_instance_valid(_duo):
		return
	_reticle.visible = _duo.alive
	_reticle.gap = 5.0 + minf(_duo.weapons.current_spread_degrees(), 12.0)
	if not _duo.alive:
		_death_remaining = maxf(_death_remaining - delta, 0.0)
		_respawn_label.text = "REBOOT IN %.1f" % _death_remaining
	var weapons := _duo.weapons
	var data := weapons.current_data()
	if data == null:
		return
	_weapon_icon.slot = weapons.current
	_ammo.text = str(weapons.ammo_in_mag())
	_ammo_max.text = "/ %d" % data.magazine_size
	_ammo.add_theme_color_override("font_color", UiKit.GOLD if weapons.ammo_in_mag() <= maxi(1, data.magazine_size / 4) else UiKit.INK)
	_reload.visible = weapons.reloading
	_reload.progress = weapons.reload_progress()
	_reload_label.text = "RELOADING" if weapons.reloading else ""
	for i in _slots.size():
		_slots[i].tint = UiKit.GOLD if weapons.current == i else UiKit.INK
		_slots[i].modulate.a = 1.0 if i < weapons.owned.size() and weapons.owned[i] else 0.16
	var streak := _current_streak()
	_streak.text = "%d  /  KILL STREAK" % streak if streak >= 2 else ""


func _on_health_changed(t: int, hp: float, maximum: float) -> void:
	if t != team:
		return
	if hp < _vitals.health:
		_damage = 0.7
	_vitals.set_health(hp, maximum)


func _on_killed(killer: Node, weapon_name: String) -> void:
	_death_remaining = _respawn_duration
	_death_detail.text = "Taken out by %s" % weapon_name if killer != null else "Watch your step."
	_death.visible = true
	_death.pivot_offset = _death.size * 0.5
	_death.scale = Vector2(1.12, 1.12)
	_damage = 1.0
	var tween := create_tween()
	tween.tween_property(_death, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _on_respawned() -> void:
	_death.visible = false
	_damage = 0.0
	_vitals.set_health(_duo.health.hp, _duo.health.max_health, true)


func _on_duo_killed(victim: int, killer: int) -> void:
	if killer != team or victim == team:
		return
	var streak := _current_streak()
	_kill_title.text = "ELIMINATION" if streak < 2 else ("ON FIRE" if streak < 5 else "UNSTOPPABLE")
	_kill_streak.text = "+1 KILL" if streak < 2 else "%d KILL STREAK" % streak
	if _celebration_tween and _celebration_tween.is_valid():
		_celebration_tween.kill()
	_celebration.visible = true
	_celebration.modulate.a = 1.0
	_celebration.pivot_offset = Vector2(175, 45)
	_celebration.scale = Vector2(1.2, 1.2)
	_celebration_tween = create_tween()
	_celebration_tween.tween_property(_celebration, "scale", Vector2.ONE, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_celebration_tween.tween_interval(1.6)
	_celebration_tween.tween_property(_celebration, "modulate:a", 0.0, 0.35)
	_celebration_tween.tween_callback(func(): _celebration.visible = false)


func _current_streak() -> int:
	return int(MatchStats.teams[team].get("streak", 0)) if team < MatchStats.teams.size() else 0


func _ignore_mouse(node: Node) -> void:
	if node is Control:
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for child in node.get_children():
		_ignore_mouse(child)
