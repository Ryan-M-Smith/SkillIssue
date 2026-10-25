// Mystery box: a see-through cube split corner to corner, red on one side and blue on the
// other (it could help your team or hurt it), with a bright seam and a slow glow pulse.
shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_disabled;

uniform vec4 color_a : source_color = vec4(1.0, 0.29, 0.29, 1.0);   // red half
uniform vec4 color_b : source_color = vec4(0.23, 0.55, 1.0, 1.0);   // blue half
uniform float alpha : hint_range(0.0, 1.0) = 0.55;
uniform float glow = 1.4;
uniform float seam_width = 0.03;

varying vec3 local_pos;

void vertex() {
	local_pos = VERTEX;   // the mesh's own space, so the split turns with the cube
}

void fragment() {
	float d = local_pos.x + local_pos.y;   // 0 on the diagonal plane through the center
	vec3 c = d > 0.0 ? color_a.rgb : color_b.rgb;
	float seam = 1.0 - smoothstep(0.0, seam_width, abs(d));
	c = mix(c, vec3(1.0), seam);
	float pulse = 0.75 + 0.25 * sin(TIME * 3.0);
	ALBEDO = c;
	EMISSION = c * glow * pulse;
	ALPHA = mix(alpha, 1.0, seam);
	ROUGHNESS = 0.3;
}
