## Autoload `LobbyOverlay`: tells players how to join until the match starts.
## Shows the join code the phones type in, the server address to use when the
## server runs on this computer, and how many phones have joined.
## Hidden while the match is playing.
extends CanvasLayer

@export var font_size := 22

var _panel: PanelContainer
var _label: Label


func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS

	_panel = PanelContainer.new()
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.04, 0.06, 0.13, 0.88)
	box.border_color = Color(0.34, 0.67, 1.0)
	box.set_border_width_all(2)
	box.set_corner_radius_all(10)
	box.set_content_margin_all(16)
	_panel.add_theme_stylebox_override("panel", box)
	add_child(_panel)

	_label = Label.new()
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.add_theme_font_size_override("font_size", font_size)
	_panel.add_child(_label)

	NetworkClient.connection_changed.connect(_refresh.unbind(1))
	GameSession.registered.connect(_refresh.unbind(2))
	GameSession.state_changed.connect(_refresh.unbind(1))
	GameSession.controller_assigned.connect(_refresh.unbind(3))
	GameSession.controller_removed.connect(_refresh.unbind(3))
	_refresh()


func _refresh() -> void:
	if GameSession.is_playing():
		_panel.visible = false
		return
	_panel.visible = true
	if not NetworkClient.is_connected_to_server():
		_label.text = "Connecting to the SkillIssue server at %s…\nStart it with: npm run server:start" % NetworkClient.url
	elif GameSession.pairing_code.is_empty():
		_label.text = "Registering with the server…"
	else:
		var lines := PackedStringArray()
		lines.append("JOIN CODE   %s" % GameSession.pairing_code)
		var server := _phone_server_address()
		if not server.is_empty():
			lines.append("Server: %s" % server)
		var phones := GameSession.controller_count()
		lines.append("%d phone%s joined · %s" % [phones, "" if phones == 1 else "s", _state_text()])
		_label.text = "\n".join(lines)
	_panel.reset_size()
	_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP, Control.PRESET_MODE_MINSIZE, 16)


func _state_text() -> String:
	match GameSession.state:
		"ready":
			return "starting…"
		"waiting":
			return "waiting for players"
		_:
			return GameSession.state


## The address phones should type when the server runs on this computer.
func _phone_server_address() -> String:
	var url: String = NetworkClient.url
	if not (url.contains("127.0.0.1") or url.contains("localhost")):
		return url
	var port := url.get_slice(":", 2)
	for address in IP.get_local_addresses():
		if address.count(".") == 3 and not address.begins_with("127.") and not address.begins_with("169.254."):
			return "ws://%s:%s" % [address, port]
	return ""
