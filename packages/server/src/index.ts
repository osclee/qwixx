import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.QUIXX_DB_PATH ?? path.join(process.cwd(), "quixx.sqlite");
// Azure App Service / Container Apps set WEBSITES_PORT or PORT; QUIXX_DB_PATH
// should point at a persistent mount there (local disk is ephemeral across
// restarts/scale events) — see README "Deploying to Azure".
const CLIENT_DIST =
  process.env.QUIXX_CLIENT_DIST ?? path.resolve(fileURLToPath(import.meta.url), "../../../client/dist");
const ROLL_PHASE_MS = process.env.QUIXX_ROLL_PHASE_MS ? Number(process.env.QUIXX_ROLL_PHASE_MS) : undefined;
const WHITE_PHASE_MS = process.env.QUIXX_WHITE_PHASE_MS ? Number(process.env.QUIXX_WHITE_PHASE_MS) : undefined;
const COLOR_PHASE_MS = process.env.QUIXX_COLOR_PHASE_MS ? Number(process.env.QUIXX_COLOR_PHASE_MS) : undefined;

async function main() {
  const { app, store } = await buildApp({
    dbPath: DB_PATH,
    clientDist: CLIENT_DIST,
    logger: true,
    makeTableDeps: () => ({
      ...(ROLL_PHASE_MS !== undefined ? { rollPhaseMs: ROLL_PHASE_MS } : {}),
      ...(WHITE_PHASE_MS !== undefined ? { whitePhaseMs: WHITE_PHASE_MS } : {}),
      ...(COLOR_PHASE_MS !== undefined ? { colorPhaseMs: COLOR_PHASE_MS } : {}),
    }),
  });

  const shutdown = async () => {
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
