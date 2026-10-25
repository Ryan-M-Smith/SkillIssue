## Autoload `Account`: who is signed in on this computer (Auth0: Google or GitHub), and
## the link to the SkillIssue web API (apps/api) that stores matches in Tiger Data.
##
## Sign-in opens the system browser on Auth0's login page (Authorization Code + PKCE).
## Auth0 sends the browser back to http://127.0.0.1:<callback_port>/callback, which this
## node answers, then it trades the code for tokens. Nothing secret lives in the game.
##
## Signed in, the game uploads every finished match (POST /api/matches) with each
## phone's own token, so signed-in players' stats land on the all-time leaderboard.
##
## Settings: Project Settings `skillissue/api_url`, or `-- --api=https://...`. The
## Auth0 tenant, API and client id come from the API itself (GET /api/config).
extends Node

signal changed()                                 ## signed in / out / profile or config loaded
signal sign_in_progress(stage: String)          ## "browser" | "exchanging" | "" (idle)
signal upload_changed(state: String, message: String)

const API_SETTING := "skillissue/api_url"
const DEFAULT_API := "http://127.0.0.1:3000"
const SAVE_PATH := "user://account.cfg"
const SIGN_IN_TIMEOUT := 180.0

@export var callback_port := 7350

var api_url := ""
## {auth: {domain, audience, nativeClientId, connections}, database} or {} until loaded.
var config := {}
var config_error := ""
## {sub, name, picture, provider} when signed in, else {}.
var profile := {}
## "idle" | "uploading" | "saved" | "guest" (not signed in: not saved) | "failed"
var upload_state := "idle"
var upload_message := ""
## The login page opened for the sign-in in progress (to copy if no browser opened).
var authorize_url := ""
## The signed-in player's picture, once downloaded (null until then).
var avatar: Texture2D = null

var _access := ""
var _refresh := ""
var _expires_at := 0.0       ## unix seconds
var _flow := {}              ## sign-in in progress: {verifier, state, provider, started}
var _tcp := TCPServer.new()
var _peer: StreamPeerTCP = null
var _peer_buf := ""


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	api_url = _configured_api()
	_load()
	load_config()
	_load_avatar()


func is_signed_in() -> bool:
	return not profile.is_empty() and not _access.is_empty()


func auth_ready() -> bool:
	return typeof(config.get("auth")) == TYPE_DICTIONARY and not str(config.auth.get("nativeClientId", "")).is_empty()


func is_signing_in() -> bool:
	return not _flow.is_empty()


## Fetches /api/config (where to sign in). Await it if you need the result.
func load_config() -> void:
	var r: Dictionary = await _request(HTTPClient.METHOD_GET, api_url + "/api/config")
	if r.ok and typeof(r.body) == TYPE_DICTIONARY:
		config = r.body
		config_error = "" if auth_ready() else "Sign-in isn't set up on the server yet (Auth0)."
	else:
		config = {}
		config_error = "Can't reach the SkillIssue server at %s." % api_url
	changed.emit()


# ---------------------------------------------------------------- sign in / out

## Opens the browser on Auth0's Google or GitHub login. `provider`: "google" | "github".
func sign_in(provider: String) -> void:
	if not auth_ready():
		await load_config()
		if not auth_ready():
			sign_in_progress.emit("")
			return
	cancel_sign_in()
	var err := _tcp.listen(callback_port, "127.0.0.1")
	if err != OK:
		config_error = "Couldn't open port %d for the sign-in callback." % callback_port
		changed.emit()
		return
	var auth: Dictionary = config.auth
	var verifier := _b64url(Crypto.new().generate_random_bytes(32))
	var state := _b64url(Crypto.new().generate_random_bytes(16))
	_flow = {"verifier": verifier, "state": state, "provider": provider, "started": Time.get_ticks_msec()}
	var params := {
		"response_type": "code",
		"client_id": auth.nativeClientId,
		"redirect_uri": _redirect_uri(),
		"scope": "openid profile email offline_access",
		"audience": auth.audience,
		"connection": auth.connections.get(provider, provider),
		"code_challenge": _b64url(_sha256(verifier.to_utf8_buffer())),
		"code_challenge_method": "S256",
		"state": state,
		"prompt": "login",
	}
	authorize_url = "%sauthorize?%s" % [_auth_base(), _query(params)]
	OS.shell_open(authorize_url)
	sign_in_progress.emit("browser")


func cancel_sign_in() -> void:
	_flow = {}
	_tcp.stop()
	_peer = null
	sign_in_progress.emit("")


func sign_out() -> void:
	profile = {}
	avatar = null
	_access = ""
	_refresh = ""
	_expires_at = 0.0
	DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE_PATH))
	changed.emit()


## A current access token (refreshed if it's about to expire), or "" if signed out.
func access_token() -> String:
	if _access.is_empty():
		return ""
	if _expires_at - 60.0 > Time.get_unix_time_from_system():
		return _access
	if _refresh.is_empty() or not auth_ready():
		sign_out()
		return ""
	var r: Dictionary = await _request(HTTPClient.METHOD_POST, _auth_base() + "oauth/token", {
		"grant_type": "refresh_token", "client_id": config.auth.nativeClientId, "refresh_token": _refresh,
	})
	if not r.ok:
		sign_out()
		return ""
	_take_tokens(r.body)
	return _access


# ---------------------------------------------------------------- match upload

## Uploads a finished match. `players`: GameSession.players entries with team/role,
## `tokens`: controller id -> phone's Auth0 token. Retries a couple of times.
func upload_match(match: Dictionary, players: Array, tokens: Dictionary) -> void:
	if not is_signed_in():
		_set_upload("guest", "Sign in on the main menu to save matches to the leaderboard.")
		return
	var list := []
	for p in players:
		if p.team < 0 or p.role.is_empty():
			continue
		var entry := {"teamId": p.team + 1, "role": "aim" if p.role == "gunner" else "movement", "name": p.name}
		if tokens.has(p.id):
			entry.token = tokens[p.id]
		list.append(entry)
	if list.is_empty():
		_set_upload("idle", "")
		return
	var body := match.duplicate()
	body.players = list
	body.matchKey = _b64url(Crypto.new().generate_random_bytes(12))
	_set_upload("uploading", "Saving the match…")
	for attempt in 3:
		var token: String = await access_token()
		if token.is_empty():
			_set_upload("guest", "Your sign-in expired. Sign in again to save matches.")
			return
		var r: Dictionary = await _request(HTTPClient.METHOD_POST, api_url + "/api/matches", body, token)
		if r.ok:
			var signed: int = int(r.body.get("signedInPlayers", 0))
			_set_upload("saved", "Saved to the leaderboard · %d signed-in player%s" % [signed, "" if signed == 1 else "s"])
			return
		if r.code >= 400 and r.code < 500:
			_set_upload("failed", "Not saved: %s" % r.error)
			return
		await get_tree().create_timer(1.5 * (attempt + 1), true).timeout
	_set_upload("failed", "Couldn't reach the server to save this match.")


func _set_upload(state: String, message: String) -> void:
	upload_state = state
	upload_message = message
	upload_changed.emit(state, message)


# ---------------------------------------------------------------- loopback callback

func _process(_delta: float) -> void:
	if _flow.is_empty():
		return
	if Time.get_ticks_msec() - int(_flow.started) > SIGN_IN_TIMEOUT * 1000.0:
		config_error = "Sign-in timed out. Try again."
		cancel_sign_in()
		changed.emit()
		return
	if _peer == null and _tcp.is_connection_available():
		_peer = _tcp.take_connection()
		_peer_buf = ""
	if _peer == null:
		return
	_peer.poll()
	var available := _peer.get_available_bytes()
	if available > 0:
		_peer_buf += _peer.get_utf8_string(available)
	if not _peer_buf.contains("\r\n\r\n"):
		if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_peer = null
		return
	var line := _peer_buf.get_slice("\r\n", 0)               # GET /callback?code=..&state=.. HTTP/1.1
	var target := line.get_slice(" ", 1)
	if not target.begins_with("/callback"):
		_respond(404, "Not found.")
		return
	var q := _parse_query(target.get_slice("?", 1))
	if q.get("state", "") != _flow.state:
		_respond(400, "This sign-in link is out of date. Go back to the game and try again.")
		return
	if q.has("error"):
		_respond(200, "Sign-in was cancelled: %s" % q.get("error_description", q.error))
		config_error = "Sign-in cancelled."
		cancel_sign_in()
		changed.emit()
		return
	_respond(200, "You're signed in. You can close this tab and go back to the game.")
	var verifier: String = _flow.verifier
	_flow = {}
	_tcp.stop()
	_finish_sign_in(str(q.get("code", "")), verifier)


func _respond(status: int, text: String) -> void:
	var html := """<!doctype html><meta charset="utf-8"><title>SkillIssue</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#070a12;color:#f2f5ff;font:600 20px system-ui">
<div style="text-align:center"><div style="font-size:44px;letter-spacing:2px"><span style="color:#3b8cff">SKILL</span> <span style="color:#ff4a4a">ISSUE</span></div><p>%s</p></div></body>""" % text.xml_escape()
	var bytes := html.to_utf8_buffer()
	var head := "HTTP/1.1 %d OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % [status, bytes.size()]
	_peer.put_data(head.to_utf8_buffer() + bytes)
	_peer.disconnect_from_host()
	_peer = null


func _finish_sign_in(code: String, verifier: String) -> void:
	sign_in_progress.emit("exchanging")
	var auth: Dictionary = config.auth
	var r: Dictionary = await _request(HTTPClient.METHOD_POST, _auth_base() + "oauth/token", {
		"grant_type": "authorization_code", "client_id": auth.nativeClientId,
		"code": code, "code_verifier": verifier, "redirect_uri": _redirect_uri(),
	})
	if not r.ok:
		config_error = "Sign-in failed: %s" % r.error
		sign_in_progress.emit("")
		changed.emit()
		return
	_take_tokens(r.body)
	var info: Dictionary = await _request(HTTPClient.METHOD_GET, _auth_base() + "userinfo", null, _access)
	var u: Dictionary = info.body if info.ok and typeof(info.body) == TYPE_DICTIONARY else {}
	var sub := str(u.get("sub", ""))
	profile = {
		"sub": sub,
		"name": str(u.get("nickname", u.get("given_name", u.get("name", "Player")))).left(16),
		"picture": str(u.get("picture", "")),
		"provider": sub.get_slice("|", 0),
	}
	config_error = ""
	_save()
	_load_avatar()
	# Creates the account on the server (and refreshes name / picture).
	_request(HTTPClient.METHOD_GET, api_url + "/api/me", null, _access)
	sign_in_progress.emit("")
	changed.emit()


func _take_tokens(body: Variant) -> void:
	if typeof(body) != TYPE_DICTIONARY:
		return
	_access = str(body.get("access_token", ""))
	if body.has("refresh_token"):
		_refresh = str(body.refresh_token)
	_expires_at = Time.get_unix_time_from_system() + float(body.get("expires_in", 3600))
	_save()


# ---------------------------------------------------------------- storage

func _save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("session", "access", _access)
	cfg.set_value("session", "refresh", _refresh)
	cfg.set_value("session", "expires_at", _expires_at)
	cfg.set_value("session", "profile", profile)
	cfg.save_encrypted_pass(SAVE_PATH, _key())


func _load() -> void:
	var cfg := ConfigFile.new()
	if cfg.load_encrypted_pass(SAVE_PATH, _key()) != OK:
		return
	_access = cfg.get_value("session", "access", "")
	_refresh = cfg.get_value("session", "refresh", "")
	_expires_at = cfg.get_value("session", "expires_at", 0.0)
	profile = cfg.get_value("session", "profile", {})
	if _refresh.is_empty() and _expires_at < Time.get_unix_time_from_system():
		sign_out()


func _key() -> String:
	return "skillissue:" + OS.get_unique_id()


# ---------------------------------------------------------------- helpers

func _load_avatar() -> void:
	var url := str(profile.get("picture", ""))
	if url.is_empty():
		return
	var http := HTTPRequest.new()
	add_child(http)
	if http.request(url) != OK:
		http.queue_free()
		return
	var res: Array = await http.request_completed
	http.queue_free()
	var bytes: PackedByteArray = res[3]
	if res[0] != HTTPRequest.RESULT_SUCCESS or bytes.is_empty():
		return
	var image := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	if bytes.size() > 12 and bytes[0] == 0x89 and bytes[1] == 0x50:
		err = image.load_png_from_buffer(bytes)
	elif bytes.size() > 12 and bytes[0] == 0xFF and bytes[1] == 0xD8:
		err = image.load_jpg_from_buffer(bytes)
	elif bytes.size() > 12 and bytes.slice(8, 12).get_string_from_ascii() == "WEBP":
		err = image.load_webp_from_buffer(bytes)
	if err == OK:
		avatar = ImageTexture.create_from_image(image)
		changed.emit()


func _configured_api() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--api="):
			return arg.substr(6).trim_suffix("/")
	if ProjectSettings.has_setting(API_SETTING):
		return str(ProjectSettings.get_setting(API_SETTING)).trim_suffix("/")
	return DEFAULT_API


## Auth0's base URL, "https://<tenant>/".
func _auth_base() -> String:
	var auth: Dictionary = config.get("auth", {})
	var base := str(auth.get("issuer", ""))
	if base.is_empty():
		base = "https://%s/" % auth.get("domain", "")
	return base if base.ends_with("/") else base + "/"


func _redirect_uri() -> String:
	return "http://127.0.0.1:%d/callback" % callback_port


## One HTTP request. Returns {ok, code, body, error}. `body` (Dictionary) is sent as JSON.
func _request(method: int, url: String, body: Variant = null, token := "") -> Dictionary:
	var http := HTTPRequest.new()
	http.timeout = 15.0
	add_child(http)
	var headers := PackedStringArray(["Accept: application/json"])
	if not token.is_empty():
		headers.append("Authorization: Bearer " + token)
	var data := ""
	if body != null:
		headers.append("Content-Type: application/json")
		data = JSON.stringify(body)
	var err := http.request(url, headers, method, data)
	if err != OK:
		http.queue_free()
		return {"ok": false, "code": 0, "body": null, "error": "request failed (%d)" % err}
	var res: Array = await http.request_completed
	http.queue_free()
	var code: int = res[1]
	var parsed: Variant = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	var ok: bool = res[0] == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300
	var message := ""
	if not ok:
		if res[0] != HTTPRequest.RESULT_SUCCESS:
			message = "network error (%d)" % res[0]
		elif typeof(parsed) == TYPE_DICTIONARY:
			message = str(parsed.get("error_description", parsed.get("error", "HTTP %d" % code)))
		else:
			message = "HTTP %d" % code
	return {"ok": ok, "code": code, "body": parsed, "error": message}


static func _b64url(bytes: PackedByteArray) -> String:
	return Marshalls.raw_to_base64(bytes).replace("+", "-").replace("/", "_").replace("=", "")


static func _sha256(bytes: PackedByteArray) -> PackedByteArray:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish()


static func _query(params: Dictionary) -> String:
	var parts := PackedStringArray()
	for k in params:
		parts.append("%s=%s" % [str(k).uri_encode(), str(params[k]).uri_encode()])
	return "&".join(parts)


static func _parse_query(q: String) -> Dictionary:
	var out := {}
	for pair in q.split("&", false):
		out[pair.get_slice("=", 0).uri_decode()] = pair.get_slice("=", 1).replace("+", " ").uri_decode()
	return out
