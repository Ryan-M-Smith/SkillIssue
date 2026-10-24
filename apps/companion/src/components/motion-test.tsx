import { useEffect, useState } from "react";
import {
    Accelerometer,
    AccelerometerMeasurement,
    Gyroscope,
    GyroscopeMeasurement
} from "expo-sensors";
import { Platform, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Vector3, vec3Zero } from "@/lib/math/vector3";

export default function MotionTest() {
    const [gyro, setGyro] = useState<Vector3>(vec3Zero);
    const [accel, setAccel] = useState<Vector3>(vec3Zero);

    useEffect(() => {
        if (Platform.OS === "web") {
            console.warn("Motion sensors are not supported on web.");
            return;
        }
        
        Gyroscope.setUpdateInterval(16);
        Accelerometer.setUpdateInterval(16);

        const gyroSub = Gyroscope.addListener((data: GyroscopeMeasurement) => {
            setGyro(new Vector3(data.x, data.y, data.z));
        });

        const accelSub = Accelerometer.addListener((data: AccelerometerMeasurement) => {
            setAccel(new Vector3(data.x, data.y, data.z));
        });

        return () => {
            gyroSub.remove();
            accelSub.remove();
        };
    }, []);

    useEffect(() => {
        console.log(`Gyro: ${gyro.format()}`);
        console.log(`Accel: ${accel.format()}`);
    }, [gyro, accel]);

    return (
        <ThemedView style={styles.container} type="backgroundElement">
            <ThemedText type="subtitle">Motion data</ThemedText>
            <ThemedText type="code">Gyro: {gyro.format()}</ThemedText>
            <ThemedText type="code">Accel: {accel.format()}</ThemedText>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "stretch",
        gap: 8,
        padding: 16,
        borderRadius: 16,
    },
});