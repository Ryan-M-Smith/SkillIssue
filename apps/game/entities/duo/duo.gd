## One character, two players. Wires components together and nothing else:
## it doesn't know whether its input comes from phones, a keyboard or a bot.
class_name Duo
extends CharacterBody3D

signal respawned()
## A health pack was picked up (the HUD flashes a green vignette).
signal health_picked_up(amount: float)
## Emitted on death with the killer Duo (or null) and the weapon name, for kill feeds.
signal killed(killer: Node, weapon_name: String)

@onready var legs: Node3D = $Legs
@onready var torso: Node3D = $Torso
@onready var head: Node3D = $Torso/Head
@onready var camera_mount: RemoteTransform3D = $Torso/Head/CameraMount
@onready var movement: MovementComponent = $Components/Movement
@onready var aim: AimComponent = $Components/Aim
@onready var weapons: WeaponComponent = $Components/Weapons
@onready var health: HealthComponent = $Components/Health
@onready var team: TeamComponent = $Components/Team
@onready var hitboxes: HitboxComponent = $Components/Hitboxes
@onready var controllers: Node = $Controllers

## Seconds of spawn protection after respawning (not at kick-off). Firing ends it early.
@export var spawn_protection := 2.0

## Buffs / debuffs (mystery boxes, Scrambler hits). Created in _ready, under Components.
var powerups: PowerupComponent
var input := DuoInput.new()
var alive := true
var team_id: int:
	get: return team.team.id if team and team.team else 0

var _layer := 0
var _hurtboxes: Array[Hurtbox] = []


func _ready() -> void:
	_layer = collision_layer
	powerups = PowerupComponent.new()
	powerups.name = "Powerups"
	powerups.duo = self
	$Components.add_child(powerups)
	weapons.powerups = powerups
	for h in find_children("*", "Area3D", true, false):
		if h is Hurtbox:
			_hurtboxes.append(h)
	var rids: Array[RID] = [get_rid()]
	for h in _hurtboxes:
		rids.append(h.get_rid())
	weapons.set_excluded(rids)
	health.died.connect(_on_died)
	weapons.fired.connect(func(_data: WeaponData): health.protect(0.0))
	# Report to the team's GameEvents bus (owned by the structure teammate).
	health.health_changed.connect(func(hp: float, max_hp: float): GameEvents.health_changed.emit(team_id, hp, max_hp))
	health.damaged.connect(func(_amount: float, _source: Node): team.flash())
	if team.team:
		team.apply(team.team)


func setup(team_data: TeamData) -> void:
	team.apply(team_data)
	name = "Duo_%s" % team_data.display_name


func add_controller(c: DuoController) -> void:
	controllers.add_child(c)
	c.duo = self
	c._on_attached()
	
func modify_health(add: int) -> void:
	if health.has_method("heal"):
		print('give health')
		health.heal(20)
		health_picked_up.emit(20.0)

func test_damage() -> void:
	print('ok')
	if health.has_method("test_damage"):
		health.test_damage()


func _physics_process(delta: float) -> void:
	input.reset()
	for c in controllers.get_children():
		if c is DuoController:
			c.poll(input, delta)   # always poll so stale aim deltas don't pile up while dead
	input.clamp_values()
	if not alive:
		return
	powerups.modify_input(input)
	movement.speed_scale = powerups.speed_multiplier()
	movement.tick(input, delta)
	aim.tick(input, delta)
	weapons.tick(input, delta)


func _on_died(killer: Node) -> void:
	alive = false
	powerups.clear()
	weapons._set_scoped(false)
	_set_present(false)
	var killer_team := -1    # -1 = no killer (fell off the map, etc.)
	var weapon_name := "the void"
	if killer is Duo and killer != self:
		killer_team = killer.team_id
		weapon_name = killer.weapons.current_data().display_name
	killed.emit(killer, weapon_name)                    # rich local signal (who + which gun)
	GameEvents.duo_killed.emit(team_id, killer_team)     # team bus: victim_team, killer_team


## protect: give spawn protection (the match mode turns it on for respawns after a death).
func respawn(at: Transform3D, protect := false) -> void:
	global_position = at.origin
	var yaw := at.basis.get_euler().y
	aim.face(yaw)
	legs.rotation.y = yaw
	movement.reset()
	health.reset()
	health.protect(spawn_protection if protect else 0.0)
	weapons.reset_loadout()
	alive = true
	_set_present(true)
	respawned.emit()


func _set_present(on: bool) -> void:
	legs.visible = on
	torso.visible = on
	collision_layer = _layer if on else 0
	for h in _hurtboxes:
		h.set_enabled(on)
