# Gunner gyro aiming

Gunner aiming uses the phone gyroscope for relative yaw and pitch. Slow turns map about 1:1; fast turns get a gradual sensitivity gain capped at 1.5x. Yaw has no 360-degree cap, so rotating the phone continuously can turn the camera through 240?360 degrees and further. Pitch stays within the normal first-person look range.

Every valid gyro sample contributes its turn directly. A phone-side low-pass filter was removed after simulation showed it dropped part of a quick turn when the sensor stopped. Godot retains an 8 ms filter on accumulated turns to smooth packet timing while preserving total camera rotation. The gunner's aim response is the only gameplay behavior changed in this follow-up.

## Verification

- 53 companion tests pass, including simulated full phone rotations in both landscape grips on Android and iOS models.
- TypeScript checks and Expo lint pass.
- All 5 network integration tests pass, including the embedded Godot server.
- Godot gameplay, lifecycle, and rules smoke checks pass (69, 25, and 32 checks).

These simulations verify axis math and turn accumulation. They cannot confirm physical feel, sensor noise, or relay latency on a handset; that still needs a phone test.
