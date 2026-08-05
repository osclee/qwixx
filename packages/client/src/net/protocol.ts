/**
 * Mirrors packages/server/src/protocol.ts (Server -> Client shapes, plus
 * the Client -> Server message literals this client actually sends). Kept
 * as plain types (no zod) since the client only needs to construct/consume
 * these, not validate arbitrary input — the server is the sole validator.
 * If the server's protocol.ts changes shape, update this file to match.
 */

export type Color = "red" | "yellow" | "green" | "blue";
export type WhiteDie = "w1" | "w2";
export type Phase =
  "LOBBY" | "ROLLING" | "WHITE" | "COLOR" | "RESOLVE" | "FINISHED";
export type LobbyState = "LOBBY" | "IN_PROGRESS" | "FINISHED";

export interface PublicRowState {
  crossedValues: number[];
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
  rows: Record<Color, PublicRowState>;
  penalties: number;
}

export interface PublicResult {
  playerId: string;
  nickname: string;
  total: number;
  penaltyPoints: number;
  rowScores: Record<Color, number>;
  rank: number;
}

/** Response body for GET /api/tables/:roomCode/history (not a WS message). */
export interface GameHistoryResponse {
  roomCode: string;
  createdAt: number; // epoch ms
  results: PublicResult[];
}

/** Present only on tables created via `create_daily_table`; `result` fills in once the game finishes. */
export interface DailyStatus {
  dateKey: string; // UTC "YYYY-MM-DD" identifying which day's challenge this is
  result: { won: boolean; playerTurns: number } | null;
}

export interface DiceRoll {
  w1: number;
  w2: number;
  red?: number;
  yellow?: number;
  green?: number;
  blue?: number;
}

export interface SnapshotMessage {
  type: "snapshot";
  roomCode: string;
  you: string;
  hostPlayerId: string;
  lobbyState: LobbyState;
  phase: Phase;
  activePlayerId: string | null;
  diceInPlay: Color[];
  removedColors: Color[];
  roll: DiceRoll | null;
  sheets: PublicSheet[];
  turnSeq: number;
  phaseDeadline: number | null;
  serverNow: number;
  results: PublicResult[] | null;
  whiteSubmitted: string[];
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

export type WhiteActionInput =
  { kind: "cross"; color: Color; value: number } | { kind: "pass" };
export type ColorActionInput =
  | { kind: "cross"; whiteDie: WhiteDie; color: Color; value: number }
  | { kind: "pass" };

export type BotDifficulty = "easy" | "medium" | "hard";

export type ClientMessage =
  | { type: "create_table"; nickname: string }
  | { type: "create_daily_table"; nickname: string }
  | { type: "join_table"; roomCode: string; nickname: string }
  | { type: "rejoin"; sessionToken: string }
  | { type: "start_game" }
  | { type: "roll_dice" }
  | { type: "new_game" }
  | { type: "submit_white"; action: WhiteActionInput }
  | { type: "submit_color"; action: ColorActionInput }
  | { type: "leave_table" }
  | { type: "end_game" }
  | { type: "add_bot"; difficulty: BotDifficulty }
  | { type: "remove_bot"; playerId: string }
  | { type: "chat_message"; text: string };

// Hand-mirrored message-type inventories, compared against the server's
// packages/server/src/protocol.ts by ../../../server/test/protocolSync.test.ts
// (the server side derives its client-message list straight from its zod
// union, so this file is the only place either list is hand-maintained).
export const CLIENT_MESSAGE_TYPES = [
  "create_table",
  "create_daily_table",
  "join_table",
  "rejoin",
  "start_game",
  "roll_dice",
  "new_game",
  "submit_white",
  "submit_color",
  "leave_table",
  "end_game",
  "add_bot",
  "remove_bot",
  "chat_message",
] as const;

export const SERVER_MESSAGE_TYPES = [
  "snapshot",
  "joined",
  "event",
  "chat_broadcast",
  "error",
] as const;

type AssertNever<T extends never> = T;
// Fails to typecheck if either union above gains a variant that isn't
// reflected in the corresponding array.
type _ClientMessageTypesComplete = AssertNever<
  Exclude<ClientMessage["type"], (typeof CLIENT_MESSAGE_TYPES)[number]>
>;
type _ServerMessageTypesComplete = AssertNever<
  Exclude<ServerMessage["type"], (typeof SERVER_MESSAGE_TYPES)[number]>
>;
