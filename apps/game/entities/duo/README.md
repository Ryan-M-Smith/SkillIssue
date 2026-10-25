# Duo player

One character, two players. The **mover** drives `Legs`, the **gunner** drives `Torso` + `Head`.

```
Duo (CharacterBody3D)            duo.gd: wires components, nothing else
├── Legs/Model                   leg boxes + DuoLegsAnimator (walk swing, air tuck, crouch squash)
│   ├── LeftHip, RightHip        pivots the animator rotates; keep these if you swap in a real model
│   ├── Pelvis
│   (Legs/LegsHurtbox            legs zone, squashes with crouch)
├── Torso                        yaw (gunner turns)
│   ├── Model                    chest, arms, backpack (backpack marks the back)
│   ├── BodyHurtbox              body zone (sized by Components/Hitboxes from the HitboxProfile)
│   └── Head                     pitch (gunner looks up/down); camera follows this via CameraMount
│       ├── Model/Cockpit        headshot zone (HeadHurtbox matches it)
│       ├── Model/ThirdPersonGun the gun the ENEMY sees, follows the current weapon
│       └── ViewModel/GunMesh    the gun YOU see in first person
├── Components                   Movement · Aim · Weapons · Health · Team
└── Controllers                  phone + keyboard controllers are added at runtime
```

**Try it:** open `res://modes/duo_sandbox.tscn` and press F6.
Team A (Blue, left screen): WASD move, Space jump, C crouch, hold Shift sprint, mouse aim (click to capture), left click fire, right click scope, Q / mouse wheel swap gun.
Team B (Red, right screen): IJKL move, U jump, O crouch, hold P sprint, arrow keys aim, Enter fire, / scope, . (period) swap gun.

Reloading is automatic. Shotgun and sniper ammo is limited: when it runs out the gun is gone until you pick up another.

**Tune it:** numbers live in `data/` (`.tres` files, edit in the Inspector, re-run).
- `data/hitboxes/default_hitboxes.tres`: head / body / legs box sizes, positions, damage multipliers
  (head uses each gun's `headshot_multiplier`; body ×1.0, legs ×0.75 by default).
- `data/weapons/*.tres` → **Spread** (base, moving / airborne add, crouch multiplier, bloom, RANDOM or RING
  pattern) and **Trail** (tracer color / width / lifetime, impact size / lifetime).
- Press **F3** in the sandbox to see the enemy's hitbox zones (red head, yellow body, blue legs) and each
  team's live spread circle.

**Team globals:** the Duo uses the team's `GameEvents` autoload (owned by the structure teammate).
It emits `health_changed(team, hp, max_hp)` and `duo_killed(victim_team, killer_team)`, and the
sandbox emits `score_changed(team, score)`. Phone input connects only if `NetworkBridge` provides
`phone_message` / `send_to`, so the current placeholder `NetworkBridge` causes no errors.

**Swap in a real model:** replace the boxes under `Legs/Model`, `Torso/Model` and `Torso/Head/Model`.
Meshes are tinted the team color unless they are in the `no_tint` group. Resize `BodyHurtbox` /
`HeadHurtbox` to fit, and move `Head` if the eye height changes.
