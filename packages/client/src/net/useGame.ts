import { useSyncExternalStore } from "react";
import { GameConnection } from "./socket";

let singleton: GameConnection | null = null;

function getConnection(): GameConnection {
  if (!singleton) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    singleton = new GameConnection(`${proto}//${location.host}/ws`);
    singleton.connect();
  }
  return singleton;
}

export function useGame() {
  const conn = getConnection();
  const state = useSyncExternalStore(
    (listener) => conn.subscribe(listener),
    () => conn.getState(),
  );
  return { conn, state };
}
