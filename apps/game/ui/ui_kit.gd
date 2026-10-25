## Shared look for the menus: palette, fonts, theme, the animated red/blue background,
## and small builders. Every screen builds its UI in code from these.
class_name UiKit
extends RefCounted

const BLUE := Color(0.23, 0.55, 1.0)
const RED := Color(1.0, 0.29, 0.29)
# Film noir: black, grays and off-white like an old movie title card. Red and blue only as
# small team marks (thin bars, team names, score digits).
const BG := Color(0.03, 0.03, 0.03)
const PANEL := Color(0.05, 0.05, 0.05, 0.88)
const INK := Color(0.9, 0.89, 0.86)
const MUTED := Color(0.55, 0.55, 0.54)
const LINE := Color(1, 1, 1, 0.16)
const READY := Color(0.92, 0.92, 0.9)
const GOLD := Color(1.0, 0.97, 0.9)     # highlight: a hot white

const DISPLAY := "res://ui/fonts/BarlowSemiCondensed-Bold.ttf"
const DISPLAY_SEMI := "res://ui/fonts/BarlowSemiCondensed-SemiBold.ttf"
const BODY := "res://ui/fonts/BarlowSemiCondensed-Medium.ttf"
const BODY_SEMI := "res://ui/fonts/BarlowSemiCondensed-SemiBold.ttf"
const BODY_BOLD := "res://ui/fonts/BarlowSemiCondensed-Bold.ttf"
const SCRIPT := "res://ui/fonts/TeXGyreChorus-MediumItalic.otf"   # title-card script ("presents", "vs.")

const BACKGROUND_SHADER := """
shader_type canvas_item;
// Black-and-white film backdrop: a brick wall in a hard spotlight, drifting smoke,
// film grain, flicker and the odd scratch. The only color is a
// faint blue/red glow along the bottom edge.
uniform vec4 blue : source_color = vec4(0.23, 0.55, 1.0, 1.0);
uniform vec4 red : source_color = vec4(1.0, 0.29, 0.29, 1.0);
uniform float split = 0.5;     // where blue turns to red along the bottom, 0..1
uniform float energy = 1.0;    // strength of that team glow
uniform float aspect = 1.7778;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
	float v = 0.0; float a = 0.5;
	for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
	return v;
}

void fragment() {
	vec2 uv = UV;
	float t = TIME;
	vec2 p = vec2(uv.x * aspect, uv.y);
	// bricks
	vec2 b = p / vec2(0.13, 0.05);
	b.x += mod(floor(b.y), 2.0) * 0.5;
	vec2 id = floor(b);
	vec2 f = fract(b);
	float mortar = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
	float brick = mix(0.55, 0.85, hash(id)) * mix(0.85, 1.0, noise(p * 60.0));
	float wall = mix(0.05, brick, mortar);
	// light: one hard spotlight high on the wall
	float spot = exp(-length((p - vec2(0.42 * aspect, 0.28)) * vec2(0.9, 1.3)) * 2.4);
	float lit = 0.05 + spot * 0.34;
	vec3 col = vec3(wall * lit);
	// smoke, brighter where the light hits it
	float smoke = fbm(p * 3.0 + vec2(t * 0.05, -t * 0.03));
	smoke = smoothstep(0.45, 0.9, smoke);
	col += vec3(0.85) * smoke * (0.04 + spot * 0.12);
	// a faint team glow along the bottom edge
	float side = smoothstep(split - 0.2, split + 0.2, uv.x);
	col += mix(blue.rgb, red.rgb, side) * exp(-(1.0 - uv.y) * 14.0) * 0.12 * energy;
	// film: flicker, grain, scratches, heavy vignette
	col *= 0.96 + 0.04 * hash(vec2(floor(t * 14.0), 3.0));
	col += (hash(uv * vec2(1920.0, 1080.0) + fract(t * 7.0)) - 0.5) * 0.07;
	float lane = floor(uv.x * 420.0);
	float scratch = step(0.9985, hash(vec2(lane, floor(t * 6.0)))) * step(abs(fract(uv.x * 420.0) - 0.5), 0.15);
	col += vec3(0.35) * scratch;
	vec2 c = uv - 0.5;
	col *= clamp(1.0 - dot(c * vec2(1.0, 1.25), c * vec2(1.0, 1.25)) * 2.1, 0.0, 1.0);
	COLOR = vec4(col, 1.0);
}
"""

static var _fonts := {}


static func font(path: String) -> Font:
	if not _fonts.has(path):
		_fonts[path] = load(path)
	return _fonts[path]


static func team_color(team: int) -> Color:
	return BLUE if team == 0 else RED


static func team_name(team: int) -> String:
	return "BLUE" if team == 0 else "RED"


## The theme every menu uses: body font, slanted buttons, panels.
static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = font(BODY)
	t.default_font_size = 22
	t.set_color("font_color", "Label", INK)

	var normal := _button_box(Color(0.04, 0.04, 0.04, 0.82), Color(1, 1, 1, 0.22), 1)
	var hover := _button_box(Color(0.12, 0.12, 0.12, 0.92), Color(1, 1, 1, 0.75), 1)
	var pressed := _button_box(Color(0.2, 0.2, 0.2, 1.0), INK, 1)
	var disabled := _button_box(Color(0.03, 0.03, 0.03, 0.6), Color(1, 1, 1, 0.06), 1)
	var focus := _button_box(Color(0, 0, 0, 0), INK, 2)
	t.set_stylebox("normal", "Button", normal)
	t.set_stylebox("hover", "Button", hover)
	t.set_stylebox("pressed", "Button", pressed)
	t.set_stylebox("disabled", "Button", disabled)
	t.set_stylebox("focus", "Button", focus)
	t.set_font("font", "Button", font(DISPLAY_SEMI))
	t.set_font_size("font_size", "Button", 24)
	t.set_color("font_color", "Button", INK)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_focus_color", "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", Color(1, 1, 1, 0.3))

	# Primary: an off-white slab with dark type.
	t.set_type_variation("PrimaryButton", "Button")
	t.set_stylebox("normal", "PrimaryButton", _button_box(INK, Color(0, 0, 0, 0)))
	t.set_stylebox("hover", "PrimaryButton", _button_box(Color.WHITE, Color.WHITE, 2))
	t.set_stylebox("pressed", "PrimaryButton", _button_box(Color(0.8, 0.79, 0.76), Color(0, 0, 0, 0)))
	t.set_stylebox("focus", "PrimaryButton", _button_box(Color(0, 0, 0, 0), Color.WHITE, 2))
	t.set_color("font_color", "PrimaryButton", BG)
	t.set_color("font_hover_color", "PrimaryButton", BG)
	t.set_color("font_focus_color", "PrimaryButton", BG)
	t.set_color("font_pressed_color", "PrimaryButton", BG)
	return t


static func _button_box(fill: Color, border: Color, border_width := 2) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = fill
	b.border_color = border
	b.set_border_width_all(border_width)
	b.set_corner_radius_all(0)   # flat, square: print-style noir
	b.content_margin_left = 34
	b.content_margin_right = 34
	b.content_margin_top = 12
	b.content_margin_bottom = 12
	return b


static func panel_box(border := LINE, fill := PANEL, skew := 0.0) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = fill
	b.border_color = border
	b.set_border_width_all(2)
	b.set_corner_radius_all(0)
	b.skew = Vector2(skew, 0)
	b.set_content_margin_all(20)
	return b


## Full-screen animated background. `split` moves the red/blue seam (0.5 = middle).
static func background(split := 0.5, energy := 1.0) -> ColorRect:
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = BACKGROUND_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.set_shader_parameter("split", split)
	mat.set_shader_parameter("energy", energy)
	rect.material = mat
	rect.resized.connect(func():
		if rect.size.y > 0:
			mat.set_shader_parameter("aspect", rect.size.x / rect.size.y))
	return rect


static func label(text: String, size := 22, path := BODY, color := INK) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(path))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func display(text: String, size := 64, color := INK) -> Label:
	return label(text, size, DISPLAY, color)


## Small caps-style tag above a heading.
static func eyebrow(text: String, color := MUTED) -> Label:
	var l := label(text.to_upper(), 18, BODY_BOLD, color)
	l.add_theme_constant_override("outline_size", 0)
	return l


static func button(text: String, primary := false) -> Button:
	var b := Button.new()
	b.text = text
	if primary:
		b.theme_type_variation = "PrimaryButton"
	b.focus_mode = Control.FOCUS_ALL
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.pressed.connect(func(): sfx(b, "click"))
	b.mouse_entered.connect(func(): if not b.disabled: sfx(b, "hover"))
	return b


## Plays a sound through the Sfx autoload. Looked up at runtime, not named: UiKit is a global
## class that headless tests compile before autoloads exist. Silent if there's no Sfx.
static func sfx(node: Node, sound: String) -> void:
	var player := node.get_node_or_null("/root/Sfx") if node.is_inside_tree() else null
	if player:
		player.play(sound)


## Old-movie title lettering: off-white face with a deep gray extrusion going down-right.
static func title_3d(text: String, size := 120, face := INK, depth_ratio := 0.12) -> Control:
	var f := font(DISPLAY)
	var sz := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size)
	var depth := maxi(2, int(size * depth_ratio))
	var box := Control.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.custom_minimum_size = Vector2(sz.x + depth, sz.y + depth)
	var shadow := display(text, size, Color(0, 0, 0, 0.55))
	shadow.position = Vector2(depth * 1.6, depth * 1.9)
	box.add_child(shadow)
	for i in range(depth, 0, -1):
		var k := float(i) / depth
		var l := display(text, size, Color(0.07, 0.07, 0.07).lerp(Color(0.34, 0.34, 0.33), 1.0 - k))
		l.position = Vector2(i * 0.75, i)
		box.add_child(l)
	var front := display(text, size, face)
	front.add_theme_color_override("font_outline_color", Color(0.02, 0.02, 0.02))
	front.add_theme_constant_override("outline_size", maxi(2, int(size * 0.02)))
	box.add_child(front)
	return box


## "Skill Issue" as a film title card.
static func wordmark(size := 120) -> Control:
	return title_3d("SKILL ISSUE", size)


## Script line, like "presents" on an old title card.
static func script_line(text: String, size := 34, color := INK) -> Label:
	return label(text, size, SCRIPT, color)


## A dark card whose accent edge is in the team color (the other edges are faint gray).
static func team_card_style(color: Color, edge := "left", fill := Color(0.045, 0.045, 0.045, 0.9)) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = fill
	b.border_color = color
	if edge == "top":
		b.border_width_top = 3
	else:
		b.border_width_left = 4
	b.set_content_margin_all(20)
	b.shadow_color = Color(0, 0, 0, 0.5)
	b.shadow_size = 10
	return b


## Fade a screen in from black.
static func fade_in(parent: Control, seconds := 0.35) -> void:
	var cover := ColorRect.new()
	cover.color = BG
	cover.set_anchors_preset(Control.PRESET_FULL_RECT)
	cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(cover)
	var tw := parent.create_tween()
	tw.tween_property(cover, "modulate:a", 0.0, seconds)
	tw.tween_callback(cover.queue_free)
