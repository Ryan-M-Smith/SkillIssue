# Gunner gyro aiming

Gunner aiming uses the phone gyroscope for relative yaw and pitch. Slow turns map about 1:1; fast turns get a gradual sensitivity gain capped at 1.5x. Yaw has no 360-degree cap, so rotating the phone continuously can turn the camera through 240?360 degrees and further. Pitch stays within the normal first-person look range.

Every valid gyro sample contributes its turn directly. A phone-side low-pass filter was removed after simulation showed it dropped part of a quick turn when the sensor stopped. Godot retains an 8 ms filter on accumulated turns to smooth packet timing while preserving total camera rotation. The gunner's aim response is the only gameplay behavior changed in this follow-up.

## Verification

- 53 companion tests pass, including simulated full phone rotations in both landscape grips on Android and iOS models.
- TypeScript checks and Expo lint pass.
- All 5 network integration tests pass, including the embedded Godot server.
- Godot gameplay, lifecycle, and rules smoke checks pass (69, 25, and 32 checks).

These simulations verify axis math and turn accumulation. They cannot confirm physical feel, sensor noise, or relay latency on a handset; that still needs a phone test.


## Slow aim response

The gyro deadzone is now 0.2 degrees per second (was 1.2), with a smooth sensitivity ramp immediately above it. After calibration, bias tracking only follows readings below 0.2 degrees per second so a sustained slow turn is not learned away. Resting sensor noise below the threshold remains ignored.


## Slow turn follow-up

The deadzone is now 0.2 degrees per second, and the response curve starts smoothly above it. Post calibration gyro bias tracking is limited to rates below the same threshold, so it does not cancel a deliberate slow turn. Companion coverage confirms 0.4 degrees/second produces aim movement while 0.1 degrees/second tremor remains suppressed.
