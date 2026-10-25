// Noir city surfaces, all procedural (no textures): concrete, wet asphalt, brick, corrugated
// metal, wooden crates, painted metal, and lit building windows. Everything stays in muted
// grays so the red and blue Duos are the most colorful things on screen.
// Patterns are in world space, so they line up across separate boxes.
shader_type spatial;

uniform int pattern = 0;   // 0 concrete, 1 asphalt, 2 brick, 3 corrugated metal, 4 crate wood, 5 painted metal, 6 windows
uniform vec4 base_color : source_color = vec4(0.42, 0.42, 0.44, 1.0);
uniform float panel_size = 2.0;      // concrete panel seams (m); also a distance cue like the old grid
uniform float seam_strength = 0.28;
uniform float wetness = 0.55;        // how much of the floor is puddled
uniform float lit_windows = 0.35;    // share of windows with the lights on
uniform vec4 window_color : source_color = vec4(0.92, 0.93, 0.96, 1.0);

varying vec3 world_pos;
varying vec3 world_normal;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
	           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}

// 0 on a line, 1 away from it; anti-aliased with fwidth.
float lines(vec2 uv, float width) {
	vec2 g = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(0.0001));
	return clamp(min(g.x, g.y) - width, 0.0, 1.0);
}

float line_1d(float v, float width) {
	float g = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 0.0001);
	return clamp(g - width, 0.0, 1.0);
}

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = abs(world_normal);
	bool floor_face = n.y > 0.5;
	// horizontal axis along the wall, vertical = world Y
	vec2 uv = floor_face ? world_pos.xz : (n.x > 0.5 ? vec2(world_pos.z, world_pos.y) : vec2(world_pos.x, world_pos.y));
	vec3 col = base_color.rgb;
	float rough = 0.9;
	float metal = 0.0;
	vec3 emit = vec3(0.0);
	float mottle = mix(0.92, 1.04, fbm(uv * 0.35));   // kept subtle: a flat, graphic look
	float speck = mix(0.96, 1.03, noise(uv * 18.0));

	if (pattern == 0) {            // concrete: panels, stains
		col *= mottle * speck;
		col *= mix(1.0 - seam_strength, 1.0, lines(uv / panel_size, 0.6));
		col *= mix(0.9, 1.0, smoothstep(0.25, 0.6, fbm(uv * 0.9 + 7.0)));
	} else if (pattern == 1) {     // asphalt: speckled, darker
		col *= mottle * mix(0.88, 1.08, noise(uv * 30.0));
		col *= mix(1.0 - seam_strength * 0.6, 1.0, lines(uv / (panel_size * 2.0), 0.4));
	} else if (pattern == 2) {     // brick
		if (floor_face) {
			col *= mottle * speck;
		} else {
			vec2 b = uv / vec2(0.5, 0.22);
			float row = floor(b.y);
			b.x += mod(row, 2.0) * 0.5;
			vec2 id = floor(b);
			float mortar = lines(b * vec2(1.0, 1.0), 0.9);
			float tone = mix(0.9, 1.06, hash(id));
			col = mix(min(col * 1.45, vec3(0.92)), col * tone * mottle, mortar);   // light mortar, like a graphic novel wall
			col *= mix(0.82, 1.0, smoothstep(0.2, 0.65, fbm(uv * 0.5 + 3.0)));   // soot
		}
	} else if (pattern == 3) {     // corrugated metal (shipping containers)
		float ridge = 0.86 + 0.14 * sin(uv.x * 6.2832 / 0.25);
		col *= floor_face ? mottle : ridge * mottle;
		col *= mix(0.7, 1.0, smoothstep(0.3, 0.7, fbm(uv * 1.2 + 11.0)));   // rust/grime
		rough = 0.55;
		metal = 0.35;
	} else if (pattern == 4) {     // crate: planks with gaps
		float plank = line_1d(uv.y / 0.28, 1.2);
		float grain = mix(0.85, 1.05, noise(vec2(uv.x * 2.0, uv.y * 40.0)));
		col *= grain * mix(0.45, 1.0, plank) * mix(0.9, 1.05, hash(vec2(floor(uv.y / 0.28), 3.0)));
		rough = 0.85;
	} else if (pattern == 5) {     // painted metal
		col *= speck;
		rough = 0.45;
		metal = 0.5;
	} else if (pattern == 6) {     // building face with windows
		vec2 cell = uv / vec2(2.2, 3.0);
		vec2 id = floor(cell);
		vec2 f = fract(cell);
		float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.8);
		float on = step(1.0 - lit_windows, hash(id + 0.5));
		float blinds = mix(0.55, 1.0, step(0.5, fract(f.y * 9.0)));   // venetian blinds
		col *= mottle;
		col = mix(col, vec3(0.05, 0.055, 0.07), win);
		emit = window_color.rgb * win * on * blinds * mix(0.6, 1.4, hash(id + 9.0)) * 1.6;
		rough = mix(0.9, 0.2, win);
	}

	// wet floors: puddles are darker and glossy, so lamps make highlights in them
	if (floor_face && pattern <= 2) {
		float puddle = smoothstep(0.55 - wetness * 0.25, 0.62 - wetness * 0.25, fbm(world_pos.xz * 0.22 + 21.0));
		col *= mix(1.0, 0.55, puddle);
		rough = mix(rough * 0.8, 0.08, puddle);
	}
	// grime toward the bottom of every vertical face (fake ambient occlusion)
	if (!floor_face) {
		float h = fract(world_pos.y / 3.0);
		col *= mix(0.85, 1.0, smoothstep(0.0, 0.35, h));
	}

	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	EMISSION = emit;
}
