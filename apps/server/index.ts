import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";

import {
    protocolVersion,
    type AuthorizedInputMessage,
    type ClientMessage,
    type ControllerAssignment,
    type ControllerRole,
    type DebugClientMessage,
    type DebugRole,
    type DebugServerMessage,
    type EndGameMessage,
    type GameState,
    type LobbyPlayer,
    type MatchStatusMessage,
    type ServerMessage,
    type TeamId,
    type ToControllerMessage,
} from "../../packages/protocol/events.ts";

const port = Number(process.env.PORT ?? 8080);
const publicWsUrl = process.env.PUBLIC_WS_URL?.trim();
const heartbeatIntervalMs = 30_000;
const pairingCodeLength = 6;
// Letters and digits that can't be mistaken for each other (no 0/O, 1/I/L).
const pairingAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const maxPlayersPerLobby = 4;
const maxNameLength = 16;
const maxConnections = 32;
const maxMessageBytes = 65_536;
const maxMessagesPerSecond = 240;
const identifyTimeoutMs = 10_000;
const movementActions = new Set(["jump", "crouch", "sprint"]);
const aimActions = new Set(["shoot", "scope", "weapon", "reload"]);
const sharedActions = new Set(["ready", "interact", "none"]);
// How many slotted, ready phones a match needs before it can start. Default:
// all four slots. Set MIN_CONTROLLERS=1 to test with a single phone.
const minControllers = Math.min(4, Math.max(1, Math.floor(Number(process.env.MIN_CONTROLLERS ?? 4)) || 4));
const controllerSlots: ReadonlyArray<{ teamId: TeamId; role: ControllerRole }> = [
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
    /** Every phone in the lobby, in join order. */
    controllers: Map<string, ControllerConnection>;
};

type ControllerConnection = {
    controllerId: string;
    name: string;
    teamId: TeamId | null;
    role: ControllerRole | null;
    ready: boolean;
    socket: WebSocket;
};

type ClientContext =
    | { kind: "game"; session: Session }
    | { kind: "controller"; session: Session; controller: ControllerConnection };

type HeartbeatSocket = WebSocket & { isAlive?: boolean };

const sessionsByCode = new Map<string, Session>();
const sessionsByGameId = new Map<string, Session>();
const contexts = new Map<WebSocket, ClientContext>();
const gameRouteBySocket = new Map<WebSocket, string>();

// Debug relay: rooms of phones streaming readings to browser viewers.
type DebugRoom = { phones: Set<WebSocket>; viewers: Set<WebSocket> };
const debugRooms = new Map<string, DebugRoom>();
const debugMembers = new Map<WebSocket, { room: string; role: DebugRole }>();
const debugRoomPattern = /^[A-Za-z0-9_-]{1,32}$/;
const maxReadingsPerMessage = 50;

function lanAddresses() {
    return Object.values(networkInterfaces())
        .flat()
        .filter((net) => net && net.family === "IPv4" && !net.internal)
        .map((net) => `ws://${net!.address}:${port}`);
}

function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > maxMessageBytes * 4) {
            socket.close(1013, "Connection is too slow; please reconnect.");
            return;
        }
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
        code = Array.from({ length: pairingCodeLength }, () => pairingAlphabet[randomInt(pairingAlphabet.length)]).join("");
    } while (sessionsByCode.has(code));
    return code;
}

function normalizeCode(code: unknown) {
    return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function cleanName(name: unknown, fallback: string) {
    const text = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, maxNameLength) : "";
    return text || fallback;
}

function slotted(session: Session) {
    return [...session.controllers.values()].filter((c) => c.teamId !== null && c.role !== null);
}

function slotHolder(session: Session, teamId: TeamId, role: ControllerRole) {
    return [...session.controllers.values()].find((c) => c.teamId === teamId && c.role === role);
}

function assignmentsFor(session: Session): ControllerAssignment[] {
    return slotted(session).map((controller) => ({
        controllerId: controller.controllerId,
        teamId: controller.teamId as TeamId,
        role: controller.role as ControllerRole,
        connected: controller.socket.readyState === WebSocket.OPEN,
    }));
}

function playersFor(session: Session): LobbyPlayer[] {
    return [...session.controllers.values()].map((controller) => ({
        controllerId: controller.controllerId,
        name: controller.name,
        teamId: controller.teamId,
        role: controller.role,
        ready: controller.ready,
        connected: controller.socket.readyState === WebSocket.OPEN,
    }));
}

/** Enough slotted phones (all four, or MIN_CONTROLLERS) and every slotted phone ready. */
function isReady(session: Session) {
    const inSlots = slotted(session);
    if (inSlots.length === 0 || !inSlots.every((c) => c.ready)) {
        return false;
    }
    if (minControllers < controllerSlots.length) {
        return inSlots.length >= minControllers;
    }
    return controllerSlots.every(({ teamId, role }) => slotHolder(session, teamId, role));
}

function sendLobbyState(session: Session) {
    if (session.state === "waiting" || session.state === "ready") {
        session.state = isReady(session) ? "ready" : "waiting";
    }

    const message: ServerMessage = {
        type: "lobby_state",
        state: session.state,
        assignments: assignmentsFor(session),
        players: playersFor(session),
        minPlayers: minControllers,
    };

    broadcast(session, message);
}

function registerGame(socket: WebSocket) {
    if (contexts.has(socket)) {
        sendError(socket, "invalid_message", "This connection is already in a lobby.");
        return;
    }
    const session: Session = {
        gameId: gameRouteBySocket.get(socket) ?? `game_${randomUUID()}`,
        pairingCode: createPairingCode(),
        state: "waiting",
        gameSocket: socket,
        controllers: new Map(),
    };

    sessionsByCode.set(session.pairingCode, session);
    sessionsByGameId.set(session.gameId, session);
    contexts.set(socket, { kind: "game", session });

    send(socket, {
        type: "game_registered",
        protocolVersion: protocolVersion,
        gameId: session.gameId,
        pairingCode: session.pairingCode,
        state: session.state,
    });
    sendLobbyState(session);
}

function joinGame(socket: WebSocket, pairingCode: string, requestedRole: ControllerRole | undefined, name: unknown) {
    if (contexts.has(socket)) {
        sendError(socket, "invalid_message", "This connection is already in a lobby.");
        return;
    }

    const session = sessionsByCode.get(normalizeCode(pairingCode));
    if (!session || session.gameSocket.readyState !== WebSocket.OPEN) {
        sendError(socket, "invalid_pairing_code", "That code doesn't match an open lobby. Check the code on the game screen.");
        return;
    }

    if (session.state === "playing" || session.state === "ended") {
        sendError(socket, "game_unavailable", "This match has already started.");
        return;
    }

    if (session.controllers.size >= maxPlayersPerLobby) {
        sendError(socket, "slot_occupied", "This lobby is full.");
        return;
    }

    let slot: { teamId: TeamId; role: ControllerRole } | undefined;
    if (requestedRole) {
        // Older clients: take the first free slot for that role, ready straight away.
        slot = controllerSlots.find(({ teamId, role }) => role === requestedRole && !slotHolder(session, teamId, role));
        if (!slot) {
            sendError(socket, "slot_occupied", `The ${requestedRole} controller slots are occupied.`);
            return;
        }
    }

    const controller: ControllerConnection = {
        controllerId: `controller_${randomUUID()}`,
        name: cleanName(name, `Player ${session.controllers.size + 1}`),
        teamId: slot?.teamId ?? null,
        role: slot?.role ?? null,
        ready: !!slot,
        socket,
    };

    session.controllers.set(controller.controllerId, controller);
    contexts.set(socket, { kind: "controller", session, controller });

    send(socket, { type: "lobby_joined", controllerId: controller.controllerId, pairingCode: session.pairingCode });
    if (slot) {
        sendAssigned(controller);
    }
    sendLobbyState(session);
}

function sendAssigned(controller: ControllerConnection) {
    send(controller.socket, {
        type: "controller_assigned",
        assignment: {
            controllerId: controller.controllerId,
            teamId: controller.teamId as TeamId,
            role: controller.role as ControllerRole,
            connected: true,
        },
    });
}

function controllerContext(socket: WebSocket) {
    const context = contexts.get(socket);
    return context && context.kind === "controller" ? context : null;
}

function hostContext(socket: WebSocket) {
    const context = contexts.get(socket);
    return context && context.kind === "game" ? context : null;
}

function selectSlot(socket: WebSocket, teamId: unknown, role: unknown) {
    const context = controllerContext(socket);
    if (!context) {
        sendError(socket, "invalid_message", "Join a lobby before picking a team.");
        return;
    }
    const { session, controller } = context;
    if (session.state !== "waiting" && session.state !== "ready") {
        sendError(socket, "game_unavailable", "Teams are locked while a match is on.");
        return;
    }
    if ((teamId !== 1 && teamId !== 2) || (role !== "movement" && role !== "aim")) {
        sendError(socket, "invalid_message", "Pick team 1 or 2 and role movement or aim.");
        return;
    }
    const holder = slotHolder(session, teamId, role);
    if (holder && holder !== controller) {
        sendError(socket, "slot_occupied", `${holder.name} already has that spot.`);
        return;
    }
    controller.teamId = teamId;
    controller.role = role;
    controller.ready = false;
    sendAssigned(controller);
    sendLobbyState(session);
}

function setReady(socket: WebSocket, ready: unknown) {
    const context = controllerContext(socket);
    if (!context) {
        sendError(socket, "invalid_message", "Join a lobby first.");
        return;
    }
    const { session, controller } = context;
    if (session.state !== "waiting" && session.state !== "ready") {
        return;
    }
    if (typeof ready !== "boolean") {
        sendError(socket, "invalid_message", "Ready must be true or false.");
        return;
    }
    if (ready === true && (controller.teamId === null || controller.role === null)) {
        sendError(socket, "invalid_message", "Pick a team and role before you ready up.");
        return;
    }
    controller.ready = ready === true;
    sendLobbyState(session);
}

function startGame(socket: WebSocket) {
    const context = hostContext(socket);
    if (!context) {
        sendError(socket, "invalid_message", "Only the game host can start a match.");
        return;
    }

    if (context.session.state !== "waiting" && context.session.state !== "ready") {
        sendError(socket, "game_unavailable", "This match has already started.");
        return;
    }

    if (!isReady(context.session)) {
        sendError(
            socket,
            "game_unavailable",
            minControllers < controllerSlots.length
                ? `At least ${minControllers} controller(s) must pick a spot and ready up first.`
                : "All four spots must be taken and ready first."
        );
        return;
    }

    context.session.state = "playing";
    broadcast(context.session, { type: "broadcast", state: "playing" });
    sendLobbyState(context.session);
}

function relayMatchStatus(socket: WebSocket, message: MatchStatusMessage) {
    const context = hostContext(socket);
    if (!context || context.session.state !== "playing") return;
    if (!Array.isArray(message.scores) || message.scores.length !== 2 || typeof message.timeLeft !== "number") {
        sendError(socket, "invalid_message", "Invalid match_status.");
        return;
    }
    const status: ServerMessage = {
        type: "match_status",
        scores: [Number(message.scores[0]) || 0, Number(message.scores[1]) || 0],
        timeLeft: Math.max(0, message.timeLeft),
        killTarget: Number(message.killTarget) || 0,
    };
    for (const controller of context.session.controllers.values()) {
        send(controller.socket, status);
    }
}

function endGame(socket: WebSocket, message: EndGameMessage) {
    const context = hostContext(socket);
    if (!context) {
        sendError(socket, "invalid_message", "Only the game host can end a match.");
        return;
    }
    const { session } = context;
    if (session.state !== "playing") {
        sendError(socket, "game_unavailable", "There's no match to end.");
        return;
    }
    session.state = "ended";
    const result: ServerMessage = {
        type: "match_ended",
        reason: message.reason === "host" || message.reason === "kills" || message.reason === "time" ? message.reason : undefined,
        winningTeam: message.winningTeam === 1 || message.winningTeam === 2 ? message.winningTeam : null,
        scores: Array.isArray(message.scores) && message.scores.length === 2
            ? [Number(message.scores[0]) || 0, Number(message.scores[1]) || 0]
            : [0, 0],
        stats: Array.isArray(message.stats) ? message.stats.slice(0, 2) : [],
    };
    for (const controller of session.controllers.values()) {
        send(controller.socket, result);
    }
    sendLobbyState(session);
}

function resetLobby(socket: WebSocket) {
    const context = hostContext(socket);
    if (!context) {
        sendError(socket, "invalid_message", "Only the game host can reopen the lobby.");
        return;
    }
    const { session } = context;
    if (session.state === "playing") {
        sendError(socket, "game_unavailable", "End the match before reopening the lobby.");
        return;
    }
    session.state = "waiting";
    for (const controller of session.controllers.values()) {
        controller.ready = false;
    }
    sendLobbyState(session);
}

function broadcast(session: Session, message: ServerMessage) {
    send(session.gameSocket, message);
    for (const controller of session.controllers.values()) {
        send(controller.socket, message);
    }
}

function forwardInput(socket: WebSocket, message: AuthorizedInputMessage) {
    const context = controllerContext(socket);
    if (!context || context.controller.teamId === null) {
        sendError(socket, "invalid_message", "Only a controller with a team and role can send input.");
        return;
    }

    if (context.session.state !== "playing") {
        send(socket, {
            type: "broadcast",
            error: "Input is ignored until the match is playing.",
        });
        return;
    }
    if (!validInput(message, context.controller.role)) {
        sendError(socket, "invalid_message", "Invalid input for this controller role.");
        return;
    }

    send(context.session.gameSocket, {
        ...message,
        sender: context.controller.controllerId,
    });
}

function forwardFeedback(socket: WebSocket, message: ToControllerMessage) {
    const context = hostContext(socket);
    if (!context || typeof message.controllerId !== "string" || !record(message.message) ||
        !["state", "buzz"].includes(String(message.message.t)) || JSON.stringify(message.message).length > 4096) {
        sendError(socket, "invalid_message", "Only a game host may send bounded controller feedback.");
        return;
    }
    const controller = context.session.controllers.get(message.controllerId);
    if (controller) send(controller.socket, { type: "controller_feedback", message: message.message });
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function vector(value: unknown) {
    return record(value) && ["x", "y", "z"].every((key) => finite(value[key]) && Math.abs(value[key]) <= 1_000_000);
}

function rotation(value: unknown) {
    return record(value) && ["alpha", "beta", "gamma"].every((key) => finite(value[key]) && Math.abs(value[key]) <= 1_000_000);
}

function validDebugReading(value: unknown) {
    return record(value) && rotation(value.rotation) && vector(value.accelerationIncludingGravity) &&
        (value.rotationRate == null || rotation(value.rotationRate)) && (value.acceleration == null || vector(value.acceleration));
}

/** Validate data at the network boundary before it reaches the game's physics. */
function validInput(message: AuthorizedInputMessage, role: ControllerRole | null) {
    if (!record(message.payload) || !finite(message.timestamp) || message.timestamp < 0) return false;
    const payload: Record<string, unknown> = message.payload;
    if (message.type === "environment") {
        const action = payload.action;
        const allowed = role === "movement" ? movementActions : aimActions;
        if (typeof action !== "string" || (!allowed.has(action) && !sharedActions.has(action)) || typeof payload.pressed !== "boolean") return false;
        return action !== "weapon" || (Number.isInteger(payload.slot) && [0, 1, 2].includes(payload.slot as number));
    }
    if ("controls" in payload) {
        const controls = payload.controls;
        return record(controls) && ["moveX", "moveY", "lookX", "lookY"].every((key) => finite(controls[key]) && Math.abs(controls[key]) <= 1);
    }
    return vector(payload.accelerometer) && vector(payload.gyroscope);
}

function sendDebug(socket: WebSocket, message: DebugServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > maxMessageBytes * 4) {
            socket.close(1013, "Connection is too slow; please reconnect.");
            return;
        }
        socket.send(JSON.stringify(message));
    }
}

function sendDebugStatus(room: string) {
    const members = debugRooms.get(room);
    if (!members) return;
    const status: DebugServerMessage = {
        type: "debug_status",
        room,
        phones: members.phones.size,
        viewers: members.viewers.size,
    };
    for (const socket of [...members.phones, ...members.viewers]) {
        sendDebug(socket, status);
    }
}

function leaveDebug(socket: WebSocket) {
    const member = debugMembers.get(socket);
    if (!member) return;
    debugMembers.delete(socket);
    const members = debugRooms.get(member.room);
    if (!members) return;
    members.phones.delete(socket);
    members.viewers.delete(socket);
    if (members.phones.size === 0 && members.viewers.size === 0) {
        debugRooms.delete(member.room);
    } else {
        sendDebugStatus(member.room);
    }
}

function joinDebug(socket: WebSocket, room: string, role: DebugRole) {
    if (contexts.has(socket)) {
        sendError(socket, "invalid_message", "A game or controller connection can't join a debug room.");
        return;
    }
    leaveDebug(socket);
    const members = debugRooms.get(room) ?? { phones: new Set(), viewers: new Set() };
    debugRooms.set(room, members);
    (role === "phone" ? members.phones : members.viewers).add(socket);
    debugMembers.set(socket, { room, role });
    sendDebug(socket, { type: "debug_joined", room, role, addresses: lanAddresses() });
    sendDebugStatus(room);
}

function handleDebugMessage(socket: WebSocket, message: DebugClientMessage) {
    if (message.type === "debug_join") {
        if (
            message.protocolVersion !== protocolVersion ||
            typeof message.room !== "string" ||
            !debugRoomPattern.test(message.room) ||
            (message.role !== "phone" && message.role !== "viewer")
        ) {
            sendError(socket, "invalid_message", "Invalid debug_join: room must be 1-32 letters, digits, _ or -, role phone or viewer.");
            return;
        }
        joinDebug(socket, message.room, message.role);
        return;
    }

    const member = debugMembers.get(socket);
    const members = member && debugRooms.get(member.room);
    if (!member || !members) {
        sendError(socket, "invalid_message", "Join a debug room before sending debug messages.");
        return;
    }

    if (message.type === "debug_motion") {
        if (
            member.role !== "phone" ||
            typeof message.platform !== "string" ||
            !Array.isArray(message.readings) ||
            message.readings.length > maxReadingsPerMessage ||
            !message.readings.every(validDebugReading)
        ) {
            sendError(socket, "invalid_message", "Invalid debug_motion: only phones send it, with up to 50 readings.");
            return;
        }
        const relay: DebugServerMessage = {
            type: "debug_motion",
            platform: message.platform,
            readings: message.readings,
        };
        for (const viewer of members.viewers) {
            sendDebug(viewer, relay);
        }
        return;
    }

    if (message.event !== "recalibrate" && message.event !== "reset_counts") {
        sendError(socket, "invalid_message", "Unknown debug event.");
        return;
    }
    for (const other of [...members.phones, ...members.viewers]) {
        if (other !== socket) {
            sendDebug(other, { type: "debug_event", event: message.event });
        }
    }
}

function parseMessage(data: WebSocket.RawData): ClientMessage | DebugClientMessage | null {
    try {
        const message = JSON.parse(data.toString()) as ClientMessage | DebugClientMessage;
        return record(message) && typeof message.type === "string" ? message : null;
    } catch {
        return null;
    }
}

function handleMessage(socket: WebSocket, message: ClientMessage | DebugClientMessage) {
    switch (message.type) {
        case "debug_join":
        case "debug_motion":
        case "debug_event":
            handleDebugMessage(socket, message);
            return;
        case "hello":
            if (debugMembers.has(socket)) {
                sendError(socket, "invalid_message", "Debug connections can't register a game.");
                return;
            }
            if (message.protocolVersion !== protocolVersion || message.clientType !== "game") {
                sendError(socket, "invalid_message", "Only protocol version 1 game hello messages are supported.");
                return;
            }
            registerGame(socket);
            return;
        case "join_game":
            if (debugMembers.has(socket)) {
                sendError(socket, "invalid_message", "Debug connections can't join a game.");
                return;
            }
            if (
                message.protocolVersion !== protocolVersion ||
                typeof message.pairingCode !== "string" ||
                (message.requestedRole !== undefined && !["movement", "aim"].includes(message.requestedRole))
            ) {
                sendError(socket, "invalid_message", "Invalid join request.");
                return;
            }
            joinGame(socket, message.pairingCode, message.requestedRole, message.name);
            return;
        case "select_slot":
            selectSlot(socket, message.teamId, message.role);
            return;
        case "set_ready":
            setReady(socket, message.ready);
            return;
        case "start_game":
            startGame(socket);
            return;
        case "match_status":
            relayMatchStatus(socket, message);
            return;
        case "end_game":
            endGame(socket, message);
            return;
        case "reset_lobby":
            resetLobby(socket);
            return;
        case "to_controller":
            forwardFeedback(socket, message);
            return;
        case "motion":
        case "environment":
            if (debugMembers.has(socket)) {
                sendError(socket, "invalid_message", "Debug connections can't send game input.");
                return;
            }
            forwardInput(socket, message as AuthorizedInputMessage);
            return;
        default:
            sendError(socket, "invalid_message", "Unknown message type.");
    }
}

function disconnect(socket: WebSocket) {
    leaveDebug(socket);
    const context = contexts.get(socket);
    contexts.delete(socket);
    gameRouteBySocket.delete(socket);

    if (!context) return;

    if (context.kind === "game") {
        sessionsByCode.delete(context.session.pairingCode);
        sessionsByGameId.delete(context.session.gameId);
        for (const controller of context.session.controllers.values()) {
            contexts.delete(controller.socket);
            controller.socket.close(1001, "Game host disconnected.");
        }
        return;
    }

    const { session, controller } = context;
    session.controllers.delete(controller.controllerId);
    if (controller.teamId !== null && controller.role !== null) {
        broadcast(session, {
            type: "controller_disconnected",
            controllerId: controller.controllerId,
            teamId: controller.teamId,
            role: controller.role,
        });
    }
    sendLobbyState(session);
}

const httpServer = createServer((_request, response) => {
    response.writeHead(404);
    response.end("WebSocket relay");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes, perMessageDeflate: false });

httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const gameRoute = pathname.match(/^\/games\/([A-Za-z0-9_-]{1,128})$/)?.[1] ?? "";
    if (pathname !== "/" && !gameRoute) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
        if (gameRoute) gameRouteBySocket.set(client, gameRoute);
        wss.emit("connection", client, request);
    });
});

wss.on("connection", (socket) => {
    if (wss.clients.size > maxConnections) {
        socket.close(1013, "Server is busy; please try again.");
        return;
    }
    let windowStart = Date.now();
    let messages = 0;
    const identifyTimer = setTimeout(() => {
        if (!contexts.has(socket) && !debugMembers.has(socket)) socket.close(1008, "Join a lobby or debug room within 10 seconds.");
    }, identifyTimeoutMs);
    identifyTimer.unref();
    const heartbeatSocket = socket as HeartbeatSocket;
    heartbeatSocket.isAlive = true;
    socket.on("pong", () => {
        heartbeatSocket.isAlive = true;
    });
    socket.on("message", (data, isBinary) => {
        if (Date.now() - windowStart >= 1_000) {
            windowStart = Date.now();
            messages = 0;
        }
        if (++messages > maxMessagesPerSecond) {
            socket.close(1008, "Too much input; reconnect and try again.");
            return;
        }
        if (isBinary) {
            socket.close(1003, "Use JSON text messages.");
            return;
        }
        const message = parseMessage(data);
        if (!message) {
            sendError(socket, "invalid_message", "Message must be valid JSON with a type.");
            return;
        }
        handleMessage(socket, message);
    });
    socket.on("close", () => {
        clearTimeout(identifyTimer);
        disconnect(socket);
    });
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
}, heartbeatIntervalMs);

wss.on("close", () => clearInterval(heartbeat));
httpServer.listen(port);

// When the game launches this server, it passes its process id. Exit when
// that process is gone, so a crashed or force-quit game never leaves an
// orphaned server holding the port.
const parentPid = Number(process.env.SKILLISSUE_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 0) {
    setInterval(() => {
        try {
            process.kill(parentPid, 0);
        } catch {
            console.log("The game that launched this server has exited. Shutting down.");
            process.exit(0);
        }
    }, 2000).unref();
}
console.log(`Skill Issue WebSocket server listening on ws://localhost:${port}`);
console.log(`  game routes: /games/<gameId>`);
if (publicWsUrl) {
    console.log(`  public controller endpoint: ${publicWsUrl}`);
}
if (minControllers < controllerSlots.length) {
    console.log(`  matches can start with ${minControllers} controller(s) (MIN_CONTROLLERS)`);
}
for (const address of lanAddresses()) {
    console.log(`  on your network: ${address}`);
}
