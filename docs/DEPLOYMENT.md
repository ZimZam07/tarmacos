# Deploying TarmacOS

| | URL | Host |
|---|---|---|
| **Dashboard** (share this) | https://tarmacos-kohl.vercel.app | Vercel, project `tarmacos` (team `zimran2`, Hobby) |
| **Engine + bridge** | https://tarmacos-bridge.onrender.com | Render, service `tarmacos-bridge` (Free, Singapore) |
| Source | https://github.com/ZimZam07/tarmacos (private) | GitHub |

## Architecture

```
 visitor's browser
   │  https://tarmacos-kohl.vercel.app        static files only (HTML/CSS/JS + config.js)
   │──────────────────────────────────────►  VERCEL
   │
   │  https://tarmacos-bridge.onrender.com    POST /api/cmd, /api/sys, /api/engine/restart
   │  (CORS, ?sid=<per-tab id>)               GET  /api/stream (SSE), /api/health
   └──────────────────────────────────────►  RENDER  (Docker, Ubuntu 26.04)
                                               python3 bridge/server.py   (TARMAC_PUBLIC=1)
                                                 ├─ session A → tarmac_engine ─fork→ baggage child
                                                 ├─ session B → tarmac_engine ─fork→ baggage child
                                                 └─ …  (max 12, idle ones stopped)
```

**Why it is split.** The engine is a long-lived Linux process: it keeps the simulation in memory, runs its
own clock thread for *Run*, and keeps a forked child process and pipes open. Vercel runs code as
short-lived functions (its container runtime too: instances autoscale, scale down after 5 minutes idle
and obey function duration limits), so a command and the live stream could reach different instances
or a stopped engine. Render runs one ordinary, persistent container, which is what the engine needs.
Vercel only serves the dashboard, and the browser talks to Render directly (not through a Vercel
proxy, which would put long-lived SSE streams under Vercel's timeouts).

**One simulation per visitor.** In public mode the bridge starts a separate engine process for each
browser tab (identified by a random session id kept in `sessionStorage`, so a refresh keeps the same
simulation). Visitors cannot reset or see each other's simulations. The local mode (`run_dev.sh`)
still uses one shared engine, exactly as before.

## Configuration

### Vercel (dashboard)

| Variable | Value | Used by |
|---|---|---|
| `TARMAC_API_BASE` | `https://tarmacos-bridge.onrender.com` | `scripts/build_web.mjs` writes it into `config.js`; the build fails if it is missing or not `https://` |

Set for Production, Preview and Development. Change with `npx vercel env rm TARMAC_API_BASE production`
then `npx vercel env add TARMAC_API_BASE production`, and redeploy.

### Render (backend) — in `render.yaml` (applied on every push) or the service's *Environment* tab

| Variable | Production value | Meaning |
|---|---|---|
| `TARMAC_ALLOWED_ORIGINS` | `https://tarmacos-kohl.vercel.app,https://tarmacos-zimran2.vercel.app,https://tarmacos-*-zimran2.vercel.app` | browser origins allowed by CORS (`*` wildcard) |
| `TARMAC_MAX_SESSIONS` | `12` | engines running at once; extra visitors see "Server busy" and retry |
| `TARMAC_MAX_SESSIONS_PER_IP` | `4` | engines per client IP |
| `TARMAC_PUBLIC` | `1` (set in `Dockerfile`) | per-session engines, limits, CORS; `0`/unset = local mode |
| `HOST`, `PORT` | `0.0.0.0`, `10000` (Dockerfile; Render may override `PORT`) | bind address |
| `TARMAC_IDLE_SECONDS` | `600` (default) | stop a session with no open dashboard after this long |
| `TARMAC_MAX_IDLE_SECONDS` | `3600` (default) | stop a session that sent no command for this long |
| `TARMAC_RATE_LIMIT` | `120` (default) | requests per IP per 10 s |

There are no secrets anywhere in this deployment.

## Everyday tasks

| Task | How |
|---|---|
| **Update the dashboard** | commit, then `./scripts/deploy_web.sh --prod` (Git Bash or WSL, from `tarmacos/`) |
| Try a dashboard change first | `./scripts/deploy_web.sh` (preview URL; previews are behind Vercel login by default) |
| **Update the engine or bridge** | commit and `git push` — Render rebuilds automatically (≈5–10 min; the build runs the unit and golden tests and refuses to deploy if they fail). Only changes under `engine/`, `bridge/` or to the `Dockerfile` trigger a rebuild (`buildFilter` in `render.yaml`), because a backend restart ends every visitor's running simulation |
| **Check backend health** | open https://tarmacos-bridge.onrender.com/api/health → `{"ok": true, "sessions": N, "max_sessions": 12}` |
| **View backend logs** | Render dashboard → `tarmacos-bridge` → *Logs* (session start/stop lines, engine exits) |
| View dashboard logs | Vercel dashboard → `tarmacos` → *Deployments* (build logs; there is no server code) |
| **Restart the backend** | Render → `tarmacos-bridge` → *Manual Deploy* → *Restart service* (stops every engine cleanly via SIGTERM) |
| **Roll back the backend** | Render → *Events* → pick an earlier successful deploy → *Rollback* |
| **Roll back the dashboard** | Vercel → *Deployments* → earlier one → ⋯ → *Promote to Production* (or `npx vercel rollback`) |
| Run locally | unchanged: `./scripts/run_dev.sh` in WSL, open http://127.0.0.1:8080 |
| Run the tests | unchanged: `./scripts/run_tests.sh` in WSL (now includes public-mode bridge tests) |

`deploy_web.sh` deploys the **last commit** of `web/`, `scripts/build_web.mjs` and `vercel.json` from a
temporary copy. It does this because the Vercel CLI, when it sees `render.yaml`, tries to turn the backend
into a Vercel container service. Do not run `vercel deploy` directly in `tarmacos/`.

First-time setup (already done; for a fresh account): `npx vercel login`; create the project from a
copy without `render.yaml` (`git archive HEAD -- web scripts/build_web.mjs vercel.json | tar -x -C <empty dir>`,
then `npx vercel link --yes --project tarmacos` there) and copy its `.vercel/project.json` into
`tarmacos/.vercel/`; add `TARMAC_API_BASE`; on Render: *New → Blueprint →* this repository.

## Free-tier behaviour and limits

- **Render Free sleeps after 15 minutes without incoming requests.** The first visitor afterwards waits
  about a minute; the dashboard shows *"Connecting… the server may take up to a minute to wake"* and
  connects by itself. A sleep or restart ends every running simulation (they are in memory by design).
- Render Free: 0.1 CPU, 512 MB RAM, 750 instance-hours per month (enough for one always-on service),
  and Render may restart free services at any time. Each engine uses about 5 MB and no CPU while paused.
- Long SSE connections may be cut by the proxy (~100 minutes); the browser reconnects automatically.
- If the backend restarts (deploy, sleep, Render maintenance) the dashboard reconnects by itself and
  shows a notice that a new engine started; the previous simulation is gone.
- The bridge also serves a copy of the dashboard at the Render URL. Share the Vercel URL: that copy
  is only refreshed on backend rebuilds.
- Vercel Hobby is for non-commercial use; this static site uses a tiny fraction of its limits.
- No paid features are used. Upgrading Render to *Starter* (paid) would remove sleeping.

## Security notes

- The Ops terminal is unchanged: engine commands are parsed by the engine's own validator, and
  `sys threads|children|fds|ps` are fixed argv lists (no shell) whose only variable is the session's
  own engine PID. Nothing a visitor types is ever executed as a shell command.
- Engines are created only by the bridge, at most one per session, capped globally and per IP, and
  stopped when idle (threads joined, child process reaped). `quit` is refused over HTTP.
- CORS admits only the origins above; request bodies are limited to 10 kB and command lines to 300
  characters; requests are rate-limited per IP. The container runs as an unprivileged user with `tini`
  as PID 1 so no orphan process can linger.
- There is no login: anyone with the URL can start a simulation (within the limits above).
