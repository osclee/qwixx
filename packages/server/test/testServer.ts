import { seededDie } from "@quixx/engine";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";
import type { GameStore } from "../src/store/index.js";
import type { RateLimiterOptions } from "../src/rateLimiter.js";
import type { AddressInfo } from "node:net";

export interface TestServerOptions {
  seed?: number;
  rollPhaseMs?: number;
  whitePhaseMs?: number;
  colorPhaseMs?: number;
  store?: GameStore;
  botMoveDelayMs?: { min: number; max: number };
  botRandom?: () => number;
  rateLimit?: RateLimiterOptions;
  heartbeatIntervalMs?: number;
}

export async function startTestServer(opts: TestServerOptions = {}) {
  const store = opts.store ?? new MemoryStore();
  const die = seededDie(opts.seed ?? 1);

  const { app, registry } = await buildApp({
    store,
    clientDist: null,
    rateLimit: opts.rateLimit,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    makeTableDeps: () => ({
      rollOne: die,
      // Short by default so existing turn-by-turn tests that don't care
      // about the roll step itself don't need to explicitly send
      // roll_dice — the auto-roll timer fires almost immediately. Tests
      // that specifically exercise the ROLLING phase (roll.test.ts) pass a
      // longer value.
      rollPhaseMs: opts.rollPhaseMs ?? 50,
      whitePhaseMs: opts.whitePhaseMs ?? 60_000,
      colorPhaseMs: opts.colorPhaseMs ?? 60_000,
      // Bots default to a near-instant "thinking" delay so tests don't pay
      // the real ~500-1500ms UX delay; individual tests can override.
      botMoveDelayMs: opts.botMoveDelayMs ?? { min: 0, max: 5 },
      botRandom: opts.botRandom,
    }),
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${address.port}/ws`;

  return {
    app,
    store,
    registry,
    url,
    async close() {
      await app.close();
      store.close();
    },
  };
}
