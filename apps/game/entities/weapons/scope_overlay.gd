## Sniper scope picture for one player's screen: black outside a circle plus thin crosshair
## lines. Shows itself while that Duo is scoped. Add one per split-screen half (full rect).
class_name ScopeOverlay
extends ColorRect

const SHADER_CODE := """
shader_type canvas_item;
uniform float aspect = 1.0;
uniform float radius = 0.46;
void fragment() {
	vec2 p = UV - 0.5;
	p.x *= aspect;
	float d = length(p);
	float outside = smoothstep(radius - 0.004, radius, d);
	float rim = smoothstep(radius - 0.014, radius - 0.004, d) * (1.0 - outside);
	float lines = clamp(step(abs(p.x), 0.0016) + step(abs(p.y), 0.0016), 0.0, 1.0) * step(0.06, d);
	COLOR = vec4(0.0, 0.0, 0.0, max(outside, max(rim * 0.9, lines * 0.85)));
}
"""

static var _shader: Shader

@export var weapons: WeaponComponent
@export_range(0.1, 0.5) var radius := 0.46   ## circle size, as a fraction of the screen height


func _init(for_weapons: WeaponComponent = null) -> void:
	weapons = for_weapons
	name = "ScopeOverlay"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER_CODE
	var mat := ShaderMaterial.new()
	mat.shader = _shader
	material = mat
	visible = false


func _process(_delta: float) -> void:
	var duo := weapons.body if weapons else null
	var on: bool = weapons != null and weapons.scoped and (duo == null or not ("alive" in duo) or duo.alive)
	visible = on
	if on:
		var m := material as ShaderMaterial
		m.set_shader_parameter("aspect", size.x / maxf(size.y, 1.0))
		m.set_shader_parameter("radius", radius)
