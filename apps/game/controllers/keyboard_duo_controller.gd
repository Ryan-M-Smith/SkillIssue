## Desk-testing controller: lets one or two people play a full match on one laptop.
## Kept small on purpose: move, jump, crouch, sprint, aim, fire, scope, swap gun. Reloading is
## automatic, and the pickup guns disappear when they run dry.
##   Blue (left hand + mouse):  WASD move, Space jump, C crouch, hold Shift sprint,
##                              mouse aim (click to capture), left click fire, right click scope,
##                              Q or mouse wheel swap gun. Esc releases the mouse.
##   Red (right side of keys):  IJKL move, U jump, O crouch, hold P sprint,
##                              arrow keys aim, Enter fire, / scope, . (period) swap gun.
class_name KeyboardDuoController
extends DuoController

@export var scheme := 0
@export var mouse_sensitivity := 0.0025   ## radians per pixel
@export var key_turn_speed := 2.6         ## radians per second

var _mouse_accum := Vector2.ZERO
var _prev := {}
var _wheel := 0


func _init(scheme_id: int = 0) -> void:
	scheme = scheme_id
	name = "KeyboardController%d" % scheme_id


func _host_only() -> bool:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return false
	var session := tree.root.get_node_or_null("GameSession")
	var network := tree.root.get_node_or_null("NetworkClient")
	return (session != null and session.is_playing()) or (network != null and network.is_connected_to_server())


func _unhandled_input(event: InputEvent) -> void:
	if _host_only() or scheme != 0:
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		_wheel = 1 if event.button_index == MOUSE_BUTTON_WHEEL_DOWN else -1
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_mouse_accum += Vector2(event.relative.x, -event.relative.y) * mouse_sensitivity


func _key(k) -> bool:
	return Input.is_physical_key_pressed(k)


func _pressed_once(id: String, now: bool) -> bool:
	var was: bool = _prev.get(id, false)
	_prev[id] = now
	return now and not was


func poll(input: DuoInput, delta: float) -> void:
	if _host_only():
		_mouse_accum = Vector2.ZERO
		_prev.clear()
		return
	var mv := Vector2.ZERO
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if scheme == 0:
		mv = Vector2(float(_key(KEY_D)) - float(_key(KEY_A)), float(_key(KEY_W)) - float(_key(KEY_S)))
		input.crouch = input.crouch or _key(KEY_C)
		input.sprint = input.sprint or _key(KEY_SHIFT)
		input.fire = input.fire or (captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))
		input.aim_delta += _mouse_accum
		_mouse_accum = Vector2.ZERO
		if _pressed_once("jump", _key(KEY_SPACE)): input.jump = true
		if _pressed_once("scope", captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)): input.scope_toggle = true
		if _pressed_once("swap", _key(KEY_Q)): input.weapon_cycle = 1
		if _wheel != 0:
			input.weapon_cycle = _wheel
			_wheel = 0
	else:
		mv = Vector2(float(_key(KEY_L)) - float(_key(KEY_J)), float(_key(KEY_I)) - float(_key(KEY_K)))
		var turn := Vector2(float(_key(KEY_RIGHT)) - float(_key(KEY_LEFT)), float(_key(KEY_UP)) - float(_key(KEY_DOWN)))
		input.aim_delta += turn * key_turn_speed * delta
		input.crouch = input.crouch or _key(KEY_O)
		input.sprint = input.sprint or _key(KEY_P)
		input.fire = input.fire or _key(KEY_ENTER) or _key(KEY_KP_ENTER)
		if _pressed_once("jump", _key(KEY_U)): input.jump = true
		if _pressed_once("scope", _key(KEY_SLASH)): input.scope_toggle = true
		if _pressed_once("swap", _key(KEY_PERIOD)): input.weapon_cycle = 1
	input.move += mv.normalized() if mv.length() > 1.0 else mv
