## Turns one controller's `motion` payloads into game input. Pure math, no networking,
## so it can be tuned and tested on its own. InputRouter keeps one per controller.
##
## Two input paths, checked in this order:
##   1. payload.controls {moveX, moveY, lookX, lookY} in -1..1: the companion app already
##      computes these on the phone (calibration, deadzones). Proposed protocol extension.
##   2. The MotionReading fields (packages/protocol/events.ts): tilt from `accelerometer`
##      (must include gravity) for the mover, rotation rate from `gyroscope` for the gunner.
## AR fields (arPosition / arOrientation) are not used yet, so `trackingStatus` doesn't gate
## anything here. Axis directions and units still need confirming on real phones.
## Loaded by path (InputRouter preloads it) rather than by class_name.
extends RefCounted

# --- mover: tilt → move (x = right, y = forward, length 0..1)
var tilt_deadzone_deg := 5.0
var tilt_max_deg := 20.0
var forward_axis := Vector3(1, 0, 0)   ## phone axis whose rotation means "lean forward"
var right_axis := Vector3(0, 1, 0)     ## phone axis whose rotation means "lean right"

# --- gunner: rotation rate → aim (radians per second; x = turn right, y = look up)
var gyro_in_degrees := false           ## expo-sensors Gyroscope reports rad/s
var yaw_axis := Vector3(0, -1, 0)      ## turning the phone right spins it about -y (portrait)
var pitch_axis := Vector3(1, 0, 0)     ## tilting the top toward you spins it about +x
var aim_deadzone_deg := 1.5            ## per second; filters hand tremor
var aim_max_rate_deg := 130.0          ## what lookX/lookY = 1.0 means (controls path)
var aim_sensitivity := 1.0

## Readings older than this stop affecting the character.
var stale_after_msec := 250

var move := Vector2.ZERO
var aim_rate := Vector2.ZERO

var _neutral := Vector3.ZERO           ## gravity direction at calibration; zero = not yet
var _last_msec := -1


## The next tilt reading becomes "standing still". Called on assignment and on "ready".
func calibrate() -> void:
	_neutral = Vector3.ZERO
	clear()


func clear() -> void:
	move = Vector2.ZERO
	aim_rate = Vector2.ZERO
	_last_msec = -1


func is_stale(now_msec: int) -> bool:
	return _last_msec < 0 or now_msec - _last_msec > stale_after_msec


## Reads one motion payload for the given game role. Returns false if nothing usable.
func feed(payload: Dictionary, role: String, now_msec: int) -> bool:
	var controls: Variant = payload.get("controls")
	if typeof(controls) == TYPE_DICTIONARY:
		return _feed_controls(controls, role, now_msec)
	# packages/protocol MotionReading puts the sensor fields directly in the payload;
	# an older draft nested them under `readings`. Accept both.
	var readings: Variant = payload.get("readings", payload)
	if typeof(readings) != TYPE_DICTIONARY:
		return false
	if role == "mover":
		var acc: Variant = _vec3((readings as Dictionary).get("accelerometer"))
		if acc == null:
			return false
		move = _tilt_to_move(acc)
	else:
		var gyro: Variant = _vec3((readings as Dictionary).get("gyroscope"))
		if gyro == null:
			return false
		aim_rate = _gyro_to_aim(gyro)
	_last_msec = now_msec
	return true


func _feed_controls(c: Dictionary, role: String, now_msec: int) -> bool:
	for key in ["moveX", "moveY", "lookX", "lookY"]:
		var value: Variant = c.get(key)
		if not (typeof(value) in [TYPE_FLOAT, TYPE_INT]) or not is_finite(float(value)):
			return false
	if role == "mover":
		move = Vector2(_num(c.get("moveX")), _num(c.get("moveY"))).limit_length(1.0)
	else:
		var look := Vector2(clampf(_num(c.get("lookX")), -1.0, 1.0), clampf(_num(c.get("lookY")), -1.0, 1.0))
		aim_rate = look * deg_to_rad(aim_max_rate_deg) * aim_sensitivity
	_last_msec = now_msec
	return true


func _tilt_to_move(acc: Vector3) -> Vector2:
	if acc.length() < 0.001:
		return Vector2.ZERO
	var g := acc.normalized()
	if _neutral == Vector3.ZERO:
		_neutral = g
		return Vector2.ZERO
	# The cross product of the two gravity directions is the rotation (sin of the angle)
	# that took the phone from its neutral pose to now; project it on each lean axis.
	var r := _neutral.cross(g)
	var fwd := rad_to_deg(asin(clampf(r.dot(forward_axis), -1.0, 1.0)))
	var right := rad_to_deg(asin(clampf(r.dot(right_axis), -1.0, 1.0)))
	return Vector2(_tilt_amount(right), _tilt_amount(fwd)).limit_length(1.0)


func _tilt_amount(deg: float) -> float:
	var a := absf(deg)
	if a < tilt_deadzone_deg:
		return 0.0
	return signf(deg) * clampf((a - tilt_deadzone_deg) / maxf(tilt_max_deg - tilt_deadzone_deg, 0.001), 0.0, 1.0)


func _gyro_to_aim(gyro: Vector3) -> Vector2:
	var rate := gyro * (deg_to_rad(1.0) if gyro_in_degrees else 1.0)
	var aim := Vector2(rate.dot(yaw_axis), rate.dot(pitch_axis))
	var dead := deg_to_rad(aim_deadzone_deg)
	if absf(aim.x) < dead:
		aim.x = 0.0
	if absf(aim.y) < dead:
		aim.y = 0.0
	return aim * aim_sensitivity


static func _num(v: Variant) -> float:
	return float(v) if (typeof(v) == TYPE_FLOAT or typeof(v) == TYPE_INT) and is_finite(float(v)) else 0.0


## {x, y, z} with numeric fields → Vector3, else null.
static func _vec3(v: Variant) -> Variant:
	if typeof(v) != TYPE_DICTIONARY:
		return null
	var d: Dictionary = v
	for k in ["x", "y", "z"]:
		if not (typeof(d.get(k)) in [TYPE_FLOAT, TYPE_INT]) or not is_finite(float(d[k])):
			return null
	return Vector3(d.x, d.y, d.z)
