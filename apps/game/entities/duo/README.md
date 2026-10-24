# Duo player

One character, two players. The **mover** drives `Legs`, the **gunner** drives `Torso` + `Head`.

```
Duo (CharacterBody3D)            duo.gd: wires components, nothing else
├── Legs/Model                   leg boxes + DuoLegsAnimator (walk swing, air tuck, crouch squash)
│   ├── LeftHip, RightHip        pivots the animator rotates; keep these if you swap in a real model
│   └── Pelvis
├── Torso                        yaw (gunner turns)
│   ├── Model                    chest, arms, backpack (backpack marks the back)
│   ├── BodyHurtbox              normal damage
│   └── Head                     pitch (gunner looks up/down); camera follows this via CameraMount
│       ├── Model/Cockpit        headshot zone (HeadHurtbox matches it)
│       ├── Model/ThirdPersonGun the gun the ENEMY sees, follows the current weapon
│       └── ViewModel/GunMesh    the gun YOU see in first person
├── Components                   Movement · Aim · Weapons · Health · Team
└── Controllers                  phone + keyboard controllers are added at runtime
```

**Try it:** open `res://modes/duo_sandbox.tscn` and press F6.
Team A (left screen): WASD, Space jump, Ctrl crouch, mouse aim (click to capture), LMB fire, RMB scope, 1/2/3 guns.
Team B (right screen): IJKL, Shift jump, N crouch, arrow keys aim, Enter fire, M scope, 8/9/0 guns.

**Tune it:** numbers live in `data/` (`.tres` files, edit in the Inspector, re-run).

**Team globals:** the Duo uses the team's `GameEvents` autoload (owned by the structure teammate).
It emits `health_changed(team, hp, max_hp)` and `duo_killed(victim_team, killer_team)`, and the
sandbox emits `score_changed(team, score)`. Phone input connects only if `NetworkBridge` provides
`phone_message` / `send_to`, so the current placeholder `NetworkBridge` causes no errors.

**Swap in a real model:** replace the boxes under `Legs/Model`, `Torso/Model` and `Torso/Head/Model`.
Meshes are tinted the team color unless they are in the `no_tint` group. Resize `BodyHurtbox` /
`HeadHurtbox` to fit, and move `Head` if the eye height changes.
