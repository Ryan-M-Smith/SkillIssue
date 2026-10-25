import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

const colors = {
    card: "#161F32",
    border: "#2A3954",
    text: "#F1F6FF",
    muted: "#99AAC6",
    blue: "#57AAFF",
    green: "#39DBA2",
};

const formatValue = (value: number, places = 1) =>
    Number.isFinite(value) ? value.toFixed(places) : "0";

export function Panel({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <View style={styles.panel}>
            <Text style={styles.panelTitle}>{title}</Text>
            {children}
        </View>
    );
}

export function Axis({
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
    const clampedValue = Math.max(-1, Math.min(1, value));
    const width = `${Math.round(Math.abs(clampedValue) * 100)}%` as `${number}%`;

    return (
        <View style={styles.axis}>
            <View style={styles.line}>
                <Text style={styles.label}>{name}</Text>
                <Text style={styles.value}>
                    {clampedValue >= 0 ? "+" : ""}
                    {formatValue(clampedValue, 2)}
                </Text>
            </View>
            <View style={styles.track}>
                <View style={[styles.fill, { width }]} />
            </View>
            <View style={styles.line}>
                <Text style={styles.hint}>- {negative}</Text>
                <Text style={styles.hint}>+ {positive}</Text>
            </View>
        </View>
    );
}

export function Value({
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
            <Text style={[styles.metricValue, active && styles.activeValue]}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    panel: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 13,
        padding: 15,
        gap: 14,
    },
    panelTitle: {
        color: colors.text,
        fontWeight: "900",
        fontSize: 14,
        letterSpacing: 0.6,
    },
    axis: {
        gap: 7,
    },
    line: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    label: {
        color: "#CBD8ED",
        fontSize: 12,
        fontWeight: "700",
    },
    value: {
        color: colors.text,
        fontSize: 13,
        fontWeight: "900",
    },
    track: {
        height: 10,
        borderRadius: 5,
        backgroundColor: "#34435D",
        overflow: "hidden",
    },
    fill: {
        height: 10,
        backgroundColor: colors.blue,
        borderRadius: 5,
    },
    hint: {
        color: colors.muted,
        fontSize: 11,
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
        color: colors.text,
        fontSize: 17,
        fontWeight: "900",
    },
    activeValue: {
        color: colors.green,
    },
});
