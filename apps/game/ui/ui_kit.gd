## Shared look for the menus: palette, fonts, theme, the animated red/blue background,
## and small builders. Every screen builds its UI in code from these.
class_name UiKit
extends RefCounted

const BLUE := Color(0.23, 0.55, 1.0)
const RED := Color(1.0, 0.29, 0.29)
const BG := Color(0.027, 0.035, 0.07)
const PANEL := Color(0.06, 0.075, 0.13, 0.86)
const INK := Color(0.95, 0.96, 1.0)
const MUTED := Color(0.56, 0.6, 0.72)
const LINE := Color(1, 1, 1, 0.14)
const READY := Color(0.33, 0.93, 0.65)
const GOLD := Color(1.0, 0.8, 0.32)

const DISPLAY := "res://ui/fonts/ChakraPetch-Bold.ttf"
const DISPLAY_SEMI := "res://ui/fonts/ChakraPetch-SemiBold.ttf"
const BODY := "res://ui/fonts/BarlowSemiCondensed-Medium.ttf"
const BODY_SEMI := "res://ui/fonts/BarlowSemiCondensed-SemiBold.ttf"
const BODY_BOLD := "res://ui/fonts/BarlowSemiCondensed-Bold.ttf"

const BACKGROUND_SHADER := """
shader_type canvas_item;
uniform vec4 blue : source_color = vec4(0.23, 0.55, 1.0, 1.0);
uniform vec4 red : source_color = vec4(1.0, 0.29, 0.29, 1.0);
uniform vec4 base : source_color = vec4(0.027, 0.035, 0.07, 1.0);
uniform float split = 0.5;     // where the seam sits, 0..1 across the screen
uniform float energy = 1.0;    // seam glow strength
uniform float aspect = 1.7778;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	float t = TIME;
	// A tilted seam that breathes a little.
	float seam = split + (uv.y - 0.5) * 0.28 + 0.025 * sin(uv.y * 4.0 + t * 0.8);
	float side = smoothstep(seam - 0.002, seam + 0.002, uv.x);
	vec3 team = mix(blue.rgb, red.rgb, side);
	float d = abs(uv.x - seam) * aspect;
	// Stripes that run away from the seam on each side.
	float dir = side > 0.5 ? 1.0 : -1.0;
	float lanes = fract((uv.x * aspect + uv.y * 0.55) * 9.0 - dir * t * 0.35);
	float stripes = smoothstep(0.0, 0.05, lanes) * (1.0 - smoothstep(0.08, 0.13, lanes));
	float near = exp(-d * 1.6);
	vec3 col = base.rgb;
	col += team * (0.16 * near + 0.07 * stripes * near);
	col += team * exp(-d * 34.0) * 0.9 * energy;
	col += vec3(1.0) * exp(-d * 260.0) * 0.55 * energy;
	vec2 c = uv - 0.5;
	col *= 1.0 - dot(c, c) * 1.1;
	col += (hash(uv * vec2(1280.0, 720.0) + fract(t)) - 0.5) * 0.025;
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

	var normal := _button_box(Color(0.08, 0.1, 0.17, 0.92), LINE)
	var hover := _button_box(Color(0.12, 0.15, 0.25, 0.96), Color(1, 1, 1, 0.55))
	var pressed := _button_box(Color(0.16, 0.2, 0.32, 1.0), INK)
	var disabled := _button_box(Color(0.06, 0.07, 0.11, 0.7), Color(1, 1, 1, 0.06))
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

	# Primary: a white slab with dark type.
	t.set_type_variation("PrimaryButton", "Button")
	t.set_stylebox("normal", "PrimaryButton", _button_box(Color(0.95, 0.96, 1.0), Color(0, 0, 0, 0)))
	t.set_stylebox("hover", "PrimaryButton", _button_box(Color.WHITE, GOLD, 3))
	t.set_stylebox("pressed", "PrimaryButton", _button_box(Color(0.8, 0.84, 0.95), Color(0, 0, 0, 0)))
	t.set_stylebox("focus", "PrimaryButton", _button_box(Color(0, 0, 0, 0), GOLD, 3))
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
	b.skew = Vector2(0.22, 0)
	b.set_corner_radius_all(3)
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
	b.set_corner_radius_all(6)
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
	return b


## "SKILL ISSUE" with the words in the two team colors.
static func wordmark(size := 120) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(size * 0.22))
	row.add_child(display("SKILL", size, BLUE))
	row.add_child(display("ISSUE", size, RED))
	return row


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
