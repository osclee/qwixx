import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WebSocket rate limiting", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("drops excess messages from a burst but keeps the connection open", async () => {
    const server = await startTestServer({
      seed: 1,
      rateLimit: { capacity: 3, refillPerSecond: 1 },
    });
    close = server.close;

    const alice = await TestClient.connect(server.url);

    // None of these are valid message shapes, so a rejection can only come
    // from the rate limiter or from schema validation — not table logic.
    for (let i = 0; i < 10; i++) {
      alice.send({ type: "not_a_real_message" });
    }

    const errors = [];
    for (let i = 0; i < 10; i++) {
      errors.push(await alice.waitForType("error"));
    }

    const rateLimited = errors.filter((e) => e.code === "rate_limited");
    const validated = errors.filter((e) => e.code === "bad_message");
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(validated.length).toBeGreaterThan(0);
    expect(validated.length).toBeLessThanOrEqual(3);

    // Give the bucket a moment to refill, then confirm the connection still works.
    await sleep(1100);
    alice.send({ type: "create_table", nickname: "Alice" });
    const joined = await alice.waitForType("joined");
    expect(joined.roomCode).toBeDefined();

    alice.close();
  });

  it("does not throttle normal-paced play", async () => {
    const server = await startTestServer({ seed: 2 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const joined = await alice.waitForType("joined");
    expect(joined.roomCode).toBeDefined();

    alice.close();
  });
});
