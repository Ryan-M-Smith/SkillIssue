## Picks the match MVP from the finished match (MatchStats). Any of the four players can win:
## the Gunner for kills, KDR or damage; the Runner for distance or for being so hard to hit
## that the other team scored little or shot poorly.
## `decide()` asks the control plane (POST /api/mvp), which has Gemini judge the whole match;
## if that is unavailable or slow, a local rule picks instead. In a draw the bar is higher:
## nobody gets MVP unless someone clearly stood out.
##   var pick := await MvpJudge.decide(self)
##   # {"id": "red-runner", "team": 1, "role": "runner", "name": "Sam",
##   #  "headline": "...", "reason": "...", "source": "gemini" | "local"}  or {"id": "", ...}
class_name MvpJudge
extends RefCounted

const TIMEOUT_SECONDS := 12.0
const ROLES := {"gunner": "gunner", "mover": "runner"}


## Everything the judge sees: result, and each player's share of the team's numbers.
static func payload() -> Dictionary:
	var r: Dictionary = MatchStats.result
	var winner: int = r.get("winner", -1)
	var scores: Array = r.get("scores", [0, 0])
	var names: Dictionary = r.get("names", {})
	var players := []
	for team in 2:
		var t: Dictionary = MatchStats.teams[team]
		var other: Dictionary = MatchStats.teams[1 - team]
		for game_role in ["gunner", "mover"]:
			var role: String = ROLES[game_role]
			var stats := {"deaths": t.deaths}
			if role == "gunner":
				stats.merge({
					"kills": t.kills,
					"kdr": snappedf(MatchStats.kdr(team), 0.01),
					"accuracyPercent": roundi(MatchStats.accuracy(team) * 100.0),
					"damageDealt": roundi(t.damage),
					"headshots": t.headshots,
					"shotsFired": t.shots,
					"bestStreak": t.get("best_streak", 0),
				})
			else:
				stats.merge({
					"distanceMeters": roundi(t.distance),
					"sprintSeconds": roundi(t.sprint_time),
					"jumps": t.jumps,
					"crouches": t.crouches,
					"enemyKills": other.kills,
					"enemyAccuracyPercent": roundi(MatchStats.accuracy(1 - team) * 100.0),
					"enemyDamageDealt": roundi(other.damage),
				})
			players.append({
				"id": "%s-%s" % [_team_key(team), role],
				"team": _team_key(team),
				"role": role,
				"name": names.get("%d:%s" % [team, game_role], "%s %s" % [UiKit.team_name(team).capitalize(), role.capitalize()]),
				"stats": stats,
			})
	return {
		"winner": "draw" if winner < 0 else _team_key(winner),
		"scores": {"blue": scores[0], "red": scores[1]},
		"endReason": r.get("reason", ""),
		"durationSeconds": roundi(r.get("seconds", 0.0)),
		"players": players,
	}


## Ask Gemini through the control plane; fall back to the local rule. Never errors.
static func decide(host: Node) -> Dictionary:
	var data := payload()
	var control_plane := NetworkClient.configured_control_plane_url()
	if control_plane.is_empty() or not host.is_inside_tree():
		return local_pick(data)
	var request := HTTPRequest.new()
	request.timeout = TIMEOUT_SECONDS
	host.add_child(request)
	var endpoint := control_plane.trim_suffix("/") + "/api/mvp"
	if request.request(endpoint, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(data)) != OK:
		request.queue_free()
		return local_pick(data)
	var response: Array = await request.request_completed
	request.queue_free()
	if response.size() < 4 or int(response[0]) != HTTPRequest.RESULT_SUCCESS or int(response[1]) != 200:
		return local_pick(data)
	var reply: Variant = JSON.parse_string((response[3] as PackedByteArray).get_string_from_utf8())
	if typeof(reply) != TYPE_DICTIONARY:
		return local_pick(data)
	return _finish(data, str(reply.get("mvp", "")), str(reply.get("headline", "")), str(reply.get("reason", "")), "gemini")


## The offline rule: score each player for their role and pick the best.
static func local_pick(data: Dictionary) -> Dictionary:
	var best := ""
	var best_score := -INF
	var second := -INF
	for p in data.players:
		var s: Dictionary = p.stats
		var score := 0.0
		if p.role == "gunner":
			score = s.kills * 3.0 + s.kdr * 4.0 + s.damageDealt / 50.0 + s.accuracyPercent / 10.0 + s.headshots
		else:
			score = s.distanceMeters / 40.0 + (100 - s.enemyAccuracyPercent) / 10.0 + maxf(0.0, 8.0 - s.enemyKills) * 1.5 - s.deaths
		if p.team == data.winner:
			score += 3.0
		if score > best_score:
			second = best_score
			best_score = score
			best = p.id
		elif score > second:
			second = score
	# A draw needs a clear standout.
	if data.winner == "draw" and best_score < second * 1.25 + 2.0:
		return _finish(data, "", "No MVP", "Nobody separated themselves in a dead-even match.", "local")
	var pick := _player(data, best)
	var headline := "Top gun" if pick.get("role") == "gunner" else "Untouchable"
	var reason := ""
	if pick.get("role") == "gunner":
		reason = "%d kills, a %.2f KDR and %d damage dealt." % [pick.stats.kills, pick.stats.kdr, pick.stats.damageDealt]
	else:
		reason = "Covered %d m while the other team landed %d%% of their shots." % [pick.stats.distanceMeters, pick.stats.enemyAccuracyPercent]
	return _finish(data, best, headline, reason, "local")


static func _finish(data: Dictionary, id: String, headline: String, reason: String, source: String) -> Dictionary:
	var pick := _player(data, id)
	if pick.is_empty():
		return {"id": "", "team": -1, "role": "", "name": "", "headline": headline if not headline.is_empty() else "No MVP",
			"reason": reason, "source": source}
	return {
		"id": id, "team": 0 if pick.team == "blue" else 1, "role": pick.role, "name": pick.name,
		"headline": headline.left(40), "reason": reason.left(220), "source": source,
	}


static func _player(data: Dictionary, id: String) -> Dictionary:
	for p in data.players:
		if p.id == id:
			return p
	return {}


static func _team_key(team: int) -> String:
	return "blue" if team == 0 else "red"
