import { z } from "zod";

/**
 * The full wire contract, in one place, validated with zod on every inbound
 * message. This module has zero server-internals imports so the client can
 * import it too — there is exactly one definition of what's legal to send.
 */

const colorSchema = z.enum(["red", "yellow", "green", "blue"]);
const whiteDieSchema = z.enum(["w1", "w2"]);

// ---------- Client -> Server ----------

export const createTableMsg = z.object({
  type: z.literal("create_table"),
  nickname: z.string().trim().min(1).max(20),
});

export const createDailyTableMsg = z.object({
  type: z.literal("create_daily_table"),
  nickname: z.string().trim().min(1).max(20),
});

export const joinTableMsg = z.object({
  type: z.literal("join_table"),
  roomCode: z.string().trim().min(4).max(8),
  nickname: z.string().trim().min(1).max(20),
});

export const rejoinMsg = z.object({
  type: z.literal("rejoin"),
  sessionToken: z.string().uuid(),
});

export const startGameMsg = z.object({
  type: z.literal("start_game"),
});

export const rollDiceMsg = z.object({
  type: z.literal("roll_dice"),
});

export const newGameMsg = z.object({
  type: z.literal("new_game"),
});

export const submitWhiteMsg = z.object({
  type: z.literal("submit_white"),
  action: z.union([
    z.object({
      kind: z.literal("cross"),
      color: colorSchema,
      value: z.number().int(),
    }),
    z.object({ kind: z.literal("pass") }),
  ]),
});

export const submitColorMsg = z.object({
  type: z.literal("submit_color"),
  action: z.union([
    z.object({
      kind: z.literal("cross"),
      whiteDie: whiteDieSchema,
      color: colorSchema,
      value: z.number().int(),
    }),
    z.object({ kind: z.literal("pass") }),
  ]),
});

export const leaveTableMsg = z.object({
  type: z.literal("leave_table"),
});

export const endGameMsg = z.object({
  type: z.literal("end_game"),
});

export const addBotMsg = z.object({
  type: z.literal("add_bot"),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const removeBotMsg = z.object({
  type: z.literal("remove_bot"),
  playerId: z.string(),
});

export const chatMessageMsg = z.object({
  type: z.literal("chat_message"),
  text: z.string().trim().min(1).max(500),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  createTableMsg,
  createDailyTableMsg,
  joinTableMsg,
  rejoinMsg,
  startGameMsg,
  rollDiceMsg,
  newGameMsg,
  submitWhiteMsg,
  submitColorMsg,
  leaveTableMsg,
  endGameMsg,
  addBotMsg,
  removeBotMsg,
  chatMessageMsg,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Derived from the zod union above, so this list can never itself drift from
// ClientMessage -- used by test/protocolSync.test.ts to check it against the
// hand-mirrored list in packages/client/src/net/protocol.ts.
export const CLIENT_MESSAGE_TYPES: string[] = clientMessageSchema.options.map(
  (option) => option.shape.type.value,
);

// ---------- Server -> Client ----------

export interface PublicRowState {
  crossedValues: number[]; // actual die values, in crossing order (not raw indices)
  lastCrossedIndex: number;
  locked: boolean;
  marks: number;
  score: number;
}

export interface PublicSheet {
  playerId: string;
  nickname: string;
  connected: boolean;
  isBot: boolean;
  rows: Record<"red" | "yellow" | "green" | "blue", PublicRowState>;
  penalties: number;
}

export interface PublicResult {
  playerId: string;
  nickname: string;
  total: number;
  penaltyPoints: number;
  rowScores: Record<"red" | "yellow" | "green" | "blue", number>;
  rank: number;
}

/** Response body for GET /api/tables/:roomCode/history (not a WS message). */
export interface GameHistoryResponse {
  roomCode: string;
  createdAt: number; // epoch ms
  results: PublicResult[];
}

export interface DailyLeaderboardEntry {
  rank: number; // 1 = fewest turns; ties share a rank
  nickname: string;
  playerTurns: number;
  playedAt: number; // epoch ms
}

/** Response body for GET /api/daily/:dateKey/leaderboard (not a WS message). */
export interface DailyLeaderboardResponse {
  dateKey: string;
  winners: DailyLeaderboardEntry[];
  totalPlayers: number;
  totalWinners: number;
}

/** Present only on tables created via `create_daily_table`; `result` fills in once the game finishes. */
export interface DailyStatus {
  dateKey: string; // UTC "YYYY-MM-DD" identifying which day's challenge this is
  result: { won: boolean; playerTurns: number } | null;
}

export interface SnapshotMessage {
  type: "snapshot";
  roomCode: string;
  you: string;
  hostPlayerId: string;
  lobbyState: "LOBBY" | "IN_PROGRESS" | "FINISHED";
  phase: "LOBBY" | "ROLLING" | "WHITE" | "COLOR" | "RESOLVE" | "FINISHED";
  activePlayerId: string | null;
  diceInPlay: ("red" | "yellow" | "green" | "blue")[];
  removedColors: ("red" | "yellow" | "green" | "blue")[];
  roll: {
    w1: number;
    w2: number;
    red?: number;
    yellow?: number;
    green?: number;
    blue?: number;
  } | null;
  sheets: PublicSheet[];
  turnSeq: number;
  phaseDeadline: number | null; // epoch ms
  serverNow: number; // epoch ms, for client clock-skew correction
  results: PublicResult[] | null;
  whiteSubmitted: string[]; // playerIds who have answered this WHITE phase
  daily: DailyStatus | null;
}

export interface JoinedMessage {
  type: "joined";
  sessionToken: string;
  roomCode: string;
  playerId: string;
}

export interface EventMessage {
  type: "event";
  text: string;
  at: number;
}

export interface ChatMessage {
  type: "chat_broadcast";
  playerId: string;
  nickname: string;
  text: string;
  at: number;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | SnapshotMessage
  | JoinedMessage
  | EventMessage
  | ChatMessage
  | ErrorMessage;

// Hand-maintained, since ServerMessage isn't zod-validated (the server never
// validates its own outbound messages). Compared against the equivalent list
// in packages/client/src/net/protocol.ts by test/protocolSync.test.ts.
export const SERVER_MESSAGE_TYPES = [
  "snapshot",
  "joined",
  "event",
  "chat_broadcast",
  "error",
] as const;

type AssertNever<T extends never> = T;
// Fails to typecheck if a ServerMessage variant is added without adding it
// to SERVER_MESSAGE_TYPES above.
type _ServerMessageTypesComplete = AssertNever<
  Exclude<ServerMessage["type"], (typeof SERVER_MESSAGE_TYPES)[number]>
>;
