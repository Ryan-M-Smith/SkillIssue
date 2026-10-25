# Gunner smoothing and gesture audit

## Changes

- Added a 25 ms exponential filter to phone camera input in Godot. Packet bursts are spread over physics frames without extrapolating or losing the accumulated angle. Disconnect, stale input and match transitions clear pending turns through the existing router reset path.
- Replaced the abrupt aiming deadzone with a continuous transition: resting noise below 1 degree/second is ignored; larger turns retain full sensitivity. Degree/radian conversion remains unchanged.
- Fixed the phone transport clearing unsent camera deltas when WebSocket backpressure prevents sending. Brief congestion retains the turn; frozen sensor input discards stale turns.
- Fixed the movement component looking for its health sibling at an invalid child path, which caused runtime errors when loading characters.
- Kept runner jump/crouch gestures and UI unchanged, as requested. No jump/crouch buttons were added.

## Expo Go limitation

Jump/crouch flicks can trigger Expo Go's native shake-to-open developer menu. Android Expo Go does not expose a supported JavaScript switch to disable this shortcut. Calling React Native's iOS-only shake setting on Android does nothing; hiding the menu after it opens would interrupt gameplay anyway. This native Expo Go behavior is not fixed by this commit.

For motion-only play without the developer menu, use an installed release preview APK. The repository already has an internal APK profile in `apps/companion/eas.json`. From `apps/companion`, run `npx eas-cli@latest build --platform android --profile preview`, then install the resulting APK. This requires an Expo account/build service; no APK was built or installed during this change.

References: [Expo developer menu](https://docs.expo.dev/versions/v58.0.0/sdk/dev-menu/), [Android native menu exports](https://github.com/expo/expo/blob/main/packages/expo-dev-menu/android/src/debug/java/expo/modules/devmenu/modules/DevMenuModule.kt).

## Validation

- Companion regression suite: 47 tests pass, including fresh-turn retention under backpressure and stale-turn discard.
- TypeScript and Expo lint pass.
- Godot gameplay smoke: 67 checks pass, including actual yaw/pitch, camera transform propagation, conserved turn angle and disconnect clearing.
- Godot lifecycle smoke: 25 checks pass.
- Network integration: all 4 tests pass, including real WebSocket clients against the embedded Godot server.

Physical Android/iOS feel and real relay latency still need a device check. Automated tests verify the camera path, but do not establish why a particular handset previously had no aiming or guarantee flawless play. Pull main, restart the game, clear Metro's cache, then test both landscape grips after holding still briefly for calibration.

## Mouse-style aiming follow-up

The phone now uses a shared radial sensitivity curve for yaw and pitch: 1.5x for deliberate slow turns, smoothly rising to 3x for fast sweeps (20 to 90 degrees/second). A fast 30-degree wrist turn can rotate the view 90 degrees. The radial curve preserves diagonal direction and equal horizontal/vertical sensitivity. Resting noise is suppressed with a continuous transition. This replaces the old physical 1:1 mapping; Godot still consumes each transmitted camera-angle delta exactly once.

The game-side packet filter is now 8 ms instead of 25 ms. At 60 physics frames/second, over 85% of a received turn applies on the first frame; the remainder settles quickly. No phone-side temporal filter adds another delay. Scope sensitivity continues to apply in Godot.

Validation: 50 companion tests, TypeScript, lint, 67 Godot gameplay checks and 25 lifecycle checks. The camera smoke test now enforces the faster first-frame response. Runner gestures are unchanged. Physical handset testing is still needed to assess personal sensitivity and network conditions.

## Accidental sprint follow-up

Sprint now needs a wheel twist past 40 degrees held for 120 ms. A second toggle requires returning within 8 degrees of center for 150 ms, with a 650 ms cooldown. Pitch flicks and their recovery suppress sprint detection. This keeps jump/crouch gesture controls while rejecting brief incidental twists and swings through center. Practice and runner instructions show the new gesture.

Validation: all 52 companion tests, TypeScript and lint pass. New regression cases cover mixed forward/sideways motion with incidental twist, short threshold crossings, required center dwell, and intentional toggles in both landscape grips on Android/iOS models.
