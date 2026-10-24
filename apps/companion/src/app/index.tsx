
import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
} from "react-native";

import { DeviceMotion } from "expo-sensors";

import {
  MotionController,
  EMPTY_CONTROLS,
  type Role,
} from "../service/motionControlService";

type Counts = {
  jump: number;
  crouch: number;
  shoot: number;
};

const fmt = (n: number) => n.toFixed(2);

export default function Index() {
  const [role, setRole] = useState<Role>("movement");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("Not started");

  const [controls, setControls] = useState({
    ...EMPTY_CONTROLS,
  });

  const [lastAction, setLastAction] = useState("None");

  const [counts, setCounts] = useState<Counts>({
    jump: 0,
    crouch: 0,
    shoot: 0,
  });

  const [raw, setRaw] = useState({
    alpha: 0,
    beta: 0,
    gamma: 0,
    yawRate: 0,
    pitchRate: 0,
    accX: 0,
    accY: 0,
    accZ: 0,
  });

  const controllerRef = useRef(
    new MotionController("movement")
  );

  const subscriptionRef = useRef<
    ReturnType<typeof DeviceMotion.addListener> | null
  >(null);

  const lastDisplayRef = useRef(0);

  function stopTest() {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;

    setRunning(false);
    setStatus("Stopped");
    setControls({ ...EMPTY_CONTROLS });
  }

  async function startTest() {
    if (running || starting) return;

    setStarting(true);

    try {
      const available =
        await DeviceMotion.isAvailableAsync();

      if (!available) {
        Alert.alert(
          "Sensor Error",
          "DeviceMotion is unavailable on this device."
        );
        return;
      }

      const permission =
        await DeviceMotion.requestPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Permission Denied",
          "Motion sensor permission is required."
        );
        return;
      }

      controllerRef.current =
        new MotionController(role);

      setControls({ ...EMPTY_CONTROLS });
      setLastAction("None");
      setStatus("Calibrating...");
      lastDisplayRef.current = 0;

      DeviceMotion.setUpdateInterval(20);

      subscriptionRef.current =
        DeviceMotion.addListener((reading) => {
          const output =
            controllerRef.current.process(reading);

          // Capture one-time gestures immediately.
          if (output.action !== null) {
            const action = output.action;

            setLastAction(action.toUpperCase());

            setCounts((prev) => ({
              ...prev,
              [action]: prev[action] + 1,
            }));

            console.log("GAME ACTION:", action);
          }

          // Limit UI updates to approximately 10 FPS.
          // Sensor processing still runs at full rate.
          const now = Date.now();

          if (
            now - lastDisplayRef.current >= 100 ||
            output.action !== null
          ) {
            setControls({ ...output });

            setRaw({
              alpha:
                reading.rotation.alpha * 180 / Math.PI,
              beta:
                reading.rotation.beta * 180 / Math.PI,
              gamma:
                reading.rotation.gamma * 180 / Math.PI,
              yawRate:
                reading.rotationRate?.gamma ?? 0,
              pitchRate:
                reading.rotationRate?.beta ?? 0,
              accX:
                reading.acceleration?.x ?? 0,
              accY:
                reading.acceleration?.y ?? 0,
              accZ:
                reading.acceleration?.z ?? 0,
            });

            lastDisplayRef.current = now;
          }
        });

      setRunning(true);
      setStatus("Receiving motion data");
    } catch (error) {
      Alert.alert("Sensor Error", String(error));
      setStatus("Failed to start");
    } finally {
      setStarting(false);
    }
  }

  function recalibrate() {
    controllerRef.current.reset();
    setControls({ ...EMPTY_CONTROLS });
    setLastAction("None");
    setStatus("Recalibrating...");
  }

  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  // Reusable row for readable values.
  function DataRow({
    label,
    value,
  }: {
    label: string;
    value: string;
  }) {
    return (
      <View style={styles.dataRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    );
  }

  function ControlButton({
    title,
    onPress,
    disabled = false,
    active = false,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    active?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.button,
          active && styles.activeButton,
          disabled && styles.disabledButton,
        ]}
      >
        <Text style={styles.buttonText}>
          {title}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>
        Motion Controller Debugger
      </Text>

      <Text style={styles.subtitle}>
        Test your phone's motion-based game controls
      </Text>

      {/* ROLE SELECTION */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Controller Role
        </Text>

        <View style={styles.buttons}>
          <ControlButton
            title="Movement"
            onPress={() => setRole("movement")}
            disabled={running || starting}
            active={role === "movement"}
          />

          <ControlButton
            title="Gunner"
            onPress={() => setRole("gunner")}
            disabled={running || starting}
            active={role === "gunner"}
          />
        </View>

        <DataRow
          label="Current role"
          value={role.toUpperCase()}
        />
      </View>

      {/* CONNECTION STATUS */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Sensor Status
        </Text>

        <DataRow
          label="Status"
          value={status}
        />

        <DataRow
          label="Calibration"
          value={
            controls.ready
              ? "READY"
              : "NOT READY"
          }
        />

        <View style={styles.buttons}>
          <ControlButton
            title="Start"
            onPress={startTest}
            disabled={running || starting}
          />

          <ControlButton
            title="Stop"
            onPress={stopTest}
            disabled={!running}
          />

          <ControlButton
            title="Calibrate"
            onPress={recalibrate}
            disabled={!running}
          />
        </View>
      </View>

      {/* MOVEMENT */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Movement Output
        </Text>

        <DataRow
          label="Move X"
          value={fmt(controls.moveX)}
        />

        <DataRow
          label="Move Y"
          value={fmt(controls.moveY)}
        />

        <DataRow
          label="Sprint"
          value={String(controls.sprint)}
        />

        <DataRow
          label="Crouch"
          value={String(controls.crouch)}
        />
      </View>

      {/* CAMERA */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Camera Output
        </Text>

        <DataRow
          label="Look X"
          value={fmt(controls.lookX)}
        />

        <DataRow
          label="Look Y"
          value={fmt(controls.lookY)}
        />
      </View>

      {/* GESTURES */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Gesture Events
        </Text>

        <Text style={styles.action}>
          {lastAction}
        </Text>

        <DataRow
          label="Jumps"
          value={String(counts.jump)}
        />

        <DataRow
          label="Crouches"
          value={String(counts.crouch)}
        />

        <DataRow
          label="Shots"
          value={String(counts.shoot)}
        />

        <ControlButton
          title="Reset Counters"
          onPress={() => {
            setCounts({
              jump: 0,
              crouch: 0,
              shoot: 0,
            });
            setLastAction("None");
          }}
        />
      </View>

      {/* RAW SENSOR READINGS */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Raw Sensor Values
        </Text>

        <Text style={styles.sectionLabel}>
          Rotation (degrees)
        </Text>

        <DataRow
          label="Alpha"
          value={fmt(raw.alpha)}
        />

        <DataRow
          label="Beta"
          value={fmt(raw.beta)}
        />

        <DataRow
          label="Gamma"
          value={fmt(raw.gamma)}
        />

        <Text style={styles.sectionLabel}>
          Angular Velocity (deg/s)
        </Text>

        <DataRow
          label="Yaw Rate"
          value={fmt(raw.yawRate)}
        />

        <DataRow
          label="Pitch Rate"
          value={fmt(raw.pitchRate)}
        />

        <Text style={styles.sectionLabel}>
          Linear Acceleration (m/s²)
        </Text>

        <DataRow
          label="Acceleration X"
          value={fmt(raw.accX)}
        />

        <DataRow
          label="Acceleration Y"
          value={fmt(raw.accY)}
        />

        <DataRow
          label="Acceleration Z"
          value={fmt(raw.accZ)}
        />
      </View>

      <Text style={styles.footer}>
        Hold your phone still to calibrate.
        Test movement and gunner separately.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#10151F",
  },

  container: {
    padding: 20,
    paddingTop: 55,
    paddingBottom: 60,
    gap: 16,
  },

  title: {
    fontSize: 25,
    fontWeight: "bold",
    color: "#FFFFFF",
  },

  subtitle: {
    fontSize: 14,
    color: "#B8C5D6",
    marginBottom: 8,
  },

  card: {
    backgroundColor: "#1C2635",
    borderRadius: 14,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#344255",
  },

  heading: {
    fontSize: 19,
    fontWeight: "bold",
    color: "#67D9FF",
    marginBottom: 5,
  },

  sectionLabel: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#C5D1E0",
    marginTop: 10,
  },

  dataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },

  label: {
    fontSize: 16,
    color: "#FFFFFF",
    flexShrink: 1,
  },

  value: {
    fontSize: 17,
    color: "#A8E6FF",
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
  },

  action: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFD166",
    textAlign: "center",
    paddingVertical: 10,
  },

  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 8,
  },

  button: {
    backgroundColor: "#34465D",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  activeButton: {
    backgroundColor: "#176B95",
  },

  disabledButton: {
    opacity: 0.4,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
  },

  footer: {
    color: "#B8C5D6",
    fontSize: 13,
    textAlign: "center",
    marginTop: 8,
  },
});
