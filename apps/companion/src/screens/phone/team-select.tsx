import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ControllerRole, LobbyPlayer, LobbyView, TeamId } from "@/service/lobby-client";
import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, teamColor, teamName, teamSolid, ui } from "./theme";

const roles: { role: ControllerRole; label: string; hint: string }[] = [
	{ role: "aim", label: "GUNNER", hint: "Turn to aim · fire, aim, reload buttons" },
	{ role: "movement", label: "RUNNER", hint: "Walk, jump, crouch, sprint" },
];

export function TeamSelect({
	view,
	onPick,
	onReady,
	onLeave,
}: {
	view: LobbyView;
	onPick: (team: TeamId, role: ControllerRole) => void;
	onReady: (ready: boolean) => void;
	onLeave: () => void;
}) {
	const me = view.me;
	const slotted = view.players.filter((p) => p.teamId !== null && p.role !== null);
	const ready = slotted.filter((p) => p.ready).length;
	const need = Math.max(view.minPlayers, slotted.length);
	const starting = view.state === "ready";
	const holder = (team: TeamId, role: ControllerRole) => view.players.find((p) => p.teamId === team && p.role === role);

	return (
		<View style={styles.screen}>
			<SplitBackground />
			<View style={styles.head}>
				<View>
					<Eyebrow>Lobby {view.code}</Eyebrow>
					<Title size={26}>PICK YOUR TEAM AND ROLE</Title>
				</View>
				<SlantButton label="LEAVE" small onPress={onLeave} />
			</View>

			<View style={styles.teams}>
				{([1, 2] as TeamId[]).map((team) => (
					<View key={team} style={[styles.team, { borderColor: teamColor(team), backgroundColor: teamSolid(team, 0.1) }]}>
						<Title size={20} color={teamColor(team)}>TEAM {teamName(team)}</Title>
						{roles.map(({ role, label, hint }) => (
							<Slot
								key={role}
								team={team}
								label={label}
								hint={hint}
								holder={holder(team, role)}
								mine={me?.teamId === team && me?.role === role}
								onPress={() => onPick(team, role)}
							/>
						))}
					</View>
				))}
			</View>

			<View style={styles.foot}>
				<Body size={14} color={view.error ? ui.red : starting ? ui.gold : ui.muted} style={{ flex: 1 }}>
					{view.error ?? (starting ? "Everyone's ready. Match starting…" : `${ready} / ${need} ready`)}
				</Body>
				<SlantButton
					label={me?.ready ? "READY ✓" : "READY UP"}
					color={me?.ready ? ui.ready : undefined}
					primary={!me?.ready}
					disabled={!me?.role}
					onPress={() => onReady(!me?.ready)}
					style={{ minWidth: 170 }}
				/>
			</View>
		</View>
	);
}

function Slot({ team, label, hint, holder, mine, onPress }: { team: TeamId; label: string; hint: string; holder?: LobbyPlayer; mine: boolean; onPress: () => void }) {
	const taken = !!holder && !mine;
	return (
		<Pressable
			onPress={onPress}
			disabled={taken}
			style={({ pressed }) => [
				styles.slot,
				{ backgroundColor: teamSolid(team, pressed ? 0.12 : 0.03) },
				mine && { borderColor: teamColor(team), backgroundColor: teamSolid(team, 0.32) },
			]}
		>
			<View style={{ flex: 1 }}>
				<Eyebrow color={mine ? ui.ink : ui.soft}>{label}</Eyebrow>
				<Text style={[styles.slotName, !holder && { color: ui.soft }, taken && { color: ui.soft }]} numberOfLines={1}>
					{holder ? (mine ? `${holder.name} (you)` : holder.name) : "Tap to take this spot"}
				</Text>
				{!holder && <Body size={12} color={ui.soft}>{hint}</Body>}
			</View>
			{holder && <Text style={[styles.badge, { color: holder.ready ? ui.ready : ui.gold }]}>{holder.ready ? "READY" : "PICKING"}</Text>}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 18, gap: 10 },
	head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
	teams: { flex: 1, flexDirection: "row", gap: 14 },
	team: { flex: 1, borderWidth: 1.5, borderRadius: 10, padding: 10, gap: 8 },
	slot: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: ui.line, borderRadius: 8, padding: 10 },
	slotName: { fontFamily: fonts.displaySemi, fontSize: 18, color: ui.ink },
	badge: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1 },
	foot: { flexDirection: "row", alignItems: "center", gap: 16 },
});
