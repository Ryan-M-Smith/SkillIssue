import {
	ScrollView,
	StyleSheet,
	Text,
	View,
	Pressable,
	Platform
} from "react-native";

import type { AveragedMotion, RawMotion } from "@/types/motion";
import { useMotionControl } from "@/hooks/use-motion-control";

const fmt = (value: number) => value.toFixed(2);

type MotionState = ReturnType<typeof useMotionControl>;

type MotionDebuggerProps = Pick<
    MotionState,
    | "role"
    | "setRole"
    | "running"
    | "starting"
    | "status"
    | "controls"
    | "lastAction"
    | "counts"
    | "raw"
    | "averagedMotion"
    | "start"
    | "stop"
    | "recalibrate"
    | "resetCounts"
>;

function DataRow({ label, value }: { label: string; value: string }) {
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
            <Text style={styles.buttonText}>{title}</Text>
        </Pressable>
    );
}

function RoleCard({ motion }: { motion: MotionDebuggerProps }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading}>Controller Role</Text>
            <View style={styles.buttons}>
                <ControlButton
                    title="Movement"
                    onPress={() => motion.setRole("movement")}
                    disabled={motion.running || motion.starting}
                    active={motion.role === "movement"}
                />
                <ControlButton
                    title="Gunner"
                    onPress={() => motion.setRole("gunner")}
                    disabled={motion.running || motion.starting}
                    active={motion.role === "gunner"}
                />
            </View>
            <DataRow label="Current role" value={motion.role.toUpperCase()} />
        </View>
    );
}

function StatusCard({ motion }: { motion: MotionDebuggerProps }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading}>Sensor Status</Text>
            <DataRow label="Status" value={motion.status} />
            <DataRow
                label="Calibration"
                value={motion.controls.ready ? "READY" : "NOT READY"}
            />
            <View style={styles.buttons}>
                <ControlButton
                    title="Start"
                    onPress={motion.start}
                    disabled={motion.running || motion.starting}
                />
                <ControlButton
                    title="Stop"
                    onPress={motion.stop}
                    disabled={!motion.running}
                />
                <ControlButton
                    title="Calibrate"
                    onPress={motion.recalibrate}
                    disabled={!motion.running}
                />
            </View>
        </View>
    );
}

function OutputCard({ motion }: { motion: MotionDebuggerProps }) {
    return (
        <>
            <View style={styles.card}>
                <Text style={styles.heading}>Movement Output</Text>
                <DataRow label="Move X" value={fmt(motion.controls.moveX)} />
                <DataRow label="Move Y" value={fmt(motion.controls.moveY)} />
                <DataRow label="Sprint" value={String(motion.controls.sprint)} />
                <DataRow label="Crouch" value={String(motion.controls.crouch)} />
            </View>
            <View style={styles.card}>
                <Text style={styles.heading}>Camera Output</Text>
                <DataRow label="Look X" value={fmt(motion.controls.lookX)} />
                <DataRow label="Look Y" value={fmt(motion.controls.lookY)} />
            </View>
        </>
    );
}

function AveragedMotionCard({ motion }: { motion: AveragedMotion }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading}>Sensor Data (Rolling Average)</Text>
            <DataRow label="Gyroscope" value={motion.gyro.format()} />
            <DataRow label="Acceleration" value={motion.accel.format()} />
        </View>
    );
}

function GestureCard({ motion }: { motion: MotionDebuggerProps }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading}>Gesture Events</Text>
            <Text style={styles.action}>{motion.lastAction}</Text>
            <DataRow label="Jumps" value={String(motion.counts.jump)} />
            <DataRow label="Crouches" value={String(motion.counts.crouch)} />
            <DataRow label="Shots" value={String(motion.counts.shoot)} />
            <ControlButton title="Reset Counters" onPress={motion.resetCounts} />
        </View>
    );
}

function RawMotionCard({ raw }: { raw: RawMotion }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading}>Raw Sensor Values</Text>
            <Text style={styles.sectionLabel}>Rotation (degrees)</Text>
            <DataRow label="Alpha" value={fmt(raw.alpha)} />
            <DataRow label="Beta" value={fmt(raw.beta)} />
            <DataRow label="Gamma" value={fmt(raw.gamma)} />
            <Text style={styles.sectionLabel}>Angular Velocity (rad/s)</Text>
            <DataRow label="Yaw Rate" value={fmt(raw.yawRate)} />
            <DataRow label="Pitch Rate" value={fmt(raw.pitchRate)} />
            <Text style={styles.sectionLabel}>Linear Acceleration (m/s2)</Text>
            <DataRow label="Acceleration X" value={fmt(raw.accX)} />
            <DataRow label="Acceleration Y" value={fmt(raw.accY)} />
            <DataRow label="Acceleration Z" value={fmt(raw.accZ)} />
        </View>
    );
}

export default function MotionDebugger(motion: MotionDebuggerProps) {
    return Platform.OS === "web"? (
		<ScrollView style={styles.screen} contentContainerStyle={styles.container}>
			<Text style={styles.title}> Motion Controller Debugger </Text>
			<Text style={styles.subtitle}>
				Motion sensors are not supported on web. Please open this
				app on a mobile device to test motion-based game controls.
			</Text>
		</ScrollView>
	) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
            <Text style={styles.title}> Motion Controller Debugger </Text>
            <Text style={styles.subtitle}> Test your phone's motion-based game controls </Text>
            <RoleCard motion={motion}/>
            <StatusCard motion={motion}/>
            <OutputCard motion={motion}/>
            <AveragedMotionCard motion={motion.averagedMotion}/>
            <GestureCard motion={motion}/>
            <RawMotionCard raw={motion.raw}/>
            <Text style={styles.footer}>
                Hold your phone still to calibrate. Test movement and gunner separately.
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
