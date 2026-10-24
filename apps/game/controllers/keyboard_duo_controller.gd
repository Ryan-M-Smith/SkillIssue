## Desk-testing controller: lets one or two people play a full match on one laptop.
##   Scheme 0 (Blue): WASD move, Space jump, Ctrl crouch, mouse aim (click to capture),
##                    LMB fire, RMB scope, 1/2/3 guns, Esc releases mouse.
##   Scheme 1 (Red):  IJKL move, Shift jump, N crouch, arrow keys aim,
##                    Enter fire, M scope, 8/9/0 guns.
class_name KeyboardDuoController
extends DuoController

@export var scheme := 0
@export var mouse_sensitivity := 0.0025   ## radians per pixel
@export var key_turn_speed := 2.6         ## radians per second

var _mouse_accum := Vector2.ZERO
var _prev := {}


func _init(scheme_id: int = 0) -> void:
	scheme = scheme_id
	name = "KeyboardController%d" % scheme_id


func _unhandled_input(event: InputEvent) -> void:
	if scheme != 0:
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_mouse_accum += Vector2(event.relative.x, -event.relative.y) * mouse_sensitivity


func _key(k) -> bool:
	return Input.is_physical_key_pressed(k)


func _pressed_once(id: String, now: bool) -> bool:
	var was: bool = _prev.get(id, false)
	_prev[id] = now
	return now and not was


func poll(input: DuoInput, delta: float) -> void:
	var mv := Vector2.ZERO
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if scheme == 0:
		mv = Vector2(float(_key(KEY_D)) - float(_key(KEY_A)), float(_key(KEY_W)) - float(_key(KEY_S)))
		input.crouch = input.crouch or _key(KEY_CTRL)
		input.fire = input.fire or (captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))
		input.aim_delta += _mouse_accum
		_mouse_accum = Vector2.ZERO
		if _pressed_once("jump", _key(KEY_SPACE)): input.jump = true
		if _pressed_once("scope", captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)): input.scope_toggle = true
		for i in 3:
			if _pressed_once("w%d" % i, _key(KEY_1 + i)): input.weapon_slot = i
	else:
		mv = Vector2(float(_key(KEY_L)) - float(_key(KEY_J)), float(_key(KEY_I)) - float(_key(KEY_K)))
		var turn := Vector2(float(_key(KEY_RIGHT)) - float(_key(KEY_LEFT)), float(_key(KEY_UP)) - float(_key(KEY_DOWN)))
		input.aim_delta += turn * key_turn_speed * delta
		input.crouch = input.crouch or _key(KEY_N)
		input.fire = input.fire or _key(KEY_ENTER)
		if _pressed_once("jump", _key(KEY_SHIFT)): input.jump = true
		if _pressed_once("scope", _key(KEY_M)): input.scope_toggle = true
		var keys := [KEY_8, KEY_9, KEY_0]
		for i in 3:
			if _pressed_once("w%d" % i, _key(keys[i])): input.weapon_slot = i
	input.move += mv.normalized() if mv.length() > 1.0 else mv
