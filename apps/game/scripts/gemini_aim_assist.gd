## Optional, low-frequency Gemini target selector. The local phone aim loop never waits on this.
extends Node

signal correction_ready(team: int, degrees_per_second: Vector2)

@export var endpoint := "https://skillissue.vodka/api/aim-assist"
@export var request_interval := 0.35

var _requests: Dictionary = {}
var _last_request: Dictionary = {}

func request(team: int, crosshair: Vector2, targets: Array[Dictionary]) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	if _requests.has(team) or now - float(_last_request.get(team, -INF)) < request_interval:
		return
	_last_request[team] = now
	var http := HTTPRequest.new()
	add_child(http)
	_requests[team] = http
	http.request_completed.connect(func(_result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray):
		_requests.erase(team)
		http.queue_free()
		if response_code < 200 or response_code >= 300:
			return
		var value: Variant = JSON.parse_string(body.get_string_from_utf8())
		if typeof(value) != TYPE_DICTIONARY:
			return
		var correction := Vector2(float(value.get("dxDegreesPerSecond", 0.0)), float(value.get("dyDegreesPerSecond", 0.0)))
		var confidence := clampf(float(value.get("confidence", 0.0)), 0.0, 1.0)
		correction_ready.emit(team, correction * confidence)
	)
	var payload := {"crosshair": {"x": crosshair.x, "y": crosshair.y}, "targets": targets}
	var error := http.request(endpoint, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(payload))
	if error != OK:
		_requests.erase(team)
		http.queue_free()
