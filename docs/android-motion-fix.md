# Android motion fix

The Android controller now reads Expo's raw accelerometer and gyroscope. It does not request `ACTIVITY_RECOGNITION`: the installed Expo DeviceMotion implementation requests that unrelated permission and also requires several fused sensors. Android phones with the two required physical sensors can now start without that permission gate. iOS keeps DeviceMotion and its motion permission; browsers keep their tap-to-request permission flow.

One adapter converts Android accelerometer **g** to gravity-down **m/s²**, and raw gyro **rad/s** to the controller's **deg/s**. Network angular velocity still converts to rad/s once; exact camera deltas remain degrees until Godot converts them once. Gyroscope and accelerometer measurements more than 250 ms apart are rejected, as are duplicate/invalid readings.

The motion model now accepts browser top-level sensor timestamps in seconds, recovers from timestamp resets and source changes, and recalibrates after background gaps instead of integrating a camera jump. Raw Android gravity uses a complementary gyro/accelerometer filter with reduced accelerometer influence during jolts. Initial small gyro bias is learned, with slow zero-rate adaptation. Existing adaptive neutral tracking, comfortable sprint, grip-change recalibration, and 1:1 gunner aiming are retained.

All controller screens and the legacy sensor hook use the same sensor adapter and permission policy. The entry route was restored to the existing phone app because its local debug/controller imports pointed to deleted screens.

Validation: 45 companion regression tests, TypeScript checks, lint, and web/Android/iOS exports. New tests cover Android permission independence, missing sensors, unit conversion, timestamp mismatch/restart, queued browser callbacks, backgrounding, gyro bias, and both landscape grips using raw Android measurements. Physical Samsung testing is still required; an export is not a device test.

The lateral-sensitivity follow-up gives strafing independent thresholds: 3.5° to start, below 3° to stop, and full speed at 12°, with a stronger small-tilt response. Forward/backward retains its 5°–20° response. The updated 46-test suite checks both directions, stopping at center, unchanged forward response, drift resistance, and sprint separation; raw Android checks cover both landscape grips.

Restart Expo with a cleared cache, reopen the project in Expo Go, and test Practice: hold still briefly, tilt to walk/strafe, twist to toggle sprint, and turn the gunner phone to aim. Returning after backgrounding should briefly recalibrate. Android should not ask for activity-recognition permission. Check that neither Android's Sensors Off control nor device-level sensor restrictions are enabled.
