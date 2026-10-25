## Autoload `ServerProcess`: starts the SkillIssue WebSocket server (apps/server) when
## a lobby is created, unless one is already listening on the port (for example one you
## started yourself with `npm run server:start`).
##
## The server runs on Node.js: `node --import <tsx loader> apps/server/index.ts`, one
## process. It gets this game's process id and shuts itself down when the game exits,
## so a crash never leaves it holding the port. Its output shows up in Godot's output
## panel prefixed with [server].
##
## Needs Node.js 20+ and the repo's npm packages installed once (`npm install`).
extends Node

## "idle" | "checking" | "starting" | "running" (ours) | "external" (already running) | "failed"
signal status_changed(state: String, message: String)

@export var port := 8080
## Phones a match needs before it can start. 4 = a full match; lower it to test alone.
## Also settable with the command-line argument `-- --min-players=1`.
@export var min_players := 4
## Folder with the server's index.ts. Empty = <this project>/../server.
@export var server_dir := ""
## Path to the node executable. Empty = look in the usual places and on PATH.
@export var node_path := ""
@export var start_timeout := 20.0

var state := "idle"
var message := ""

var _pid := -1
var _pipes: Array[FileAccess] = []
var _threads: Array[Thread] = []
var _log_tail := PackedStringArray()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--min-players="):
			min_players = clampi(arg.get_slice("=", 1).to_int(), 1, 4)


func server_url() -> String:
	return "ws://127.0.0.1:%d" % port


func is_up() -> bool:
	return state == "running" or state == "external"


## Makes sure a server is listening. Await it; check `is_up()` afterwards.
func ensure_running() -> void:
	if is_up() and (state == "external" or OS.is_process_running(_pid)):
		return
	if state == "starting" or state == "checking":
		await status_changed
		return

	_set_status("checking", "Looking for the server…")
	if await _port_open():
		_set_status("external", "Using the server already running on port %d." % port)
		return

	var node := _find_node()
	if node.is_empty():
		_set_status("failed", "Node.js isn't installed (or isn't on PATH). Install Node.js 20 or newer, then try again.")
		return
	var dir := _server_dir()
	var index := dir.path_join("index.ts")
	if not FileAccess.file_exists(index):
		_set_status("failed", "Can't find the server at %s. Set ServerProcess.server_dir." % index)
		return
	var loader := _find_tsx_loader(dir)
	if loader.is_empty():
		_set_status("failed", "The server's packages aren't installed. Run `npm install` in the repo folder once.")
		return

	OS.set_environment("PORT", str(port))
	OS.set_environment("MIN_CONTROLLERS", str(min_players))
	OS.set_environment("SKILLISSUE_PARENT_PID", str(OS.get_process_id()))
	var info := OS.execute_with_pipe(node, PackedStringArray(["--import", _file_url(loader), index]))
	if info.is_empty():
		_set_status("failed", "Couldn't start Node.js (%s)." % node)
		return
	_pid = info.pid
	_log_tail.clear()
	_read_pipe(info.stdio)
	_read_pipe(info.stderr)

	_set_status("starting", "Starting the server…")
	var waited := 0.0
	while waited < start_timeout:
		await get_tree().create_timer(0.25).timeout
		waited += 0.25
		if not OS.is_process_running(_pid):
			_set_status("failed", "The server stopped while starting:\n%s" % "\n".join(_log_tail.slice(-4)))
			return
		if await _port_open():
			_set_status("running", "Server running on port %d." % port)
			return
	_set_status("failed", "The server didn't open port %d in time." % port)


## Stops the server if this game started it.
func stop() -> void:
	if _pid > 0 and OS.is_process_running(_pid):
		OS.kill(_pid)
	_pid = -1
	if state == "running":
		_set_status("idle", "")


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE or what == NOTIFICATION_WM_CLOSE_REQUEST:
		stop()


func _exit_tree() -> void:
	stop()
	for pipe in _pipes:
		pipe.close()
	for t in _threads:
		if t.is_started():
			t.wait_to_finish()


func _set_status(new_state: String, new_message: String) -> void:
	state = new_state
	message = new_message
	if new_state == "failed":
		push_warning("ServerProcess: " + new_message)
	status_changed.emit(state, message)


func _port_open() -> bool:
	var tcp := StreamPeerTCP.new()
	if tcp.connect_to_host("127.0.0.1", port) != OK:
		return false
	for i in 20:
		tcp.poll()
		match tcp.get_status():
			StreamPeerTCP.STATUS_CONNECTED:
				tcp.disconnect_from_host()
				return true
			StreamPeerTCP.STATUS_ERROR, StreamPeerTCP.STATUS_NONE:
				return false
		await get_tree().create_timer(0.025).timeout
	tcp.disconnect_from_host()
	return false


func _server_dir() -> String:
	if not server_dir.is_empty():
		return server_dir
	var from_env := OS.get_environment("SKILLISSUE_SERVER_DIR")
	if not from_env.is_empty():
		return from_env
	return ProjectSettings.globalize_path("res://").path_join("../server").simplify_path()


## tsx's ESM loader, from the server's own node_modules or the workspace root's.
func _find_tsx_loader(dir: String) -> String:
	for base in [dir, dir.path_join("../.."), dir.path_join("..")]:
		var candidate: String = base.path_join("node_modules/tsx/dist/loader.mjs").simplify_path()
		if FileAccess.file_exists(candidate):
			return candidate
	return ""


func _find_node() -> String:
	if not node_path.is_empty():
		return node_path
	var windows := OS.get_name() == "Windows"
	# Apps opened from the desktop often don't get the shell's PATH, so look in the usual places first.
	var candidates: Array[String] = []
	if windows:
		candidates = ["C:/Program Files/nodejs/node.exe", "C:/Program Files (x86)/nodejs/node.exe"]
	else:
		candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
	for c in candidates:
		if FileAccess.file_exists(c):
			return c
	var output := []
	var exe := "node.exe" if windows else "node"
	if OS.execute(exe, PackedStringArray(["--version"]), output) == 0:
		return exe
	return ""


func _file_url(path: String) -> String:
	path = path.replace("\\", "/")
	return ("file:///" + path) if not path.begins_with("/") else ("file://" + path)


# Server output goes to Godot's output, a line at a time, from a background thread.
func _read_pipe(pipe: FileAccess) -> void:
	if pipe == null:
		return
	_pipes.append(pipe)
	var thread := Thread.new()
	_threads.append(thread)
	thread.start(func() -> void:
		while pipe.is_open() and pipe.get_error() == OK:
			var line := pipe.get_line()
			if line.is_empty() and pipe.get_error() != OK:
				break
			if not line.is_empty():
				_on_server_line.call_deferred(line)
	)


func _on_server_line(line: String) -> void:
	print("[server] ", line)
	_log_tail.append(line)
	if _log_tail.size() > 20:
		_log_tail = _log_tail.slice(-20)
