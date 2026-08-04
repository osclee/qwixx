import { useSyncExternalStore } from "react";
import { LocalGameStore } from "./localGame";

let singleton: LocalGameStore | null = null;

function getStore(): LocalGameStore {
  if (!singleton) singleton = new LocalGameStore();
  return singleton;
}

export function useLocalGame() {
  const store = getStore();
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  );
  return { store, snapshot };
}
