extends Node
## Saved display preferences. The HUD canvas and the 3D output have separate sizes.

signal changed()

const RESOLUTIONS: Array[Vector2i] = [Vector2i(1280, 720), Vector2i(1600, 900), Vector2i(1920, 1080), Vector2i(2160, 1440), Vector2i(2560, 1440), Vector2i(3840, 2160)]
const SCALES: Array[float] = [0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0]
const DEFAULT_RESOLUTION := Vector2i(1920, 1080)

var resolution := DEFAULT_RESOLUTION
var render_scale := 1.0
var window_mode := 0 # Windowed, fullscreen, borderless window.
var vsync := true
var config_path := "user://graphics.cfg"


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().root.size_changed.connect(_refresh_screens.call_deferred)
	get_tree().node_added.connect(_on_node_added)
	load_settings()


func load_settings(path := "") -> Error:
	if not path.is_empty():
		config_path = path
	var config := ConfigFile.new()
	var error := config.load(config_path)
	var size_value: Variant = config.get_value("graphics", "resolution", DEFAULT_RESOLUTION)
	var scale_value: Variant = config.get_value("graphics", "render_scale", 1.0)
	var mode_value: Variant = config.get_value("graphics", "window_mode", 0)
	var vsync_value: Variant = config.get_value("graphics", "vsync", true)
	resolution = size_value if typeof(size_value) == TYPE_VECTOR2I and size_value in RESOLUTIONS else DEFAULT_RESOLUTION
	render_scale = float(scale_value) if typeof(scale_value) in [TYPE_INT, TYPE_FLOAT] and scale_value in SCALES else 1.0
	window_mode = int(mode_value) if typeof(mode_value) == TYPE_INT and mode_value in [0, 1, 2] else 0
	vsync = vsync_value if typeof(vsync_value) == TYPE_BOOL else true
	_apply()
	return OK if error == ERR_FILE_NOT_FOUND else error


func apply_settings(size_value: Vector2i, scale_value: float, mode_value: int, vsync_value: bool, save := true) -> Error:
	if size_value not in RESOLUTIONS or scale_value not in SCALES or mode_value not in [0, 1, 2]:
		return ERR_INVALID_PARAMETER
	resolution = size_value
	render_scale = scale_value
	window_mode = mode_value
	vsync = vsync_value
	_apply()
	if not save:
		return OK
	var config := ConfigFile.new()
	config.set_value("graphics", "resolution", resolution)
	config.set_value("graphics", "render_scale", render_scale)
	config.set_value("graphics", "window_mode", window_mode)
	config.set_value("graphics", "vsync", vsync)
	return config.save(config_path)


func _apply() -> void:
	if DisplayServer.get_name() != "headless":
		var window := get_tree().root
		window.mode = Window.MODE_WINDOWED
		window.borderless = window_mode == 2
		window.size = resolution
		if window_mode == 1:
			window.mode = Window.MODE_FULLSCREEN
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if vsync else DisplayServer.VSYNC_DISABLED)
	_refresh_screens.call_deferred()
	changed.emit()


func register_screens(screens: Control) -> void:
	screens.add_to_group("graphics_output_screens")
	screens.set_anchors_preset(Control.PRESET_TOP_LEFT)
	for child in screens.get_children():
		if child is SubViewportContainer:
			child.stretch_shrink = 1
	_refresh_screens.call_deferred()


func _refresh_screens() -> void:
	var window := get_tree().root
	var stretch := window.get_stretch_transform().get_scale()
	for screens: Control in get_tree().get_nodes_in_group("graphics_output_screens"):
		# Screen textures render at actual output pixels. Only the HUD uses the
		# logical canvas scale, so changing 3D quality never softens its text.
		screens.position = Vector2.ZERO
		screens.scale = Vector2(1.0 / maxf(stretch.x, 0.01), 1.0 / maxf(stretch.y, 0.01))
		screens.size = Vector2(window.size)
	for viewport: SubViewport in get_tree().get_nodes_in_group("graphics_3d_viewports"):
		viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
		viewport.scaling_3d_scale = render_scale


func _on_node_added(node: Node) -> void:
	if node is SubViewport:
		node.add_to_group("graphics_3d_viewports")
		_refresh_screens.call_deferred()
