## Timed buffs and debuffs on one Duo: from mystery boxes, and from enemy hits (Scrambler).
## Other components ask it questions instead of knowing about power-ups themselves:
##   weapons  -> damage_multiplier(), take_one_shot(), on_hit_dealt(target)
##   movement -> speed_multiplier()
##   duo      -> modify_input(input) flips the controls while INVERTED
## Everything clears when the Duo dies. Tune durations in INFO, strengths in the exports.
class_name PowerupComponent
extends Node

signal effect_started(effect: Effect, seconds: float)
signal effect_ended(effect: Effect)

enum Effect {
	ONE_SHOT,       ## buff: the next bullet you fire kills whatever it hits
	EXTRA_DAMAGE,   ## buff: every bullet does more damage
	SCRAMBLER,      ## buff: hitting the enemy inverts THEIR controls for a few seconds
	SPEED,          ## buff: move faster
	INVERTED,       ## debuff: move and aim are flipped (both phones!)
	SLOWED,         ## debuff: move slower
}

## seconds: how long it lasts (INF = until used or until you die). weight: odds in a box.
const INFO := {
	Effect.ONE_SHOT: {"name": "ONE-SHOT ROUND", "blurb": "Your next bullet kills", "buff": true, "seconds": INF, "weight": 2.0},
	Effect.EXTRA_DAMAGE: {"name": "EXTRA DAMAGE", "blurb": "Bullets hit 50% harder", "buff": true, "seconds": 15.0, "weight": 3.0},
	Effect.SCRAMBLER: {"name": "SCRAMBLER", "blurb": "Hits invert the enemy's controls", "buff": true, "seconds": 15.0, "weight": 3.0},
	Effect.SPEED: {"name": "SPEED", "blurb": "Move faster", "buff": true, "seconds": 12.0, "weight": 2.0},
	Effect.INVERTED: {"name": "INVERTED", "blurb": "Your controls are flipped!", "buff": false, "seconds": 6.0, "weight": 2.0},
	Effect.SLOWED: {"name": "SLOWED", "blurb": "Your legs feel heavy", "buff": false, "seconds": 8.0, "weight": 1.0},
}

@export var damage_boost := 1.5
@export var speed_boost := 1.35
@export var slow_factor := 0.6
## How long a Scrambler hit inverts the enemy.
@export var scrambled_seconds := 4.0

## The Duo this belongs to (set by Duo; the node is created in code, so `owner` is empty).
var duo: Node
var _left := {}   ## Effect -> seconds left


## Starts (or refreshes) an effect. seconds < 0 uses its INFO duration.
func apply(effect: Effect, seconds := -1.0) -> void:
	var length: float = INFO[effect].seconds if seconds < 0.0 else seconds
	_left[effect] = length
	effect_started.emit(effect, length)


func has(effect: Effect) -> bool:
	return _left.has(effect)


func time_left(effect: Effect) -> float:
	return _left.get(effect, 0.0)


## [[effect, seconds left], ...] in a stable order, for the HUD.
func active() -> Array:
	var out := []
	for effect in Effect.values():
		if _left.has(effect):
			out.append([effect, _left[effect]])
	return out


func clear() -> void:
	for effect in _left.keys():
		_end(effect)


func _process(delta: float) -> void:
	for effect in _left.keys():
		_left[effect] -= delta
		if _left[effect] <= 0.0:
			_end(effect)


func _end(effect: Effect) -> void:
	if _left.erase(effect):
		effect_ended.emit(effect)


## Called by the Duo every physics frame after the controllers have written their input.
func modify_input(input: DuoInput) -> void:
	if has(Effect.INVERTED):
		input.move = -input.move
		input.aim_delta = -input.aim_delta


func damage_multiplier() -> float:
	return damage_boost if has(Effect.EXTRA_DAMAGE) else 1.0


func speed_multiplier() -> float:
	var m := 1.0
	if has(Effect.SPEED):
		m *= speed_boost
	if has(Effect.SLOWED):
		m *= slow_factor
	return m


## The weapon asks this as it fires: true once if a One-Shot Round is loaded (then it's spent,
## hit or miss: "next bullet", not "next hit").
func take_one_shot() -> bool:
	if not has(Effect.ONE_SHOT):
		return false
	_end(Effect.ONE_SHOT)
	return true


## The weapon reports each hit it lands. Scrambler inverts the target's controls.
## (Duck-typed on purpose: naming the Duo class here would make every script that uses
## WeaponComponent depend on Duo and its autoloads, which breaks headless test scripts.)
func on_hit_dealt(target: Node) -> void:
	if not has(Effect.SCRAMBLER) or target == null or target == duo:
		return
	var theirs: Variant = target.get("powerups")
	if theirs is PowerupComponent and target.get("alive") == true:
		theirs.apply(Effect.INVERTED, scrambled_seconds)


static func is_buff(effect: Effect) -> bool:
	return INFO[effect].buff


static func display_name(effect: Effect) -> String:
	return INFO[effect].name


## A random effect, weighted by INFO.weight (mostly buffs, sometimes a nasty surprise).
static func roll(rng: RandomNumberGenerator) -> Effect:
	var total := 0.0
	for effect in INFO:
		total += INFO[effect].weight
	var pick := rng.randf() * total
	for effect in INFO:
		pick -= INFO[effect].weight
		if pick <= 0.0:
			return effect
	return Effect.EXTRA_DAMAGE
