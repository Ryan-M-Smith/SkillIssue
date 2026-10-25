# Gunner screen tilt controls

Gunner aim now reads the phone's calibrated gravity direction instead of waiting for a gyroscope flick. Tilt the screen left or right to turn in that direction, and up or down to look vertically. The view keeps turning while the phone is tilted; return it to the calibrated neutral position to stop. Small tilts produce slow aim, with the rate increasing smoothly up to 130 degrees per second.

The controls use the same screen-relative motion frame on iOS and Android. Neutral jitter below 1.2 degrees is ignored. This implementation assumes left tilt should look left and right tilt should look right; the earlier request said both directions should look right, which appeared to be a wording mistake.

## Verification

- 56 companion tests pass. Coverage includes all four tilt directions in both landscape grips on iOS and Android, neutral stop, slow tilt, and a sustained tilt that rotates the camera through a full sweep.
- TypeScript and Expo lint pass.
- The tests use simulated sensor readings; physical iPhone and Android feel still needs device testing.
