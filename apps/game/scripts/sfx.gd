## Autoload `Sfx`: short sound effects (button clicks, alerts) that can overlap.
##   Sfx.play("click")
## Each call makes a small AudioStreamPlayer that deletes itself when it finishes.
## Plays on the "SFX" bus (default_bus_layout.tres), separate from music.
extends Node

const SOUNDS := {
	"click": preload("res://audio/GUI_Sound_Effects_by_Lokif/click.wav"),
	"hover": preload("res://audio/GUI_Sound_Effects_by_Lokif/misc_menu.wav"),
	"positive": preload("res://audio/GUI_Sound_Effects_by_Lokif/positive.wav"),
	"negative": preload("res://audio/GUI_Sound_Effects_by_Lokif/negative.wav"),
}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # menus still click while the game is paused


func play(sound: String) -> void:
	var stream: AudioStream = SOUNDS.get(sound)
	# Headless runs (tests, servers) have no speakers; a playback left at quit is an error.
	if stream == null or DisplayServer.get_name() == "headless":
		return
	var p := AudioStreamPlayer.new()
	p.stream = stream
	p.bus = &"SFX"
	add_child(p)
	p.play()
	p.finished.connect(p.queue_free)
