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

export type MotionReading = {
    accelerometer: MotionVector;
    gyroscope: MotionVector;
    arPosition: MotionVector;
    arOrientation: MotionVector;
    trackingStatus: "tracking" | "limited" | "unavailable";
};

export type EnvironmentAction =
    | "ready"
    | "jump"
    | "crouch"
    | "sprint"
    | "shoot"
    | "reload"
    | "interact"
    | "none";

export type HelloMessage = {
    type: "hello";
    protocolVersion: typeof protocolVersion;
    clientType: ClientType;
};

export type JoinGameMessage = {
    type: "join_game";
    protocolVersion: typeof protocolVersion;
    pairingCode: string;
    requestedRole: ControllerRole;
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
    };
};

export type ClientMessage =
    | HelloMessage
    | JoinGameMessage
    | StartGameMessage
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
    assignments: ControllerAssignment[];
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
    | GameRegisteredMessage
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
