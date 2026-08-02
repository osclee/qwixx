import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { clientMessageSchema } from "./protocol.js";
import type { TableRegistry } from "./registry.js";
import type { OutSocket, Table } from "./table.js";

function socketAdapter(ws: WebSocket): OutSocket {
  return {
    send(data: string) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
  };
}

export function registerWebSocketRoute(app: FastifyInstance, registry: TableRegistry): void {
  app.get("/ws", { websocket: true }, (ws: WebSocket) => {
    let boundTable: Table | null = null;
    let boundPlayerId: string | null = null;

    const bind = (table: Table, playerId: string) => {
      boundTable = table;
      boundPlayerId = playerId;
      table.attachConnection(playerId, socketAdapter(ws));
    };

    ws.on("message", (raw: Buffer | string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "bad_json", message: "Malformed JSON" }));
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
          const { table, sessionToken, playerId } = registry.createTable(msg.nickname);
          bind(table, playerId);
          ws.send(
            JSON.stringify({ type: "joined", sessionToken, roomCode: table.roomCode, playerId }),
          );
          break;
        }
        case "join_table": {
          const res = registry.joinTable(msg.roomCode, msg.nickname);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: "error", code: "join_failed", message: res.error }));
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
            ws.send(JSON.stringify({ type: "error", code: "rejoin_failed", message: res.error }));
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
          if (!res.ok) boundTable.sendError(boundPlayerId, "start_failed", res.error);
          break;
        }
        case "roll_dice": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.submitRoll(boundPlayerId);
          if (!res.ok) boundTable.sendError(boundPlayerId, "roll_failed", res.error);
          break;
        }
        case "new_game": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.newGame(boundPlayerId);
          if (!res.ok) boundTable.sendError(boundPlayerId, "new_game_failed", res.error);
          break;
        }
        case "submit_white": {
          if (!boundTable || !boundPlayerId) return unbound();
          const action =
            msg.action.kind === "cross"
              ? ({ kind: "cross", color: msg.action.color, value: msg.action.value } as const)
              : ({ kind: "pass" } as const);
          const res = boundTable.submitWhite(boundPlayerId, action);
          if (!res.ok) boundTable.sendError(boundPlayerId, "submit_white_failed", res.error);
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
          if (!res.ok) boundTable.sendError(boundPlayerId, "submit_color_failed", res.error);
          break;
        }
        case "leave_table": {
          if (!boundTable || !boundPlayerId) return unbound();
          boundTable.leaveLobby(boundPlayerId);
          boundTable.detachConnection(boundPlayerId);
          boundTable = null;
          boundPlayerId = null;
          break;
        }
        case "end_game": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.endGame(boundPlayerId);
          if (!res.ok) boundTable.sendError(boundPlayerId, "end_game_failed", res.error);
          break;
        }
        case "add_bot": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.addBotSeat(boundPlayerId, msg.difficulty);
          if (!res.ok) boundTable.sendError(boundPlayerId, "add_bot_failed", res.error);
          break;
        }
        case "remove_bot": {
          if (!boundTable || !boundPlayerId) return unbound();
          const res = boundTable.removeBotSeat(boundPlayerId, msg.playerId);
          if (!res.ok) boundTable.sendError(boundPlayerId, "remove_bot_failed", res.error);
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
      if (boundTable && boundPlayerId) boundTable.detachConnection(boundPlayerId);
    });
  });
}
