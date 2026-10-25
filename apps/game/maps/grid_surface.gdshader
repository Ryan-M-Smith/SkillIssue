// Map surfaces: flat gray base color + a faint 1 m world-space grid, with vertical faces a
// little darker than floors. Makes walls, floors and the edges where they meet easy to read,
// and the grid helps judge distance and speed. Cheap, no textures.
shader_type spatial;

uniform vec4 base_color : source_color = vec4(0.55, 0.55, 0.57, 1.0);
uniform float grid_size = 1.0;
uniform float line_strength = 0.18;
uniform float wall_shade = 0.8;      // vertical faces = base * this

varying vec3 world_pos;
varying vec3 world_normal;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = abs(world_normal);
	vec2 uv = n.y > 0.5 ? world_pos.xz : (n.x > 0.5 ? world_pos.zy : world_pos.xy);
	uv /= grid_size;
	vec2 g = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(0.0001));
	float line = 1.0 - min(min(g.x, g.y), 1.0);
	float shade = mix(wall_shade, 1.0, n.y);
	ALBEDO = base_color.rgb * shade * (1.0 - line_strength * line);
	ROUGHNESS = 0.9;
}
