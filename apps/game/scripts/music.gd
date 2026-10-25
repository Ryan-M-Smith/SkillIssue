## Autoload `Music`: background music that keeps playing across scene changes and
## crossfades between tracks.
##   Music.play("menu")    fades from whatever is playing to the menu track
##   Music.play("match")   the same track twice is a no-op, so every screen can just ask
##   Music.stop()          fades out
##
## Two AudioStreamPlayers take turns: the idle one starts the new track at silence and a
## Tween fades it up while the other fades down. Tracks live in res://audio/music/ (see the
## README there). A missing file is skipped quietly, so the game runs before any music is
## added. Plays on the "Music" bus (default_bus_layout.tres), so its volume is separate
## from sound effects.
extends Node

const BUS := &"Music"
const SETTINGS_PATH := "user://game.cfg"

## Track name -> file. Add a track: drop the file in audio/music/ and add a line here.
const TRACKS := {
	"menu": "res://audio/ambient/Week 27 - Dusty Memories.ogg",
	"match": "res://audio/ambient/Week 30 - Crushing It SMOOV.ogg",
	"results": "res://audio/ambient/Week 37 - Schmoovin.ogg",
}
## Used when a track's file isn't there yet (no results track: keep the menu music).
const FALLBACK := {"results": "menu"}

@export var fade_seconds := 1.5

## 0..1, saved in user://game.cfg. The bus volume, so a fade in progress isn't affected.
var volume := 0.8
var current := ""
## The TRACKS table in use (a copy, so tests or a mod can point a track at another file).
var tracks: Dictionary = TRACKS.duplicate()

var _players: Array[AudioStreamPlayer] = []
var _active := 0
var _tween: Tween


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # keep playing while the tree is paused
	for i in 2:
		var p := AudioStreamPlayer.new()
		p.name = "Player%s" % ["A", "B"][i]
		p.bus = BUS if AudioServer.get_bus_index(BUS) != -1 else &"Master"
		p.volume_db = linear_to_db(0.0)
		add_child(p)
		_players.append(p)
	var config := ConfigFile.new()
	if config.load(SETTINGS_PATH) == OK:
		volume = clampf(float(config.get_value("audio", "music_volume", volume)), 0.0, 1.0)
	_apply_volume()


## Crossfades to a track by name (see TRACKS). Returns false if it has no file to play.
func play(track: String, fade := -1.0) -> bool:
	var path := _resolve(track)
	if path.is_empty():
		return false
	if path == _path_of(current) and _players[_active].playing:
		current = track
		return true
	var stream := load(path) as AudioStream
	if stream == null:
		return false
	_loop(stream)
	current = track
	_crossfade(stream, fade_seconds if fade < 0.0 else fade)
	return true


## Fades the music out.
func stop(fade := -1.0) -> void:
	current = ""
	_crossfade(null, fade_seconds if fade < 0.0 else fade)


func is_playing() -> bool:
	return _players[_active].playing


## Sets the music volume (0..1) and saves it.
func set_volume(value: float) -> Error:
	volume = clampf(value, 0.0, 1.0)
	_apply_volume()
	var config := ConfigFile.new()
	config.load(SETTINGS_PATH)
	config.set_value("audio", "music_volume", volume)
	return config.save(SETTINGS_PATH)


## Let go of the streams on quit, so Godot doesn't report them as leaked.
func _exit_tree() -> void:
	if _tween:
		_tween.kill()
	for p in _players:
		p.stop()
		p.stream = null


func _resolve(track: String) -> String:
	var seen := {}
	while not track.is_empty() and not seen.has(track):
		seen[track] = true
		var path := _path_of(track)
		if not path.is_empty() and ResourceLoader.exists(path):
			return path
		track = FALLBACK.get(track, "")
	return ""


func _path_of(track: String) -> String:
	return tracks.get(track, "")


func _crossfade(stream: AudioStream, seconds: float) -> void:
	if _tween:
		_tween.kill()
	var old := _players[_active]
	var new: AudioStreamPlayer = null
	if stream:
		_active = 1 - _active
		new = _players[_active]
		new.stop()
		new.stream = stream
		new.volume_db = linear_to_db(0.0)
		new.play()
	if seconds <= 0.0:
		_finish_fade(old, new)
		return
	_tween = create_tween().set_parallel()
	_tween.tween_method(_set_linear.bind(old), db_to_linear(old.volume_db), 0.0, seconds)
	if new:
		_tween.tween_method(_set_linear.bind(new), 0.0, 1.0, seconds)
	_tween.chain().tween_callback(_finish_fade.bind(old, new))


func _finish_fade(old: AudioStreamPlayer, new: AudioStreamPlayer) -> void:
	if old != new:
		old.stop()
		old.volume_db = linear_to_db(0.0)
	if new:
		new.volume_db = 0.0


func _set_linear(value: float, player: AudioStreamPlayer) -> void:
	player.volume_db = linear_to_db(maxf(value, 0.0001))


func _apply_volume() -> void:
	var bus := AudioServer.get_bus_index(BUS)
	if bus != -1:
		AudioServer.set_bus_volume_db(bus, linear_to_db(maxf(volume, 0.0001)))
		AudioServer.set_bus_mute(bus, volume <= 0.0)


## Music should repeat however the file was imported.
static func _loop(stream: AudioStream) -> void:
	if stream is AudioStreamOggVorbis or stream is AudioStreamMP3:
		stream.set("loop", true)
	elif stream is AudioStreamWAV:
		var wav := stream as AudioStreamWAV
		if wav.loop_mode == AudioStreamWAV.LOOP_DISABLED:
			wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
			wav.loop_end = int(wav.get_length() * wav.mix_rate)
