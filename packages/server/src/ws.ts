import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { clientMessageSchema } from "./protocol.js";
import type { TableRegistry } from "./registry.js";
import type { OutSocket, Table } from "./table.js";
import { RateLimiter, type RateLimiterOptions } from "./rateLimiter.js";

// Generous enough for legitimate rapid play (e.g. mashing roll/cross), tight
// enough to blunt a misbehaving or malicious client spamming the socket.
const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  capacity: 20,
  refillPerSecond: 10,
};

// How often the server pings each connection and expects a pong back before
// declaring it dead. There's no built-in dead-peer detection on either side
// of a WebSocket -- a half-open connection (laptop sleep, network handoff,
// an idle-connection reap by a proxy/load balancer in front of the server)
// produces no 'close' event on its own, so a stuck game would otherwise
// require the affected player to notice and refresh manually. Native ping
// frames are answered automatically by the peer's WebSocket implementation
// (per RFC 6455) without any application code on that end, so this alone is
// enough to detect a dead connection from the server's side and unblock any
// phase barrier that was waiting on it (see Table.detachConnection).
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

function socketAdapter(ws: WebSocket): OutSocket {
  return {
    send(data: string) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
  };
}

export interface WebSocketRouteOptions {
  rateLimit?: RateLimiterOptions;
  /** Overridable for tests; defaults to DEFAULT_HEARTBEAT_INTERVAL_MS. */
  heartbeatIntervalMs?: number;
}

export function registerWebSocketRoute(
  app: FastifyInstance,
  registry: TableRegistry,
  opts: WebSocketRouteOptions = {},
): void {
  const rateLimitOpts = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const heartbeatIntervalMs =
    opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  app.get("/ws", { websocket: true }, (ws: WebSocket) => {
    let boundTable: Table | null = null;
    let boundPlayerId: string | null = null;
    // One adapter per connection, created up front rather than per bind, so
    // it doubles as this socket's identity in the table's connection map —
    // that's what lets Table.detachConnection tell "the socket that is
    // currently attached just closed" apart from "a socket this player
    // already replaced by reconnecting just closed".
    const out = socketAdapter(ws);
    const limiter = new RateLimiter(rateLimitOpts);

    // Native ping/pong for server-side dead-peer detection, plus an
    // application-level "ping" message on the same tick so the client can
    // detect a dead connection on *its* side too (browsers auto-answer
    // native ping frames without exposing that to page JS, so the client
    // has no way to observe those directly -- see net/socket.ts).
    let isAlive = true;
    ws.on("pong", () => {
      isAlive = true;
    });
    const heartbeat = setInterval(() => {
      if (!isAlive) {
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, heartbeatIntervalMs);
    heartbeat.unref?.();
    ws.on("close", () => clearInterval(heartbeat));

    const bind = (table: Table, playerId: string) => {
      // Rebinding this socket to a *different* seat (e.g. leaving a table and
      // creating a new one on the same connection) would otherwise leave the
      // old seat marked connected against a socket that will never be
      // detached from it — its close handler only ever detaches the last
      // binding. Rebinding to the same seat is just a repeat rejoin and must
      // not detach: that would flip the seat absent and re-trip the phase
      // barriers on a player who never went anywhere.
      if (
        boundTable &&
        boundPlayerId &&
        (boundTable !== table || boundPlayerId !== playerId)
      ) {
        boundTable.detachConnection(boundPlayerId, out);
      }
      boundTable = table;
      boundPlayerId = playerId;
      table.attachConnection(playerId, out);
    };

    ws.on("message", (raw: Buffer | string) => {
      if (!limiter.tryConsume()) {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "rate_limited",
            message: "Too many messages, slow down",
          }),
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "bad_json",
            message: "Malformed JSON",
          }),
        );
        return;
      }

      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "bad_message",
            message: result.error.issues[0]?.message ?? "Invalid message",
          }),
        );
        return;
      }
      const msg = result.data;

      switch (msg.type) {
        case "create_table": {
          const { table, sessionToken, playerId } = registry.createTable(
            msg.nickname,
          );
          bind(table, playerId);
          ws.send(
            JSON.stringify({
              type: "joined",
              sessionToken,
              roomCode: table.roomCode,
              playerId,
            }),
          );
          break;
        }
        case "create_daily_table": {
          const { table, sessionToken, playerId } =
            registry.createDailyTable(msg.nickname);
          bind(table, playerId);
          ws.send(
            JSON.stringify({
              type: "joined",
              sessionToken,
              roomCode: table.roomCode,
              playerId,
            }),
          );
          break;
        }
        case "join_table": {
          const res = registry.joinTable(msg.roomCode, msg.nickname);
          if (!res.ok) {
            ws.send(
              JSON.stringify({
                type: "error",
                code: "join_failed",
                message: res.error,
              }),
            );
            return;
          }
          bind(res.table, res.playerId);
          ws.send(
            JSON.stringify({
              type: "joined",
              sessionToken: res.sessionToken,
              roomCode: res.table.roomCode,
              playerId: res.playerId,
            }),
          );
          break;
        }
        case "rejoin": {
          const res = registry.rejoin(msg.sessionToken);
          if (!res.ok) {
            ws.send(
              JSON.stringify({
                type: "error",
                code: "rejoin_failed",
                message: res.error,
              }),
            );
            return;
          }
          bind(res.table, res.playerId);
          ws.send(
            JSON.stringify({
              type: "joined",
              sessionToken: msg.sessionToken,
              roomCode: res.roomCode,
              playerId: res.playerId,
            }),
          );
          break;
        }
        case "start_game": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.startGame(boundPlayerId);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "start_failed", res.error);
          break;
        }
        case "roll_dice": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.submitRoll(boundPlayerId);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "roll_failed", res.error);
          break;
        }
        case "new_game": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.newGame(boundPlayerId);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "new_game_failed", res.error);
          break;
        }
        case "submit_white": {
          if (!boundTable || !boundPlayerId) return unbound();
          const action =
            msg.action.kind === "cross"
              ? ({
                  kind: "cross",
                  color: msg.action.color,
                  value: msg.action.value,
                } as const)
              : ({ kind: "pass" } as const);
          const res = boundTable.submitWhite(boundPlayerId, action);
          if (!res.ok)
            boundTable.sendError(
              boundPlayerId,
              "submit_white_failed",
              res.error,
            );
          break;
        }
        case "submit_color": {
          if (!boundTable || !boundPlayerId) return unbound();
          const action =
            msg.action.kind === "cross"
              ? ({
                  kind: "cross",
                  whiteDie: msg.action.whiteDie,
                  color: msg.action.color,
                  value: msg.action.value,
                } as const)
              : ({ kind: "pass" } as const);
          const res = boundTable.submitColor(boundPlayerId, action);
          if (!res.ok)
            boundTable.sendError(
              boundPlayerId,
              "submit_color_failed",
              res.error,
            );
          break;
        }
        case "leave_table": {
          if (!boundTable || !boundPlayerId) return unbound();
          boundTable.leaveLobby(boundPlayerId);
          boundTable.detachConnection(boundPlayerId, out);
          boundTable = null;
          boundPlayerId = null;
          break;
        }
        case "end_game": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.endGame(boundPlayerId);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "end_game_failed", res.error);
          break;
        }
        case "add_bot": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.addBotSeat(boundPlayerId, msg.difficulty);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "add_bot_failed", res.error);
          break;
        }
        case "remove_bot": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.removeBotSeat(boundPlayerId, msg.playerId);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "remove_bot_failed", res.error);
          break;
        }
        case "chat_message": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.sendChat(boundPlayerId, msg.text);
          if (!res.ok)
            boundTable.sendError(boundPlayerId, "chat_failed", res.error);
          break;
        }
      }

      function unbound() {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "not_joined",
            message: "Join or rejoin a table first",
          }),
        );
      }
    });

    ws.on("close", () => {
      // Pass `out` so a socket that's already been superseded by the same
      // player reconnecting closes quietly instead of detaching its
      // replacement (see Table.detachConnection).
      if (boundTable && boundPlayerId)
        boundTable.detachConnection(boundPlayerId, out);
    });
  });
}
