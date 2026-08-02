import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { MemoryStore } from "./store/memory.js";
import { tryCreateSqliteStore } from "./store/sqlite.js";
import { TableRegistry } from "./registry.js";
import { registerWebSocketRoute } from "./ws.js";
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
}

export async function buildApp(
  opts: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; registry: TableRegistry; store: GameStore }> {
  const app = Fastify({ logger: opts.logger ?? false });

  const store =
    opts.store ?? (await tryCreateSqliteStore(opts.dbPath ?? path.join(process.cwd(), "quixx.sqlite"))) ?? new MemoryStore();

  const registry = new TableRegistry({
    store,
    makeTableDeps: opts.makeTableDeps ?? (() => ({})),
  });
  registry.restoreFromStore();

  await app.register(fastifyWebsocket);
  registerWebSocketRoute(app, registry);

  app.get("/api/health", async () => ({ ok: true }));

  if (opts.clientDist) {
    const clientDist = opts.clientDist;
    await app.register(fastifyStatic, { root: clientDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
        reply.sendFile("index.html");
      } else {
        reply.code(404).send({ error: "not_found" });
      }
    });
  }

  return { app, registry, store };
}
