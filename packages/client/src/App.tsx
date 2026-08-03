import { useGame } from "./net/useGame";
import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { Table } from "./components/Table";

export default function App() {
  const { conn, state } = useGame();

  if (!state.snapshot || !state.playerId) {
    return <Lobby conn={conn} status={state.status} error={state.lastError} />;
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
    />
  );
}
