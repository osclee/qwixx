import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GameHistory } from "./components/GameHistory";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// No client-side router: the game itself has no URL-addressable state (see
// CLAUDE.md), but the read-only history page is a plain GET, so it gets a
// static path checked once at boot rather than pulling in a router just for
// this one route.
const historyMatch = window.location.pathname.match(
  /^\/history\/([A-Za-z0-9]+)\/?$/,
);

const historyRoomCode = historyMatch?.[1];

createRoot(root).render(
  <StrictMode>
    {historyRoomCode ? (
      <GameHistory roomCode={historyRoomCode} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
