# Qwixx

Online multiplayer Qwixx: a browser client (React) talking over WebSocket to
an authoritative Node/Fastify server, with a shared rule engine used by both
sides.

```
packages/
  engine/   @quixx/engine — pure, dependency-free rule engine (rows, legality, scoring, dice)
  server/   @quixx/server — Fastify + WebSocket server, room/session registry, SQLite persistence
  client/   @quixx/client — React + Vite UI
```

## Local development

Requires Node 20+.

```bash
npm install
npm run dev
```

This starts the Fastify server on `:3000` and the Vite dev server on
`:5173` (which proxies `/ws` and `/api` to `:3000`). Open
`http://localhost:5173`.

```bash
npm test        # engine + server test suites
npm run build    # builds engine, server, and client
```

## Architecture notes

- **Game state is authoritative on the server and lives in process
  memory.** Every piece of Qwixx state is public (no hidden information), so
  the server broadcasts one identical snapshot to every player — there's no
  per-player state to reconcile.
- **This means the server must run as a single instance.** There is no
  cross-instance state sharing. Do not autoscale or run multiple replicas
  behind a load balancer without sticky, single-instance routing — a second
  instance would have no idea any tables exist.
- SQLite (`better-sqlite3`) persists a snapshot of each table once per
  completed turn, so an in-progress game survives a process restart. If the
  native module fails to load, the server automatically falls back to an
  in-memory-only store (games won't survive a restart, but the server still
  starts) — see `packages/server/src/store/sqlite.ts`.

### Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `QUIXX_DB_PATH` | `./quixx.sqlite` | SQLite file path — point this at a persistent volume in production |
| `QUIXX_CLIENT_DIST` | `../client/dist` relative to the server build | Directory of the built client to serve as static files |
| `QUIXX_ROLL_PHASE_MS` | `10000` | Time the active player has to roll before it auto-rolls |
| `QUIXX_WHITE_PHASE_MS` | `45000` | White-dice phase timeout before auto-pass |
| `QUIXX_COLOR_PHASE_MS` | `30000` | Color-dice phase timeout before auto-pass |

## Docker

```bash
docker build -t quixx .
docker run -p 3000:3000 -v quixx-data:/data quixx
```

The image is a multi-stage build: it compiles all three packages, then ships
a single runtime image that runs the Fastify server, which also serves the
built client's static files — one process, one port, no separate frontend
host needed. The container writes its SQLite file to `/data`; mount a
volume there for persistence across restarts.

## Deploying to Azure

Because the server is single-instance and stateful, **Azure Container Apps**
is the best fit: it supports WebSockets natively, lets you pin `minReplicas`
and `maxReplicas` to `1` (no accidental scale-out), and can mount a durable
Azure Files share for the SQLite path.

1. **Build and push the image** to Azure Container Registry:

   ```bash
   az acr build --registry <your-acr-name> --image quixx:latest .
   ```

2. **Create a Container Apps environment** (if you don't have one) and a
   storage mount backed by Azure Files, so `/data` survives restarts and
   redeploys:

   ```bash
   az containerapp env storage set \
     --name <env-name> --resource-group <rg> \
     --storage-name quixx-data --azure-file-account-name <storage-account> \
     --azure-file-account-key <storage-key> --azure-file-share-name quixx-data \
     --access-mode ReadWrite
   ```

3. **Deploy the container app**, pinned to a single replica, with the
   volume mounted at `/data` and WebSockets allowed (Container Apps allows
   WebSocket traffic through its ingress by default — no extra flag needed,
   just make sure `--target-port` matches `PORT`):

   ```bash
   az containerapp create \
     --name quixx --resource-group <rg> --environment <env-name> \
     --image <your-acr-name>.azurecr.io/quixx:latest \
     --target-port 3000 --ingress external \
     --min-replicas 1 --max-replicas 1 \
     --env-vars QUIXX_DB_PATH=/data/quixx.sqlite
   ```

   Then attach the volume mount (`az containerapp update` with
   `--set-env-vars` / a YAML revision spec is the more reliable path for
   volume mounts — see the [Container Apps storage docs](https://learn.microsoft.com/azure/container-apps/storage-mounts)
   for the exact `volumes`/`volumeMounts` YAML shape).

### Alternative: Azure App Service (Linux, Node)

App Service works too, with caveats:

- Enable **Web sockets** under Configuration → General settings (off by
  default).
- Set **Always On** so the process doesn't idle out mid-game.
- Do **not** enable autoscale / multiple instances, for the same
  single-instance reason as above.
- App Service's `/home` directory is persistent and shared across restarts
  on the same plan — point `QUIXX_DB_PATH` at a path under `/home` (e.g.
  `/home/data/quixx.sqlite`) rather than the container's ephemeral local
  disk.
- Deploy via the container (`az webapp create --deployment-container-image-name ...`)
  pointing at the same image built for Container Apps above, or via
  `az webapp up` from source if you'd rather let App Service build it (in
  which case set `WEBSITES_PORT=3000` so it knows where the server listens).
