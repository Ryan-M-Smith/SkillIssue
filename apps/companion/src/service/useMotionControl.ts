import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { DeviceMotion } from "expo-sensors";

import { average } from "@/lib/math/sensors";
import { Vector3, vec3Zero } from "@/lib/math/vector3";
import {
    EMPTY_CONTROLS,
    MotionController,
    type Action,
    type Role,
} from "./motionControlService";

const MAX_MOTION_SAMPLES = 10;

type Counts = Record<Exclude<Action, null>, number>;

export type RawMotion = {
    alpha: number;
    beta: number;
    gamma: number;
    yawRate: number;
    pitchRate: number;
    accX: number;
    accY: number;
    accZ: number;
};

export type AveragedMotion = {
    gyro: Vector3;
    accel: Vector3;
};

function addSample(samples: Vector3[], sample: Vector3): Vector3[] {
    return [...samples, sample].slice(-MAX_MOTION_SAMPLES);
}

const EMPTY_COUNTS: Counts = {
    jump: 0,
    crouch: 0,
    shoot: 0,
};

const EMPTY_RAW: RawMotion = {
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
    const [controls, setControls] = useState({ ...EMPTY_CONTROLS });
    const [lastAction, setLastAction] = useState("None");
    const [counts, setCounts] = useState<Counts>({ ...EMPTY_COUNTS });
    const [raw, setRaw] = useState<RawMotion>({ ...EMPTY_RAW });
    const [averagedMotion, setAveragedMotion] = useState<AveragedMotion>({
        gyro: vec3Zero,
        accel: vec3Zero,
    });

    const controllerRef = useRef(new MotionController(initialRole));
    const subscriptionRef = useRef<ReturnType<typeof DeviceMotion.addListener> | null>(null);
    const lastDisplayRef = useRef(0);
    const gyroSamplesRef = useRef<Vector3[]>([]);
    const accelSamplesRef = useRef<Vector3[]>([]);

    function resetSamples() {
        gyroSamplesRef.current = [];
        accelSamplesRef.current = [];
        setAveragedMotion({ gyro: vec3Zero, accel: vec3Zero });
    }

    function stop() {
        subscriptionRef.current?.remove();
        subscriptionRef.current = null;
        resetSamples();
        setRunning(false);
        setStatus("Stopped");
        setControls({ ...EMPTY_CONTROLS });
    }

    async function start() {
        if (running || starting) return;

        setStarting(true);

        try {
            if (!(await DeviceMotion.isAvailableAsync())) {
                throw new Error("DeviceMotion is unavailable on this device.");
            }

            const permission = await DeviceMotion.requestPermissionsAsync();
            if (!permission.granted) {
                throw new Error("Motion sensor permission is required.");
            }

            controllerRef.current = new MotionController(role);
            resetSamples();
            setControls({ ...EMPTY_CONTROLS });
            setLastAction("None");
            setRaw({ ...EMPTY_RAW });
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
                if (now - lastDisplayRef.current < 100 && output.action === null) {
                    return;
                }

                setControls({ ...output });
                setAveragedMotion({
                    gyro: average(gyroSamplesRef.current),
                    accel: average(accelSamplesRef.current),
                });
                setRaw({
                    alpha: reading.rotation.alpha * 180 / Math.PI,
                    beta: reading.rotation.beta * 180 / Math.PI,
                    gamma: reading.rotation.gamma * 180 / Math.PI,
                    yawRate: reading.rotationRate?.gamma ?? 0,
                    pitchRate: reading.rotationRate?.beta ?? 0,
                    accX: reading.acceleration?.x ?? 0,
                    accY: reading.acceleration?.y ?? 0,
                    accZ: reading.acceleration?.z ?? 0,
                });
                lastDisplayRef.current = now;
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

    function resetCounts() {
        setCounts({ ...EMPTY_COUNTS });
        setLastAction("None");
    }

    useEffect(() => {
        return () => {
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
