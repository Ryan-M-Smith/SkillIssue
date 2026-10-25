# Natural motion controls

The way you move the phone is the way you move.

## Gunner: 1:1 gyro aim

The view turns by exactly what the phone turned, with no gain curve or rate cap. Turning your body
(or the phone in your hands) about true vertical turns the view, however far the phone is tilted
back. Tipping the top edge toward you looks up and away looks down. Holding still holds the view,
and pointing the phone back where it was puts the view back where it was.

- Each gyroscope sample's exact turn goes to the game as `lookDX`/`lookDY` in degrees. No
  phone-side smoothing, so there's nothing to lag.
- Below 0.2°/s is treated as resting noise, ramping to exactly 1:1 by 1°/s.
- The gyro's zero-rate bias is learned during calibration and keeps being tracked whenever the
  phone is still, so a resting phone doesn't creep the view.

This replaces tilt-to-steer, where holding a tilt kept the view turning.

## Runner: walk where the phone tips

Forward and side tilt are read as one direction, not two separate sticks. Tip the top-right corner
away and the character walks forward-right. How far you tip sets the speed. The deadzone and full
speed are ellipses, because side tips need less wrist (full speed at 12° sideways, 20° forward).
So on a single axis the feel is unchanged, and diagonals now go where the phone points. Tremor
under about 1° on the axis you aren't tipping is ignored, so straight walks stay straight.

## Verification

Companion tests run a simulated phone (both landscape grips, iOS and Android). They check:

- a 20° turn gives a 20° view turn, and turning back returns the view;
- a 360° turn gives 360° and a 600°/s flick turns all the way;
- tilted-back turns don't pitch the view;
- with gyro bias there's no drift over 10 s;
- diagonal tips walk in the tipped direction.

Real-device feel still needs a playtest.
