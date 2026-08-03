import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { ChatMessage } from "../src/protocol.js";

describe("chat", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("broadcasts a chat message to everyone seated, including the sender", async () => {
    const server = await startTestServer({ seed: 1 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({
      type: "join_table",
      roomCode: aliceJoined.roomCode,
      nickname: "Bob",
    });
    await bob.waitForType("joined");
    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    alice.send({ type: "chat_message", text: "hi bob" });

    const aliceSeen = (await alice.waitForType(
      "chat_broadcast",
    )) as unknown as ChatMessage;
    const bobSeen = (await bob.waitForType(
      "chat_broadcast",
    )) as unknown as ChatMessage;

    for (const seen of [aliceSeen, bobSeen]) {
      expect(seen.text).toBe("hi bob");
      expect(seen.playerId).toBe(aliceJoined.playerId);
      expect(seen.nickname).toBe("Alice");
    }
  });

  it("rejects chat from a socket that hasn't joined a table", async () => {
    const server = await startTestServer({ seed: 2 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "chat_message", text: "hello?" });
    const err = await alice.waitForType("error");
    expect(err.code).toBe("not_joined");
  });

  it("rejects a blank message via schema validation", async () => {
    const server = await startTestServer({ seed: 3 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    await alice.waitForType("joined");

    alice.send({ type: "chat_message", text: "   " });
    const err = await alice.waitForType("error");
    expect(err.code).toBe("bad_message");
  });

  it("replays recent chat history to a client that reconnects", async () => {
    const server = await startTestServer({ seed: 4 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({
      type: "join_table",
      roomCode: aliceJoined.roomCode,
      nickname: "Bob",
    });
    const bobJoined = await bob.waitForType("joined");
    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    alice.send({ type: "chat_message", text: "before disconnect" });
    await alice.waitForType("chat_broadcast");
    await bob.waitForType("chat_broadcast");

    bob.close();

    const rejoined = await TestClient.connect(server.url);
    rejoined.send({ type: "rejoin", sessionToken: bobJoined.sessionToken });
    const replayed = (await rejoined.waitForType(
      "chat_broadcast",
    )) as unknown as ChatMessage;
    expect(replayed.text).toBe("before disconnect");
  });
});
