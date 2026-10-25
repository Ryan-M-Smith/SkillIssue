## Autoload `MvpService`: works out the match MVP and their raccoon badge in the background,
## starting at the final whistle (DuoSandbox calls `begin()` right after MatchStats.finish),
## so both are usually ready by the time the results screen opens.
##   1. POST /api/mvp        Gemini judges the match (MvpJudge builds the report; local rule if offline)
##   2. POST /api/mvp/badge  Gemini draws a raccoon badge for that accolade, or, with no MVP,
##                           tumbleweeds and a sly noir raccoon lurking. Without it the results
##                           screen draws its own (ui/mvp_badge.gd).
## The results screen reads `pick` / `badge` and listens for the signals if they aren't in yet.
extends Node

signal pick_ready(pick: Dictionary)
signal badge_ready(texture: Texture2D)

const BADGE_TIMEOUT_SECONDS := 30.0

var pick := {}                    ## empty until judged
var badge: Texture2D = null       ## null until drawn (or if it couldn't be)
var badge_failed := false
var judging := false              ## begin() is waiting for the judge
var _job := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # keeps working through the paused end banner


## Start judging the match that MatchStats just finished. Replaces any earlier job.
func begin() -> void:
	_job += 1
	var job := _job
	pick = {}
	badge = null
	badge_failed = false
	judging = true
	var result: Dictionary = await MvpJudge.decide(self)
	if job != _job:
		return
	judging = false
	pick = result
	pick_ready.emit(pick)
	_draw_badge(job, result)


## Forget the last match (a new one is starting).
func clear() -> void:
	_job += 1
	pick = {}
	badge = null
	badge_failed = false
	judging = false


func _draw_badge(job: int, result: Dictionary) -> void:
	var control_plane := NetworkClient.configured_control_plane_url()
	if control_plane.is_empty():
		_badge_done(job, null)   # offline: the results screen draws its own
		return
	var body := {"kind": "none"}
	if not str(result.get("id", "")).is_empty():
		body = {
			"kind": "mvp", "role": result.role, "team": "blue" if int(result.team) == 0 else "red",
			"headline": result.headline, "reason": result.reason,
		}
	var request := HTTPRequest.new()
	request.timeout = BADGE_TIMEOUT_SECONDS
	request.max_redirects = 2
	add_child(request)
	var endpoint := control_plane.trim_suffix("/") + "/api/mvp/badge"
	if request.request(endpoint, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(body)) != OK:
		request.queue_free()
		_badge_done(job, null)
		return
	var response: Array = await request.request_completed
	request.queue_free()
	if response.size() < 4 or int(response[0]) != HTTPRequest.RESULT_SUCCESS or int(response[1]) != 200:
		_badge_done(job, null)
		return
	_badge_done(job, _decode(response[2], response[3]))


func _badge_done(job: int, texture: Texture2D) -> void:
	if job != _job:
		return
	badge = texture
	badge_failed = texture == null
	badge_ready.emit(texture)


static func _decode(headers: PackedStringArray, bytes: PackedByteArray) -> Texture2D:
	var type := ""
	for h in headers:
		if h.to_lower().begins_with("content-type:"):
			type = h.substr(13).strip_edges().to_lower()
	var image := Image.new()
	var error := ERR_FILE_UNRECOGNIZED
	if type.contains("png"):
		error = image.load_png_from_buffer(bytes)
	elif type.contains("jpeg") or type.contains("jpg"):
		error = image.load_jpg_from_buffer(bytes)
	elif type.contains("webp"):
		error = image.load_webp_from_buffer(bytes)
	if error != OK or image.is_empty():
		return null
	image.generate_mipmaps()
	return ImageTexture.create_from_image(image)
