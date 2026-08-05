import { useState } from "react";
import { useGame } from "./net/useGame";
import { useLocalGame } from "./local/useLocalGame";
import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { Table } from "./components/Table";
import { LocalSetup } from "./components/LocalSetup";
import { LocalTable } from "./components/LocalTable";

export default function App() {
  const { conn, state } = useGame();
  const { store: localStore, snapshot: localSnapshot } = useLocalGame();
  const [localSetupOpen, setLocalSetupOpen] = useState(false);

  // A local game in progress (or just finished) always takes over the
  // screen, regardless of what's happening on the online connection.
  if (localSnapshot) {
    return (
      <LocalTable
        store={localStore}
        snapshot={localSnapshot}
        onExit={() => {
          localStore.exit();
          setLocalSetupOpen(false);
        }}
      />
    );
  }

  if (localSetupOpen) {
    return (
      <LocalSetup
        onStart={(names) => localStore.start(names)}
        onBack={() => setLocalSetupOpen(false)}
      />
    );
  }

  if (!state.snapshot || !state.playerId) {
    return (
      <Lobby
        conn={conn}
        status={state.status}
        error={state.lastError}
        onPlayLocal={() => setLocalSetupOpen(true)}
      />
    );
  }

  if (state.snapshot.lobbyState === "LOBBY") {
    return (
      <WaitingRoom conn={conn} snapshot={state.snapshot} you={state.playerId} />
    );
  }

  return (
    <Table
      conn={conn}
      snapshot={state.snapshot}
      you={state.playerId}
      events={state.events}
      chatMessages={state.chatMessages}
      status={state.status}
    />
  );
}
