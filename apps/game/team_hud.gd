extends Control
## One team's HUD. Display only: shows what GameEvents reports and owns no game rules.

## Same TeamData resource the Duo uses (data/teams/), so team id and color are set in one place.
@export var team_data: TeamData

var team: int:
	get: return team_data.id if team_data else 0

@onready var health_bar: ProgressBar = %HealthBar
@onready var kill_label: Label = %KillCounter
@onready var crosshair: Control = %Crosshair


func _ready() -> void:
	var color := team_data.color if team_data else Color.WHITE
	crosshair.color = color
	var fill := health_bar.get_theme_stylebox("fill").duplicate() as StyleBoxFlat
	if fill:
		fill.bg_color = color
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
