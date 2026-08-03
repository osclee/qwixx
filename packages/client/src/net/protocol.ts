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

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  SnapshotMessage | JoinedMessage | EventMessage | ErrorMessage;

export type WhiteActionInput =
  { kind: "cross"; color: Color; value: number } | { kind: "pass" };
export type ColorActionInput =
  | { kind: "cross"; whiteDie: WhiteDie; color: Color; value: number }
  | { kind: "pass" };

export type BotDifficulty = "easy" | "medium" | "hard";

export type ClientMessage =
  | { type: "create_table"; nickname: string }
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
  | { type: "remove_bot"; playerId: string };
