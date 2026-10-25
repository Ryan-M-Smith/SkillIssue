export const protocolVersion = 1 as const;

export type ClientType = "game" | "movement" | "aim";
export type ControllerRole = "movement" | "aim";
export type TeamId = 1 | 2;
export type GameState = "waiting" | "ready" | "playing" | "paused" | "ended";

export type MotionVector = {
    x: number;
    y: number;
    z: number;
};

/** Movement/aim the phone's own motion model computed, each -1..1. */
export type MotionControls = {
    moveX: number;
    moveY: number;
    lookX: number;
    lookY: number;
    /**
     * Gunner: degrees the phone turned since its previous motion message (+ = right / up).
     * When present the game turns the camera by exactly this, instead of by the lookX/lookY rate.
     */
    lookDX?: number;
    lookDY?: number;
};

export type MotionReading = {
    accelerometer: MotionVector;
    gyroscope: MotionVector;
    arPosition: MotionVector;
    arOrientation: MotionVector;
    trackingStatus: "tracking" | "limited" | "unavailable";
    /** When present, the game uses these instead of interpreting the raw fields. */
    controls?: MotionControls;
};

export type EnvironmentAction =
    | "ready"
    | "jump"
    | "crouch"
    | "sprint"
    | "shoot"
    | "scope"
    | "weapon"
    | "reload"
    | "interact"
    | "none";

export type HelloMessage = {
    type: "hello";
    protocolVersion: typeof protocolVersion;
    clientType: ClientType;
    /** Game host: phones this lobby needs to start (1-4). Defaults to the server's setting. */
    minPlayers?: number;
};

/** Game host: change how many ready phones the lobby needs to start (1-4). */
export type SetMinPlayersMessage = {
    type: "set_min_players";
    minPlayers: number;
};

/**
 * A phone joins a lobby with its 6-character code (letters and digits,
 * case-insensitive). Without `requestedRole` it joins unassigned and picks a
 * team and role with `select_slot`; with it, the server picks the first free
 * slot for that role (older clients).
 */
export type JoinGameMessage = {
    type: "join_game";
    protocolVersion: typeof protocolVersion;
    pairingCode: string;
    requestedRole?: ControllerRole;
    /** Shown in the lobby. Up to 16 characters. */
    name?: string;
};

/** Phone: take a team + role slot in the lobby. Clears this phone's ready flag. */
export type SelectSlotMessage = {
    type: "select_slot";
    teamId: TeamId;
    role: ControllerRole;
};

/** Phone: ready (or not) to start. Needs a slot. */
export type SetReadyMessage = {
    type: "set_ready";
    ready: boolean;
};

/** Per-team numbers for the results screen. */
export type TeamStats = {
    teamId: TeamId;
    kills: number;
    deaths: number;
    shots: number;
    hits: number;
    headshots: number;
    /** Metres moved. */
    distance: number;
    jumps: number;
    crouches: number;
    /** Seconds spent sprinting. */
    sprintTime: number;
    /** Highest consecutive kill count before a death in this match. */
    bestStreak?: number;
};

/** Game host -> server -> phones while playing: the live score and clock. */
export type MatchStatusMessage = {
    type: "match_status";
    /** Kills for team 1 and team 2. */
    scores: [number, number];
    /** Seconds left on the clock. */
    timeLeft: number;
    killTarget: number;
};

/** Game host: the match is over. The server moves to "ended" and tells the phones. */
export type EndGameMessage = {
    type: "end_game";
    protocolVersion: typeof protocolVersion;
    /** null = draw. */
    winningTeam: TeamId | null;
    scores: [number, number];
    stats: TeamStats[];
    reason?: "kills" | "time" | "host";
};

/** Game host: back to the lobby with the same code and players (Play Again). */
export type ResetLobbyMessage = {
    type: "reset_lobby";
    protocolVersion: typeof protocolVersion;
};

/** Host-only feedback, routed by the server to one controller in this lobby. */
export type ToControllerMessage = {
    type: "to_controller";
    controllerId: string;
    message: Record<string, unknown>;
};

/** State and hit feedback from the game to its assigned phone. */
export type ControllerFeedbackMessage = {
    type: "controller_feedback";
    message: Record<string, unknown>;
};

export type StartGameMessage = {
    type: "start_game";
    protocolVersion: typeof protocolVersion;
};

export type MotionInputMessage = {
    type: "motion";
    timestamp: number;
    payload: MotionReading;
};

export type EnvironmentInputMessage = {
    type: "environment";
    timestamp: number;
    payload: {
        action: EnvironmentAction;
        pressed: boolean;
        /** For "weapon": 0 pistol, 1 shotgun, 2 sniper. */
        slot?: number;
    };
};

export type ClientMessage =
    | HelloMessage
    | JoinGameMessage
    | SelectSlotMessage
    | SetReadyMessage
    | StartGameMessage
    | MatchStatusMessage
    | EndGameMessage
    | ResetLobbyMessage
    | SetMinPlayersMessage
    | ToControllerMessage
    | MotionInputMessage
    | EnvironmentInputMessage;

export type GameRegisteredMessage = {
    type: "game_registered";
    protocolVersion: typeof protocolVersion;
    gameId: string;
    pairingCode: string;
    state: GameState;
};

export type ControllerAssignment = {
    controllerId: string;
    teamId: TeamId;
    role: ControllerRole;
    connected: boolean;
};

/** One phone in the lobby, with or without a slot yet. */
export type LobbyPlayer = {
    controllerId: string;
    name: string;
    teamId: TeamId | null;
    role: ControllerRole | null;
    ready: boolean;
    connected: boolean;
};

/** Sent to a phone when it enters a lobby. */
export type LobbyJoinedMessage = {
    type: "lobby_joined";
    controllerId: string;
    pairingCode: string;
};

/** Sent to the phones when the host ends the match. */
export type MatchEndedMessage = {
    type: "match_ended";
    winningTeam: TeamId | null;
    scores: [number, number];
    stats: TeamStats[];
    reason?: "kills" | "time" | "host";
};

export type ControllerAssignedMessage = {
    type: "controller_assigned";
    assignment: ControllerAssignment;
};

export type JoinRejectedMessage = {
    type: "join_rejected";
    code: "invalid_pairing_code" | "slot_occupied" | "game_unavailable" | "invalid_message";
    message: string;
};

export type ControllerDisconnectedMessage = {
    type: "controller_disconnected";
    controllerId: string;
    teamId: TeamId;
    role: ControllerRole;
};

export type LobbyStateMessage = {
    type: "lobby_state";
    state: GameState;
    /** Phones that hold a slot (what the game uses to route input). */
    assignments: ControllerAssignment[];
    /** Every phone in the lobby, slotted or not, with names and ready flags. */
    players: LobbyPlayer[];
    /** How many slotted, ready phones it takes to start (4 unless MIN_CONTROLLERS). */
    minPlayers: number;
};

export type BroadcastMessage = {
    type: "broadcast";
    state?: GameState;
    message?: string;
    error?: string;
};

export type AuthorizedInputMessage =
    | (MotionInputMessage & { sender: string })
    | (EnvironmentInputMessage & { sender: string });

export type ServerMessage =
    | ControllerFeedbackMessage
    | GameRegisteredMessage
    | LobbyJoinedMessage
    | MatchStatusMessage
    | MatchEndedMessage
    | ControllerAssignedMessage
    | JoinRejectedMessage
    | ControllerDisconnectedMessage
    | LobbyStateMessage
    | BroadcastMessage
    | AuthorizedInputMessage;

// ---------------------------------------------------------------------------
// Debug relay. Separate from game sessions: no game host, pairing code or
// slots. A companion phone joins a named room and streams its raw
// DeviceMotion readings; browsers in the same room receive them to visualise
// what the phone's motion model sees.

export type DebugRole = "phone" | "viewer";

/** One DeviceMotion reading, as expo-sensors reports it (timestamps in seconds). */
export type DebugMotionReading = {
    rotation: { alpha: number; beta: number; gamma: number; timestamp?: number };
    rotationRate: { alpha: number; beta: number; gamma: number; timestamp?: number } | null;
    acceleration: MotionVector & { timestamp?: number } | null;
    accelerationIncludingGravity: MotionVector & { timestamp?: number };
};

export type DebugJoinMessage = {
    type: "debug_join";
    protocolVersion: typeof protocolVersion;
    room: string;
    role: DebugRole;
};

/** Phone -> server -> viewers. `platform` is the phone's Platform.OS. */
export type DebugMotionMessage = {
    type: "debug_motion";
    platform: string;
    readings: DebugMotionReading[];
};

/** Either side -> everyone else in the room. */
export type DebugEventMessage = {
    type: "debug_event";
    event: "recalibrate" | "reset_counts";
};

export type DebugJoinedMessage = {
    type: "debug_joined";
    room: string;
    role: DebugRole;
    /** ws:// addresses this server can be reached on from the local network. */
    addresses: string[];
};

export type DebugStatusMessage = {
    type: "debug_status";
    room: string;
    phones: number;
    viewers: number;
};

export type DebugClientMessage = DebugJoinMessage | DebugMotionMessage | DebugEventMessage;
export type DebugServerMessage =
    | DebugJoinedMessage
    | DebugStatusMessage
    | DebugMotionMessage
    | DebugEventMessage;
