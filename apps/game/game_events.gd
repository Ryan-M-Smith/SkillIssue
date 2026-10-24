extends Node
## Global signal bus (autoload: GameEvents). Gameplay emits, UI and modes listen.

signal health_changed(team: int, hp: float, max_hp: float)
signal score_changed(team: int, score: int)
signal duo_killed(victim_team: int, killer_team: int)
signal match_ended(winning_team: int)
