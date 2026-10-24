import { useEffect, useState } from "react";
import {
    Accelerometer,
    AccelerometerMeasurement,
    Gyroscope,
    GyroscopeMeasurement
} from "expo-sensors";
import { Platform, StyleSheet } from "react-native";

import { average } from "@/lib/math/sensors";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Vector3 } from "@/lib/math/vector3";

export default function MotionTest() {
    const [gyro, setGyro] = useState<Vector3[]>([] satisfies Vector3[]);
    const [accel, setAccel] = useState<Vector3[]>([] satisfies Vector3[]);

    useEffect(() => {
        if (Platform.OS === "web") {
            console.warn("Motion sensors are not supported on web.");
            return;
        }
        
        Gyroscope.setUpdateInterval(16);
        Accelerometer.setUpdateInterval(16);

        const gyroSub = Gyroscope.addListener((data: GyroscopeMeasurement) => {
            setGyro((prev) => {
                if (prev.length < 10) {
                    // Keep adding new samples until we reach 10
                    return [...prev, new Vector3(data.x, data.y, data.z)];
                } else {
                    // Remove the oldest sample and add the new one
                    return [...prev.slice(1), new Vector3(data.x, data.y, data.z)];
                }
            });
        });

        const accelSub = Accelerometer.addListener((data: AccelerometerMeasurement) => {
            setAccel((prev) => {
                if (prev.length < 10) {
                    // Keep adding new samples until we reach 10
                    return [...prev, new Vector3(data.x, data.y, data.z)];
                } else {
                    // Remove the oldest sample and add the new one
                    return [...prev.slice(1), new Vector3(data.x, data.y, data.z)];
                }
            });
        });

        return () => {
            gyroSub.remove();
            accelSub.remove();
        };
    }, []);

    return (
        <ThemedView style={styles.container} type="backgroundElement">
            <ThemedText type="subtitle"> Motion data </ThemedText>
            <ThemedText type="code"> Gyro: {average(gyro).format()} </ThemedText>
            <ThemedText type="code"> Accel: {average(accel).format()} </ThemedText>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "stretch",
        gap: 8,
        padding: 16,
        borderRadius: 16,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
    }
});