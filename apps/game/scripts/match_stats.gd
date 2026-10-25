## Autoload `MatchStats`: per-team numbers for the results screen, collected while a
## match runs. Also holds the last match's result so the results scene can show it.
##   begin(duos)  at kick-off;  finish(winner, scores)  at the final whistle.
extends Node

const TEAM_COUNT := 2

## Per game team (0 blue, 1 red).
var teams: Array[Dictionary] = []
## Last finished match: {"winner": int (-1 draw), "scores": [int, int], "reason": String,
## "seconds": float, "names": {"0:gunner": "Ryan", ...}}
var result := {}

var _duos: Array = []
var _last_pos: Array[Vector3] = []
var _was_crouching: Array[bool] = []
var _running := false
var _started_msec := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	GameEvents.duo_killed.connect(_on_duo_killed)
	reset()


func reset() -> void:
	teams.clear()
	for i in TEAM_COUNT:
		teams.append({
			"kills": 0, "deaths": 0, "shots": 0, "hits": 0, "headshots": 0, "damage": 0.0,
			"distance": 0.0, "jumps": 0, "crouches": 0, "sprint_time": 0.0,
			"streak": 0, "best_streak": 0,
		})


func begin(duos: Array) -> void:
	reset()
	result = {}
	_duos = duos
	_last_pos.clear()
	_was_crouching.clear()
	for duo in duos:
		_last_pos.append(duo.global_position)
		_was_crouching.append(false)
		var team: int = duo.team_id
		duo.weapons.fired.connect(func(data: WeaponData): _add(team, "shots", maxi(data.pellets, 1)))
		duo.weapons.hit_confirmed.connect(func(_target, damage: float, headshot: bool):
			_add(team, "hits", 1)
			if _running:
				teams[team].damage += damage
			if headshot:
				_add(team, "headshots", 1))
	_started_msec = Time.get_ticks_msec()
	_running = true


func finish(winner: int, scores: Array, reason: String) -> void:
	_running = false
	var names := {}
	for team in TEAM_COUNT:
		for role in ["gunner", "mover"]:
			var player: Dictionary = GameSession.player_at(team, role)
			if not player.is_empty():
				names["%d:%s" % [team, role]] = str(player.name)
	result = {
		"winner": winner, "scores": [scores[0], scores[1]], "reason": reason,
		"seconds": (Time.get_ticks_msec() - _started_msec) / 1000.0, "names": names,
	}


## A lost lobby is an abandoned match, so discard its partial results and references.
func abort() -> void:
	_running = false
	_duos = []
	_last_pos.clear()
	_was_crouching.clear()
	result = {}
	reset()


## TeamStats for the protocol (teams numbered 1 and 2).
func to_protocol() -> Array:
	var out := []
	for i in teams.size():
		var t: Dictionary = teams[i]
		out.append({
			"teamId": i + 1, "kills": t.kills, "deaths": t.deaths, "shots": t.shots,
			"hits": t.hits, "headshots": t.headshots, "distance": roundi(t.distance),
			"jumps": t.jumps, "crouches": t.crouches, "sprintTime": roundi(t.sprint_time),
			"bestStreak": t.best_streak,
		})
	return out


## Kills per death; with no deaths, the kill count itself.
func kdr(team: int) -> float:
	var t: Dictionary = teams[team]
	return float(t.kills) / t.deaths if t.deaths > 0 else float(t.kills)


func accuracy(team: int) -> float:
	var t: Dictionary = teams[team]
	# A shotgun can hit with multiple pellets from one shell.
	return minf(float(t.hits) / t.shots, 1.0) if t.shots > 0 else 0.0


func _physics_process(delta: float) -> void:
	if not _running:
		return
	for i in _duos.size():
		var duo = _duos[i]
		if not is_instance_valid(duo) or not duo.is_inside_tree():
			continue
		var team: int = duo.team_id
		var pos: Vector3 = duo.global_position
		if duo.alive:
			var step := Vector2(pos.x - _last_pos[i].x, pos.z - _last_pos[i].z).length()
			if step < 2.0:   # ignore respawn teleports
				teams[team].distance += step
			if duo.input.jump and duo.is_on_floor():
				_add(team, "jumps", 1)
			var crouching: bool = duo.movement.crouching
			if crouching and not _was_crouching[i]:
				_add(team, "crouches", 1)
			_was_crouching[i] = crouching
			if duo.input.sprint and not crouching and duo.input.move.y > 0.1:
				teams[team].sprint_time += delta
		_last_pos[i] = pos


func _on_duo_killed(victim_team: int, killer_team: int) -> void:
	if not _running:
		return
	if victim_team >= 0 and victim_team < TEAM_COUNT:
		_add(victim_team, "deaths", 1)
		teams[victim_team].streak = 0
	if killer_team >= 0 and killer_team < TEAM_COUNT and killer_team != victim_team:
		_add(killer_team, "kills", 1)
		teams[killer_team].streak += 1
		teams[killer_team].best_streak = maxi(teams[killer_team].best_streak, teams[killer_team].streak)


func _add(team: int, key: String, amount: int) -> void:
	if _running and team >= 0 and team < TEAM_COUNT:
		teams[team][key] += amount
