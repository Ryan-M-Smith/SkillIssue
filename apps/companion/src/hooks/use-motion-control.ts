import { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { DeviceMotion } from "expo-sensors";

import { average } from "@/lib/math/sensors";
import { deviceRotationRate } from "@/lib/math/motion";
import { Vector3 } from "@/lib/math/vector3";
import type {
    AveragedMotion,
    Counts,
    RawMotion,
    Role,
} from "@/types/motion";
import {
    emptyControls,
    MotionController,
} from "../service/motion-control-service";

const maxMotionSamples = 10;

function addSample(samples: Vector3[], sample: Vector3): Vector3[] {
    return [...samples, sample].slice(-maxMotionSamples);
}

const emptyCounts: Counts = {
    jump: 0,
    crouch: 0,
    stand: 0,
    sprint: 0,
    shoot: 0,
    reload: 0,
    weapon_next: 0,
    scope: 0,
};

const emptyRaw: RawMotion = {
    alpha: 0,
    beta: 0,
    gamma: 0,
    yawRate: 0,
    pitchRate: 0,
    accX: 0,
    accY: 0,
    accZ: 0,
};

export function useMotionControl(initialRole: Role = "movement") {
    const [role, setRole] = useState<Role>(initialRole);
    const [running, setRunning] = useState(false);
    const [starting, setStarting] = useState(false);
    const [status, setStatus] = useState("Not started");
    const [controls, setControls] = useState({ ...emptyControls });
    const [lastAction, setLastAction] = useState("None");
    const [counts, setCounts] = useState<Counts>({ ...emptyCounts });
    const [raw, setRaw] = useState<RawMotion>({ ...emptyRaw });
    const [averagedMotion, setAveragedMotion] = useState<AveragedMotion>({
        gyro: Vector3.zero(),
        accel: Vector3.zero(),
    });

    const controllerRef = useRef(new MotionController(initialRole, Platform.OS));
    const subscriptionRef = useRef<ReturnType<typeof DeviceMotion.addListener> | null>(null);
    const startGenerationRef = useRef(0);
    const startPendingRef = useRef(false);
    const lastDisplayRef = useRef(0);
    const gyroSamplesRef = useRef<Vector3[]>([]);
    const accelSamplesRef = useRef<Vector3[]>([]);

    function resetSamples() {
        gyroSamplesRef.current = [];
        accelSamplesRef.current = [];
        setAveragedMotion({ gyro: Vector3.zero(), accel: Vector3.zero() });
    }

    function stop() {
        startGenerationRef.current++;
        startPendingRef.current = false;
        subscriptionRef.current?.remove();
        subscriptionRef.current = null;
        setStarting(false);
        resetSamples();
        setRunning(false);
        setStatus("Stopped");
        setControls({ ...emptyControls });
    }

    async function start() {
        if (subscriptionRef.current || startPendingRef.current) return;

        const generation = ++startGenerationRef.current;
        startPendingRef.current = true;
        setStarting(true);

        try {
            // Safari requires the permission request directly after the user's tap.
            const permission = await DeviceMotion.requestPermissionsAsync();
            if (!permission.granted) {
                throw new Error("Motion sensor permission is required.");
            }
            if (!(await DeviceMotion.isAvailableAsync())) {
                throw new Error("DeviceMotion is unavailable on this device.");
            }
            if (generation !== startGenerationRef.current) return;

            controllerRef.current = new MotionController(role, Platform.OS);
            resetSamples();
            setControls({ ...emptyControls });
            setLastAction("None");
            setRaw({ ...emptyRaw });
            setStatus("Calibrating...");
            lastDisplayRef.current = 0;

            DeviceMotion.setUpdateInterval(20);
            subscriptionRef.current = DeviceMotion.addListener((reading) => {
                const output = controllerRef.current.process(reading);

                if (reading.rotationRate) {
                    gyroSamplesRef.current = addSample(
                        gyroSamplesRef.current,
                        new Vector3(
                            reading.rotationRate.alpha,
                            reading.rotationRate.beta,
                            reading.rotationRate.gamma
                        )
                    );
                }

                if (reading.acceleration) {
                    accelSamplesRef.current = addSample(
                        accelSamplesRef.current,
                        new Vector3(
                            reading.acceleration.x,
                            reading.acceleration.y,
                            reading.acceleration.z
                        )
                    );
                }

                if (output.action !== null) {
                    const action = output.action;

                    setLastAction(action.toUpperCase());
                    setCounts((previous) => ({
                        ...previous,
                        [action]: previous[action] + 1,
                    }));
                }

                const now = Date.now();
                if (now - lastDisplayRef.current < 50 && output.action === null) {
                    return;
                }

                setControls({ ...output });
                setAveragedMotion({
                    gyro: average(gyroSamplesRef.current),
                    accel: average(accelSamplesRef.current),
                });
                const rate = reading.rotationRate
                    ? deviceRotationRate(reading.rotationRate, Platform.OS)
                    : null;

                setRaw({
                    alpha: reading.rotation.alpha * 180 / Math.PI,
                    beta: reading.rotation.beta * 180 / Math.PI,
                    gamma: reading.rotation.gamma * 180 / Math.PI,
                    // Gyro about the phone's Y (left/right) and X (pitch) axes.
                    yawRate: rate?.y ?? 0,
                    pitchRate: rate?.x ?? 0,
                    accX: reading.acceleration?.x ?? 0,
                    accY: reading.acceleration?.y ?? 0,
                    accZ: reading.acceleration?.z ?? 0,
                });
                lastDisplayRef.current = now;
            });

            setRunning(true);
            setStatus("Receiving motion data");
        } catch (error) {
            if (generation === startGenerationRef.current) {
                Alert.alert("Sensor Error", String(error));
                setStatus("Failed to start");
            }
        } finally {
            if (generation === startGenerationRef.current) {
                startPendingRef.current = false;
                setStarting(false);
            }
        }
    }

    function recalibrate() {
        controllerRef.current.reset();
        setControls({ ...emptyControls });
        setLastAction("None");
        setStatus("Recalibrating...");
    }

    function resetCounts() {
        setCounts({ ...emptyCounts });
        setLastAction("None");
    }

    useEffect(() => {
        return () => {
            // Every active start has a positive generation; invalidate it at unmount.
            startGenerationRef.current = -1;
            startPendingRef.current = false;
            subscriptionRef.current?.remove();
            subscriptionRef.current = null;
        };
    }, []);

    return {
        role,
        setRole,
        running,
        starting,
        status,
        controls,
        lastAction,
        counts,
        raw,
        averagedMotion,
        start,
        stop,
        recalibrate,
        resetCounts,
    };
}
