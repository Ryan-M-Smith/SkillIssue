import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

import {
    PROTOCOL_VERSION,
    type AuthorizedInputMessage,
    type ClientMessage,
    type ControllerAssignment,
    type ControllerRole,
    type GameState,
    type ServerMessage,
    type TeamId,
} from "../../packages/protocol/events.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HEARTBEAT_INTERVAL_MS = 30_000;
const PAIRING_CODE_LENGTH = 6;
const CONTROLLER_SLOTS: ReadonlyArray<{ teamId: TeamId; role: ControllerRole }> = [
    { teamId: 1, role: "movement" },
    { teamId: 1, role: "aim" },
    { teamId: 2, role: "movement" },
    { teamId: 2, role: "aim" },
];

type Session = {
    gameId: string;
    pairingCode: string;
    state: GameState;
    gameSocket: WebSocket;
    controllers: Map<string, ControllerConnection>;
};

type ControllerConnection = {
    controllerId: string;
    teamId: TeamId;
    role: ControllerRole;
    socket: WebSocket;
};

type ClientContext =
    | { kind: "game"; session: Session }
    | { kind: "controller"; session: Session; controller: ControllerConnection };

type HeartbeatSocket = WebSocket & { isAlive?: boolean };

const sessionsByCode = new Map<string, Session>();
const contexts = new Map<WebSocket, ClientContext>();

function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function sendError(
    socket: WebSocket,
    code: "invalid_pairing_code" | "slot_occupied" | "game_unavailable" | "invalid_message",
    message: string
) {
    send(socket, { type: "join_rejected", code, message });
}

function createPairingCode() {
    let code = "";
    do {
        code = Math.floor(Math.random() * 10 ** PAIRING_CODE_LENGTH)
            .toString()
            .padStart(PAIRING_CODE_LENGTH, "0");
    } while (sessionsByCode.has(code));
    return code;
}

function assignmentsFor(session: Session): ControllerAssignment[] {
    return [...session.controllers.values()].map((controller) => ({
        controllerId: controller.controllerId,
        teamId: controller.teamId,
        role: controller.role,
        connected: controller.socket.readyState === WebSocket.OPEN,
    }));
}

function isReady(session: Session) {
    return CONTROLLER_SLOTS.every(({ teamId, role }) =>
        [...session.controllers.values()].some(
            (controller) => controller.teamId === teamId && controller.role === role
        )
    );
}

function sendLobbyState(session: Session) {
    const state: GameState = session.state === "playing"
        ? "playing"
        : isReady(session)
            ? "ready"
            : "waiting";

    if (session.state !== "playing") {
        session.state = state;
    }

    const message: ServerMessage = {
        type: "lobby_state",
        state: session.state,
        assignments: assignmentsFor(session),
    };

    send(session.gameSocket, message);
    for (const controller of session.controllers.values()) {
        send(controller.socket, message);
    }
}

function registerGame(socket: WebSocket) {
    const session: Session = {
        gameId: `game_${randomUUID()}`,
        pairingCode: createPairingCode(),
        state: "waiting",
        gameSocket: socket,
        controllers: new Map(),
    };

    sessionsByCode.set(session.pairingCode, session);
    contexts.set(socket, { kind: "game", session });

    send(socket, {
        type: "game_registered",
        protocolVersion: PROTOCOL_VERSION,
        gameId: session.gameId,
        pairingCode: session.pairingCode,
        state: session.state,
    });
    sendLobbyState(session);
}

function joinGame(socket: WebSocket, pairingCode: string, requestedRole: ControllerRole) {
    const session = sessionsByCode.get(pairingCode);
    if (!session || session.gameSocket.readyState !== WebSocket.OPEN) {
        sendError(socket, "invalid_pairing_code", "The pairing code is invalid or expired.");
        return;
    }

    if (session.state === "playing" || session.state === "ended") {
        sendError(socket, "game_unavailable", "This game is no longer accepting controllers.");
        return;
    }

    const slot = CONTROLLER_SLOTS.find(({ teamId, role }) =>
        role === requestedRole && ![...session.controllers.values()].some(
            (controller) => controller.teamId === teamId && controller.role === role
        )
    );

    if (!slot) {
        sendError(socket, "slot_occupied", `The ${requestedRole} controller slots are occupied.`);
        return;
    }

    const controller: ControllerConnection = {
        controllerId: `controller_${randomUUID()}`,
        teamId: slot.teamId,
        role: slot.role,
        socket,
    };

    session.controllers.set(controller.controllerId, controller);
    contexts.set(socket, { kind: "controller", session, controller });

    send(socket, {
        type: "controller_assigned",
        assignment: {
            controllerId: controller.controllerId,
            teamId: controller.teamId,
            role: controller.role,
            connected: true,
        },
    });
    sendLobbyState(session);
}

function startGame(socket: WebSocket) {
    const context = contexts.get(socket);
    if (!context || context.kind !== "game") {
        sendError(socket, "invalid_message", "Only the game host can start a match.");
        return;
    }

    if (!isReady(context.session)) {
        sendError(socket, "game_unavailable", "All four controller slots must be connected first.");
        return;
    }

    context.session.state = "playing";
    broadcast(context.session, { type: "broadcast", state: "playing" });
    sendLobbyState(context.session);
}

function broadcast(session: Session, message: ServerMessage) {
    send(session.gameSocket, message);
    for (const controller of session.controllers.values()) {
        send(controller.socket, message);
    }
}

function forwardInput(socket: WebSocket, message: AuthorizedInputMessage) {
    const context = contexts.get(socket);
    if (!context || context.kind !== "controller") {
        sendError(socket, "invalid_message", "Only an assigned controller can send input.");
        return;
    }

    if (context.session.state !== "playing") {
        send(socket, {
            type: "broadcast",
            error: "Input is ignored until the match is playing.",
        });
        return;
    }

    send(context.session.gameSocket, {
        ...message,
        sender: context.controller.controllerId,
    });
}

function parseMessage(data: WebSocket.RawData): ClientMessage | null {
    try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        return message && typeof message.type === "string" ? message : null;
    } catch {
        return null;
    }
}

function handleMessage(socket: WebSocket, message: ClientMessage) {
    switch (message.type) {
        case "hello":
            if (message.protocolVersion !== PROTOCOL_VERSION || message.clientType !== "game") {
                sendError(socket, "invalid_message", "Only protocol version 1 game hello messages are supported.");
                return;
            }
            registerGame(socket);
            return;
        case "join_game":
            if (message.protocolVersion !== PROTOCOL_VERSION || !["movement", "aim"].includes(message.requestedRole)) {
                sendError(socket, "invalid_message", "Invalid join request.");
                return;
            }
            joinGame(socket, message.pairingCode, message.requestedRole);
            return;
        case "start_game":
            startGame(socket);
            return;
        case "motion":
        case "environment":
            forwardInput(socket, message as AuthorizedInputMessage);
            return;
        default:
            sendError(socket, "invalid_message", "Unknown message type.");
    }
}

function disconnect(socket: WebSocket) {
    const context = contexts.get(socket);
    contexts.delete(socket);

    if (!context) return;

    if (context.kind === "game") {
        sessionsByCode.delete(context.session.pairingCode);
        for (const controller of context.session.controllers.values()) {
            contexts.delete(controller.socket);
            controller.socket.close(1001, "Game host disconnected.");
        }
        return;
    }

    const { session, controller } = context;
    session.controllers.delete(controller.controllerId);
    broadcast(session, {
        type: "controller_disconnected",
        controllerId: controller.controllerId,
        teamId: controller.teamId,
        role: controller.role,
    });
    sendLobbyState(session);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
    const heartbeatSocket = socket as HeartbeatSocket;
    heartbeatSocket.isAlive = true;
    socket.on("pong", () => {
        heartbeatSocket.isAlive = true;
    });
    socket.on("message", (data) => {
        const message = parseMessage(data);
        if (!message) {
            sendError(socket, "invalid_message", "Message must be valid JSON with a type.");
            return;
        }
        handleMessage(socket, message);
    });
    socket.on("close", () => disconnect(socket));
    socket.on("error", () => disconnect(socket));
});

const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
        const heartbeatSocket = socket as HeartbeatSocket;
        if (heartbeatSocket.isAlive === false) {
            socket.terminate();
            continue;
        }
        heartbeatSocket.isAlive = false;
        socket.ping();
    }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));
console.log(`SkillIssue WebSocket server listening on ws://localhost:${PORT}`);
