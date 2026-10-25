## The MVP card's picture.
##   mvp:  the Gemini raccoon badge for the player's accolade, cropped to a medallion with a
##         team-colored ring; "developing" while it's on its way; a drawn raccoon medal if it
##         never comes (offline).
##   none: no MVP: Gemini's noir scene (tumbleweeds, a sly black-and-white raccoon lurking).
##         Only ever Gemini's picture; the results screen leaves it out if none arrives.
extends Control

const MASK_SHADER := """
shader_type canvas_item;
uniform bool round = true;      // medallion; else a rounded panel
uniform bool mono = false;      // force black and white (noir)
uniform float develop = 1.0;    // 0..1: fades up from a dark, grainy print
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec2 p = UV - 0.5;
	float inside = round ? 1.0 - smoothstep(0.495, 0.5, length(p))
		: (1.0 - smoothstep(0.47, 0.5, abs(p.x))) * (1.0 - smoothstep(0.44, 0.5, abs(p.y)));
	vec3 col = c.rgb;
	if (mono) col = vec3(dot(col, vec3(0.3, 0.59, 0.11)));
	float vignette = 1.0 - dot(p, p) * (round ? 0.9 : 1.4);
	col *= vignette * mix(0.15, 1.0, develop);
	COLOR = vec4(col, c.a * inside);
}
"""

var mode := "mvp"
var color := UiKit.INK
var texture: Texture2D = null
var failed := false

var _picture: TextureRect
var _overlay: Control   # drawn above the picture: the medal ring
var _material: ShaderMaterial
var _shown_at := -1.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	_picture = TextureRect.new()
	_picture.set_anchors_preset(Control.PRESET_FULL_RECT)
	_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED if mode == "none" else TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = MASK_SHADER
	_material = ShaderMaterial.new()
	_material.shader = shader
	_material.set_shader_parameter("round", mode == "mvp")
	_material.set_shader_parameter("mono", mode == "none")
	_picture.material = _material
	add_child(_picture)
	_overlay = Control.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.draw.connect(_draw_overlay)
	add_child(_overlay)
	if texture:
		show_texture(texture)


## The generated picture arrived: develop it in like a print.
func show_texture(t: Texture2D) -> void:
	texture = t
	failed = false
	if _picture == null:
		return
	_picture.texture = t
	_shown_at = Time.get_ticks_msec() / 1000.0


## No picture is coming: draw our own.
func show_fallback() -> void:
	if texture == null:
		failed = true


func _process(_delta: float) -> void:
	if _shown_at >= 0.0:
		_material.set_shader_parameter("develop", clampf((Time.get_ticks_msec() / 1000.0 - _shown_at) / 1.2, 0.0, 1.0))
	queue_redraw()
	_overlay.queue_redraw()


func _draw_overlay() -> void:
	if mode != "none":
		_draw_ring()


func _draw() -> void:
	if mode != "none":
		_draw_medal(Time.get_ticks_msec() / 1000.0)


# ---------------------------------------------------------------- MVP medal

func _draw_medal(t: float) -> void:
	var c := size * 0.5
	var r := minf(size.x, size.y) * 0.5 - 6.0
	if texture == null:
		draw_circle(c, r, Color(0.06, 0.06, 0.06))
		if failed:
			_draw_raccoon(c + Vector2(0, r * 0.06), r * 0.62, 1.0, t)
		else:
			# Developing: a slow sweep across a dark print.
			var a := fmod(t * 1.6, TAU)
			draw_arc(c, r * 0.82, a, a + 1.2, 32, Color(1, 1, 1, 0.18), 3.0, true)
			_draw_raccoon(c + Vector2(0, r * 0.06), r * 0.62, 0.18 + 0.08 * sin(t * 3.0), t)


## The medal's rim, above the picture.
func _draw_ring() -> void:
	var c := size * 0.5
	var r := minf(size.x, size.y) * 0.5 - 6.0
	var o := _overlay
	o.draw_arc(c, r + 1.0, 0, TAU, 96, color, 5.0, true)
	o.draw_arc(c, r - 6.0, 0, TAU, 96, Color(color, 0.35), 1.5, true)
	for i in 24:   # milled edge, like a medal
		var dir := Vector2.from_angle(TAU * i / 24.0)
		o.draw_line(c + dir * (r + 5.0), c + dir * (r + 10.0), Color(color, 0.7), 2.0, true)


## A simple raccoon face: gray head, black mask, white brows and muzzle, glinting eyes.
func _draw_raccoon(c: Vector2, s: float, alpha: float, t: float) -> void:
	var gray := Color(0.55, 0.55, 0.54, alpha)
	var dark := Color(0.04, 0.04, 0.04, alpha)
	var white := Color(0.92, 0.91, 0.88, alpha)
	for side in [-1.0, 1.0]:
		draw_colored_polygon(PackedVector2Array([c + Vector2(side * s * 0.78, -s * 0.38), c + Vector2(side * s * 0.62, -s * 0.98), c + Vector2(side * s * 0.22, -s * 0.66)]), gray)
		draw_colored_polygon(PackedVector2Array([c + Vector2(side * s * 0.66, -s * 0.48), c + Vector2(side * s * 0.6, -s * 0.82), c + Vector2(side * s * 0.36, -s * 0.62)]), dark)
	draw_circle(c, s * 0.8, gray)
	draw_circle(c + Vector2(0, s * 0.42), s * 0.4, white)   # muzzle
	for side in [-1.0, 1.0]:
		draw_circle(c + Vector2(side * s * 0.3, -s * 0.36), s * 0.2, white)   # brows
		draw_colored_polygon(PackedVector2Array([   # the bandit mask
			c + Vector2(side * s * 0.05, -s * 0.1), c + Vector2(side * s * 0.36, -s * 0.28),
			c + Vector2(side * s * 0.78, -s * 0.06), c + Vector2(side * s * 0.62, s * 0.2),
			c + Vector2(side * s * 0.2, s * 0.12)]), dark)
		var eye := c + Vector2(side * s * 0.38, -s * 0.05)
		draw_circle(eye, s * 0.085, white)
		draw_circle(eye + Vector2(s * 0.02 * sin(t * 0.7), 0), s * 0.045, dark)
	draw_circle(c + Vector2(0, s * 0.3), s * 0.1, dark)   # nose
