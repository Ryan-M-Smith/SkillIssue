extends Control
## One team's HUD. Display only: shows what GameEvents reports and owns no game rules.

@export var team := 0
@export var team_color := Color.GREEN

@onready var health_bar: ProgressBar = %HealthBar
@onready var kill_label: Label = %KillCounter
@onready var crosshair: Control = %Crosshair


func _ready() -> void:
	crosshair.color = team_color
	var fill := health_bar.get_theme_stylebox("fill").duplicate() as StyleBoxFlat
	if fill:
		fill.bg_color = team_color
		health_bar.add_theme_stylebox_override("fill", fill)
	GameEvents.health_changed.connect(_on_health_changed)
	GameEvents.score_changed.connect(_on_score_changed)


func _on_health_changed(t: int, hp: float, max_hp: float) -> void:
	if t != team:
		return
	health_bar.max_value = max_hp
	health_bar.value = hp


func _on_score_changed(t: int, score: int) -> void:
	if t == team:
		kill_label.text = "Kills: %d" % score
