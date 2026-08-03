import type { Color, GameState } from "@quixx/engine";
import { COLORS } from "@quixx/engine";

/** JSON-safe mirror of GameState (Sets -> arrays) for SQLite/wire storage. */
export interface SerializedGameState extends Omit<
  GameState,
  "diceInPlay" | "removedColors"
> {
  diceInPlay: Color[];
  removedColors: Color[];
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    ...state,
    diceInPlay: [...state.diceInPlay],
    removedColors: [...state.removedColors],
  };
}

export function deserializeGameState(
  serialized: SerializedGameState,
): GameState {
  return {
    ...serialized,
    diceInPlay: new Set(
      serialized.diceInPlay.filter((c) => COLORS.includes(c)),
    ),
    removedColors: new Set(
      serialized.removedColors.filter((c) => COLORS.includes(c)),
    ),
  };
}
