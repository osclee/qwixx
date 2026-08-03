import { useState } from "react";
import type { ChatMessage } from "../net/protocol";
import type { GameConnection } from "../net/socket";

const MAX_CHAT_LENGTH = 500;

interface ChatPanelProps {
  conn: GameConnection;
  messages: ChatMessage[];
  you: string;
}

export function ChatPanel({ conn, messages, you }: ChatPanelProps) {
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    conn.sendChat(trimmed);
    setText("");
  }

  return (
    <div className="chat-panel">
      <h3>Chat</h3>
      <ul className="chat-panel__messages">
        {messages.map((m, i) => (
          <li
            key={`${m.at}-${i}`}
            className={
              m.playerId === you
                ? "chat-panel__message chat-panel__message--own"
                : "chat-panel__message"
            }
          >
            <span className="chat-panel__nickname">{m.nickname}</span>{" "}
            {m.text}
          </li>
        ))}
      </ul>
      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something…"
          aria-label="Chat message"
        />
        <button type="submit" className="btn btn--small">
          Send
        </button>
      </form>
    </div>
  );
}
