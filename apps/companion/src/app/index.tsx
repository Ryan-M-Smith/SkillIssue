
import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView, ScrollView, View, Text, Pressable,
  StyleSheet, StatusBar,
} from "react-native";
import { DeviceMotion } from "expo-sensors";

import {
  MotionController,
  EMPTY_CONTROLS,
  type Role,
  type GameControls,
  type MotionDebug,
} from "../service/motion-control-service";

const COLORS = {
  bg: "#0A1020",
  card: "#161F32",
  border: "#2A3954",
  text: "#F1F6FF",
  muted: "#99AAC6",
  blue: "#57AAFF",
  green: "#39DBA2",
  yellow: "#FFC267",
  red: "#FF7891",
};

type EventType = "jump" | "crouch" | "shoot" | "sprint";
type Counts = Record<EventType, number>;

const ZERO_COUNTS: Counts = {
  jump: 0,
  crouch: 0,
  shoot: 0,
  sprint: 0,
};

const ZERO_DEBUG: MotionDebug = {
  calibration: "calibrating",
  pitchDeg: 0,
  sidePressDeg: 0,
  pitchRate: 0,
  sidePressRate: 0,
  sprintPhase: "idle",
  strafeMeters: 0,
  positionTracking: "missing",
};

const fmt = (n: number, places = 1) =>
  Number.isFinite(n) ? n.toFixed(places) : "0";

// -------------------- UI COMPONENTS --------------------

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Axis({
  name,
  value,
  negative,
  positive,
}: {
  name: string;
  value: number;
  negative: string;
  positive: string;
}) {
  const v = Math.max(-1, Math.min(1, value));

  const percent =
    `${Math.round(Math.abs(v) * 100)}%` as `${number}%`;

  return (
    <View style={styles.axis}>
      <View style={styles.line}>
        <Text style={styles.label}>{name}</Text>
        <Text style={styles.value}>
          {v >= 0 ? "+" : ""}
          {fmt(v, 2)}
        </Text>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: percent },
          ]}
        />
      </View>

      <View style={styles.line}>
        <Text style={styles.hint}>− {negative}</Text>
        <Text style={styles.hint}>+ {positive}</Text>
      </View>
    </View>
  );
}

function Value({
  name,
  value,
  active = false,
}: {
  name: string;
  value: string | number;
  active?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.hint}>{name}</Text>
      <Text
        style={[
          styles.metricValue,
          active && { color: COLORS.green },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// -------------------- MAIN SCREEN --------------------

export default function Index() {
  const [role, setRole] = useState<Role>("movement");

  const [status, setStatus] = useState("STOPPED");
  const [error, setError] = useState("");

  const [controls, setControls] =
    useState<GameControls>(EMPTY_CONTROLS);

  const [debug, setDebug] =
    useState<MotionDebug>(ZERO_DEBUG);

  const [counts, setCounts] =
    useState<Counts>(ZERO_COUNTS);

  const [history, setHistory] =
    useState<string[]>([]);

  const [rateHz, setRateHz] = useState(0);

  const [rawGyro, setRawGyro] = useState({
    alpha: 0,
    beta: 0,
    gamma: 0,
  });

  const [rawAccel, setRawAccel] = useState({
    x: 0,
    y: 0,
    z: 0,
  });

  // -------------------- REFS --------------------

  const controllerRef = useRef(
    new MotionController("movement")
  );

  const subRef = useRef<
    ReturnType<typeof DeviceMotion.addListener> | null
  >(null);

  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  const lastRenderRef = useRef(0);

  const sampleWindowRef = useRef(0);
  const sampleCountRef = useRef(0);

  const priorSprintPhaseRef =
    useRef<MotionDebug["sprintPhase"]>("idle");

  const priorCrouchRef = useRef(false);

  // -------------------- CLEANUP --------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      subRef.current?.remove();
      subRef.current = null;
    };
  }, []);

  // -------------------- RESET --------------------

  function clearReadings() {
    setControls({ ...EMPTY_CONTROLS });
    setDebug({ ...ZERO_DEBUG });
    setCounts({ ...ZERO_COUNTS });

    setHistory([]);
    setRateHz(0);

    setRawGyro({
      alpha: 0,
      beta: 0,
      gamma: 0,
    });

    setRawAccel({
      x: 0,
      y: 0,
      z: 0,
    });

    lastRenderRef.current = 0;
    sampleWindowRef.current = 0;
    sampleCountRef.current = 0;

    priorSprintPhaseRef.current = "idle";
    priorCrouchRef.current = false;
  }

  function recalibrate() {
    controllerRef.current.reset();
    clearReadings();
  }

  function changeRole(next: Role) {
    if (next === role) return;

    setRole(next);

    controllerRef.current =
      new MotionController(next);

    clearReadings();
  }

  // -------------------- EVENT DETECTION --------------------

  function detected(event: EventType, now: number) {
    setCounts((prev) => ({
      ...prev,
      [event]: prev[event] + 1,
    }));

    setHistory((prev) => [
      `${new Date(now).toLocaleTimeString()} • ${event.toUpperCase()}`,
      ...prev,
    ].slice(0, 6));

    console.log("[Motion gesture]", event);
  }

  // -------------------- SENSOR CONTROLS --------------------

  function stop() {
    subRef.current?.remove();
    subRef.current = null;

    setStatus("STOPPED");

    controllerRef.current.reset();
    clearReadings();
  }

  async function start() {
    if (startingRef.current || subRef.current) {
      return;
    }

    startingRef.current = true;

    setStatus("CONNECTING");
    setError("");

    try {
      const permission =
        await DeviceMotion.requestPermissionsAsync();

      if (!permission.granted) {
        throw new Error(
          "Motion permission denied. Check app settings."
        );
      }

      const available =
        await DeviceMotion.isAvailableAsync();

      if (!available) {
        throw new Error(
          "DeviceMotion unavailable. Use a physical phone."
        );
      }

      if (!mountedRef.current) return;

      recalibrate();

      // Request 50 sensor samples per second.
      DeviceMotion.setUpdateInterval(20);

      subRef.current = DeviceMotion.addListener(
        (reading) => {
          const now = Date.now();

          // Main motion-control processing.
          const output =
            controllerRef.current.process(reading, now);

          const d =
            controllerRef.current.getDebug();

          // Sprint is stored internally in MotionController.
          // Entering cooldown means a complete sprint gesture
          // was recognized.
          if (
            d.sprintPhase === "cooldown" &&
            priorSprintPhaseRef.current !== "cooldown"
          ) {
            detected("sprint", now);
          }

          priorSprintPhaseRef.current =
            d.sprintPhase;

          // Jump, crouch, or shoot events.
          if (output.action) {
            detected(output.action, now);
          }

          // Calculate actual sampling frequency.
          sampleCountRef.current++;

          if (!sampleWindowRef.current) {
            sampleWindowRef.current = now;
          }

          const elapsed =
            now - sampleWindowRef.current;

          if (elapsed >= 1000) {
            setRateHz(
              Math.round(
                sampleCountRef.current * 1000 / elapsed
              )
            );

            sampleCountRef.current = 0;
            sampleWindowRef.current = now;
          }

          const crouchChanged =
            output.crouch !== priorCrouchRef.current;

          priorCrouchRef.current =
            output.crouch;

          // Process all sensor samples, but redraw
          // UI approximately 12 times per second.
          if (
            now - lastRenderRef.current >= 80 ||
            output.action ||
            crouchChanged
          ) {
            lastRenderRef.current = now;

            setControls(output);
            setDebug(d);

            setRawGyro({
              alpha: reading.rotationRate?.alpha ?? 0,
              beta: reading.rotationRate?.beta ?? 0,
              gamma: reading.rotationRate?.gamma ?? 0,
            });

            setRawAccel({
              x: reading.acceleration?.x ?? 0,
              y: reading.acceleration?.y ?? 0,
              z: reading.acceleration?.z ?? 0,
            });
          }
        }
      );

      setStatus("LIVE");
    } catch (e) {
      if (mountedRef.current) {
        setStatus("ERROR");

        setError(
          e instanceof Error
            ? e.message
            : String(e)
        );
      }
    } finally {
      startingRef.current = false;
    }
  }

  // -------------------- UI --------------------

  const connected = status === "LIVE";
  const ready = connected && controls.ready;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar
        barStyle="light-content"
      />

      <ScrollView contentContainerStyle={styles.content}>

        {/* HEADER */}

        <View style={styles.line}>
          <View>
            <Text style={styles.overline}>
              2V2 PHONE CONTROLLER
            </Text>

            <Text style={styles.title}>
              MOTION LAB
            </Text>
          </View>

          <Text
            style={[
              styles.badge,
              ready && styles.badgeReady,
            ]}
          >
            {ready
              ? "● READY"
              : connected
                ? "◌ CALIBRATING"
                : status}
          </Text>
        </View>

        {/* ROLE SELECTOR */}

        <View style={styles.roles}>
          {(["movement", "gunner"] as Role[]).map(
            (r) => (
              <Pressable
                key={r}
                onPress={() => changeRole(r)}
                style={[
                  styles.roleButton,
                  r === role && styles.selectedRole,
                ]}
              >
                <Text style={styles.roleText}>
                  {r.toUpperCase()}
                </Text>
              </Pressable>
            )
          )}
        </View>

        {/* START / RESET */}

        <View style={styles.buttons}>
          <Pressable
            onPress={connected ? stop : start}
            disabled={status === "CONNECTING"}
            style={[
              styles.startButton,
              connected && {
                backgroundColor: "#9F3555",
              },
            ]}
          >
            <Text style={styles.buttonText}>
              {connected
                ? "STOP SENSORS"
                : "START SENSORS"}
            </Text>
          </Pressable>

          <Pressable
            onPress={recalibrate}
            style={styles.resetButton}
          >
            <Text style={styles.buttonText}>
              RECALIBRATE
            </Text>
          </Pressable>
        </View>

        {!!error && (
          <Text style={styles.error}>{error}</Text>
        )}

        {/* CONNECTION STATISTICS */}

        <View style={styles.stats}>
          <Value
            name="SENSOR RATE"
            value={`${rateHz} Hz`}
          />

          <Value
            name="CALIBRATION"
            value={ready ? "READY" : "WAITING"}
            active={ready}
          />

          <Value
            name="ROLE"
            value={role.toUpperCase()}
          />
        </View>

        {/* GAME OUTPUT */}

        <Panel
          title={
            role === "movement"
              ? "MOVEMENT OUTPUT"
              : "AIM OUTPUT"
          }
        >
          {role === "movement" ? (
            <>
              <Axis
                name="FORWARD / BACK"
                value={controls.moveY}
                negative="back"
                positive="forward"
              />

              <Axis
                name="STRAFE"
                value={controls.moveX}
                negative="left"
                positive="right"
              />

              <View style={styles.stats}>
                <Value
                  name="SPRINT"
                  value={controls.sprint ? "ON" : "OFF"}
                  active={controls.sprint}
                />

                <Value
                  name="CROUCH"
                  value={controls.crouch ? "ON" : "OFF"}
                  active={controls.crouch}
                />
              </View>
            </>
          ) : (
            <>
              <Axis
                name="LOOK HORIZONTAL"
                value={controls.lookX}
                negative="left"
                positive="right"
              />

              <Axis
                name="LOOK VERTICAL"
                value={controls.lookY}
                negative="down"
                positive="up"
              />
            </>
          )}
        </Panel>

        {/* GESTURE COUNTERS */}

        <Panel title="GESTURES DETECTED">
          <View style={styles.stats}>
            {(
              role === "movement"
                ? ["jump", "crouch", "sprint"]
                : ["shoot"]
            ).map((name) => (
              <Value
                key={name}
                name={name.toUpperCase()}
                value={counts[name as EventType]}
              />
            ))}
          </View>

          {history.length === 0 ? (
            <Text style={styles.hint}>
              Perform a gesture to see an event here.
            </Text>
          ) : (
            history.map((event, i) => (
              <Text
                key={`${event}-${i}`}
                style={styles.event}
              >
                {event}
              </Text>
            ))
          )}
        </Panel>

        {/* MOTION DIAGNOSTICS */}

        <Panel title="GESTURE DIAGNOSTICS">
          <View style={styles.stats}>
            <Value
              name="PITCH ANGLE"
              value={`${fmt(debug.pitchDeg)}°`}
            />

            <Value
              name="SIDE-PRESS ANGLE"
              value={`${fmt(debug.sidePressDeg)}°`}
            />
          </View>

          <View style={styles.stats}>
            <Value
              name="PITCH RATE"
              value={`${fmt(debug.pitchRate, 0)} °/s`}
            />

            <Value
              name="SIDE-PRESS RATE"
              value={`${fmt(debug.sidePressRate, 0)} °/s`}
            />
          </View>

          <View style={styles.line}>
            <Text style={styles.label}>
              Sprint recognition phase
            </Text>

            <Text style={styles.highlight}>
              {debug.sprintPhase.toUpperCase()}
            </Text>
          </View>

          <View style={styles.line}>
            <Text style={styles.label}>
              AR position tracking
            </Text>

            <Text style={styles.value}>
              {debug.positionTracking.toUpperCase()}
            </Text>
          </View>

          <View style={styles.line}>
            <Text style={styles.label}>
              Sideways displacement
            </Text>

            <Text style={styles.value}>
              {fmt(debug.strafeMeters, 3)} m
            </Text>
          </View>
        </Panel>

        {/* RAW SENSOR VALUES */}

        <Panel title="RAW SENSOR VALUES">
          <Text style={styles.raw}>
            GYRO °/s:
            {"  "}α {fmt(rawGyro.alpha)}
            {"  "}β {fmt(rawGyro.beta)}
            {"  "}γ {fmt(rawGyro.gamma)}
          </Text>

          <Text style={styles.raw}>
            ACCEL m/s²:
            {"  "}X {fmt(rawAccel.x)}
            {"  "}Y {fmt(rawAccel.y)}
            {"  "}Z {fmt(rawAccel.z)}
          </Text>
        </Panel>

        {/* INSTRUCTIONS */}

        <Text style={styles.note}>
          TESTING INSTRUCTIONS

          {"\n\n"}
          1. Start sensors and hold the phone still
          for roughly one second.

          {"\n"}
          2. Slowly tilt forward/backward to test walking.

          {"\n"}
          3. Quickly flick backward for jump.

          {"\n"}
          4. Quickly flick forward for crouch.

          {"\n"}
          5. Quickly press alternating sides of the
          phone down for sprint.

          {"\n\n"}
          Sprint gestures are counted even when the
          player is not moving forward.

          {"\n\n"}
          Physical sideways strafing requires an
          AR position feed. Without it, moveX remains zero.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// -------------------- STYLES --------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  content: {
    padding: 18,
    paddingBottom: 50,
    gap: 14,
  },

  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  overline: {
    color: COLORS.blue,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
  },

  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 3,
  },

  badge: {
    color: COLORS.yellow,
    borderColor: COLORS.yellow,
    borderWidth: 1,
    padding: 8,
    borderRadius: 20,
    fontSize: 10,
    fontWeight: "800",
  },

  badgeReady: {
    color: COLORS.green,
    borderColor: COLORS.green,
  },

  roles: {
    flexDirection: "row",
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },

  roleButton: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 9,
  },

  selectedRole: {
    backgroundColor: "#295B85",
  },

  roleText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },

  buttons: {
    flexDirection: "row",
    gap: 10,
  },

  startButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#287CC9",
    padding: 14,
    borderRadius: 10,
  },

  resetButton: {
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#33415B",
    borderRadius: 10,
  },

  buttonText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },

  error: {
    color: COLORS.red,
    backgroundColor: "#442431",
    borderRadius: 8,
    padding: 10,
  },

  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  metric: {
    flexGrow: 1,
    flexBasis: 90,
    backgroundColor: "#1D2A40",
    borderRadius: 9,
    padding: 12,
    gap: 5,
  },

  metricValue: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "900",
  },

  panel: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 15,
    gap: 14,
  },

  panelTitle: {
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 0.6,
  },

  label: {
    color: "#CBD8ED",
    fontSize: 12,
    fontWeight: "700",
  },

  value: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "900",
  },

  hint: {
    color: COLORS.muted,
    fontSize: 11,
  },

  axis: {
    gap: 7,
  },

  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#34435D",
    overflow: "hidden",
  },

  fill: {
    height: 10,
    backgroundColor: COLORS.blue,
    borderRadius: 5,
  },

  event: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "700",
  },

  highlight: {
    color: COLORS.yellow,
    fontSize: 12,
    fontWeight: "900",
  },

  raw: {
    color: COLORS.blue,
    fontSize: 11,
  },

  note: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 20,
    paddingHorizontal: 4,
  },
});
