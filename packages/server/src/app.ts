import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { MemoryStore } from "./store/memory.js";
import { tryCreateSqliteStore } from "./store/sqlite.js";
import { TableRegistry } from "./registry.js";
import { registerWebSocketRoute, type WebSocketRouteOptions } from "./ws.js";
import { buildHistoryResponse } from "./history.js";
import type { GameStore } from "./store/index.js";
import type { TableDeps } from "./table.js";

export interface BuildAppOptions {
  /** Provide a store directly (e.g. MemoryStore in tests). Otherwise a sqlite-or-memory store is chosen. */
  store?: GameStore;
  dbPath?: string;
  /** Per-table overrides, e.g. short phase timers and a seeded die for deterministic tests. */
  makeTableDeps?: () => Omit<TableDeps, "store" | "onEmpty">;
  /** Directory of the built client to serve statically. Omit to skip static serving (tests don't need it). */
  clientDist?: string | null;
  logger?: boolean;
  /** Per-connection inbound WS message throttle. Omit for the production default. */
  rateLimit?: WebSocketRouteOptions["rateLimit"];
  /** Per-connection liveness ping interval. Omit for the production default. */
  heartbeatIntervalMs?: WebSocketRouteOptions["heartbeatIntervalMs"];
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  registry: TableRegistry;
  store: GameStore;
}> {
  const app = Fastify({ logger: opts.logger ?? false });

  const store =
    opts.store ??
    (await tryCreateSqliteStore(
      opts.dbPath ?? path.join(process.cwd(), "quixx.sqlite"),
    )) ??
    new MemoryStore();

  const registry = new TableRegistry({
    store,
    makeTableDeps: opts.makeTableDeps ?? (() => ({})),
  });
  registry.restoreFromStore();

  await app.register(fastifyWebsocket);
  registerWebSocketRoute(app, registry, {
    ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    ...(opts.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: opts.heartbeatIntervalMs }
      : {}),
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/tables/:roomCode/history", async (req, reply) => {
    const { roomCode } = req.params as { roomCode: string };
    const history = store.getHistory(roomCode.toUpperCase());
    if (!history) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.send(buildHistoryResponse(history));
  });

  if (opts.clientDist) {
    const clientDist = opts.clientDist;
    await app.register(fastifyStatic, { root: clientDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === "GET" &&
        !req.url.startsWith("/api") &&
        !req.url.startsWith("/ws")
      ) {
        reply.sendFile("index.html");
      } else {
        reply.code(404).send({ error: "not_found" });
      }
    });
  }

  return { app, registry, store };
}
