# TarmacOS experience layer (dashboard v2)

This document records how the cinematic dashboard is built on top of the unchanged engine, and the
rules that keep it honest. Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the engine and bridge.

## 1. Audit summary (what existed before the redesign)

| Layer | Technology | Status |
|---|---|---|
| Engine | C++17, POSIX threads, `sem_t`, `fork`/pipes; deterministic lockstep ticks | kept; two additive snapshot fields (below) |
| Bridge | Python 3 stdlib, HTTP + Server-Sent Events; streams the **latest** snapshot (max 10/s) | unchanged |
| Dashboard | Plain ES modules, no framework, no build step, 9 tab views rendering one snapshot | replaced by this layer; every feature ported |
| Tests | 31 unit tests (105 checks), 74 golden checks, 13 bridge tests | all still pass; 2 golden checks added |

Engine facts the visuals rely on (verified by tracing `scenario contention`):

- A flight is a logical process (SPID) run by one pthread. OS state (`NEW READY RUNNING BLOCKED TERMINATED`)
  and airport phase (`APPROACHING LANDING TAXIING AT_GATE TURNAROUND PUSHBACK DEPARTED ARRIVED`) are separate.
- Scripts acquire in the order Gate → Fuel truck → Tug, so normal traffic never deadlocks; deadlocks only
  form in the scripted A/B/C scenario.
- Ground services are real pthreads (`REFUEL` asks for a fuel truck, `BAGGAGE` produces into a semaphore
  bounded buffer); the baggage cart is the disk head and a real child process plans its route over pipes.

## 2. Engine instrumentation (the only engine change)

`engine/src/snapshot.cpp`, both purely additive and read-only:

1. Each entry of `snapshot.events` now carries `data`, the same structured payload the event already had on
   stdout (`spid`, `resource`, `phase`, `class`, `task`...). The dashboard never parses English messages.
2. Each `service` entry of `snapshot.threads` now carries `task`, `service`, `work_left`, `bags_total`,
   `bags_served`, `wait_ticks`, so service progress bars show the real task record.

Covered by golden checks `T-G12`. The determinism checks (byte-identical event streams) are unaffected.

## 3. Presentation architecture

```
 bridge SSE ──► store.js (latest snapshot) ──► journal.js (dedupe events by epoch+seq, per-flight timelines)
                         │                              │
                         ▼                              ▼
                 model.js (pure derivations: gate status, flight station, services per flight)
                         │
      ┌──────────────────┼───────────────────────────┬──────────────────────┐
      ▼                  ▼                           ▼                      ▼
 scene/ (Three.js)   shell/ + drawers/          explorer/ (6 OS modules    story.js (drives the
 airport, actors,    top bar, rail, context     + Linux & IPC), SVG/DOM    real engine with
 camera, labels      panel, event timeline      keyed updates              `sim step`)
```

- **Source of truth.** Every visual state is a function of the latest snapshot plus the event journal.
  The scene keeps only *presentation* state: where an aircraft currently is on its way to the station the
  engine says it is at.
- **Stations, not teleports.** `model.flightStation()` maps (phase, held gate, held tug, state) to a station
  (holding stack, final approach, runway, taxi-in, stand, pushback, taxi-out, departure, remote stand).
  Stations are ordered, so if snapshots skip a phase (the bridge sends at most 10/s) the aircraft still
  flies through every intermediate station. When the engine runs faster than the animation, queued moves
  are played faster (catch-up), never skipped.
- **Labels tell the engine's truth immediately.** An aircraft label shows the current engine state even
  while the model is still catching up.
- **What is drawn but is not an engine resource** is labelled as such: belt loaders represent `BAGGAGE`
  pthreads (not an allocatable resource); the baggage cart is the disk head.
- **Three.js r170** is vendored in `web/vendor/three/` (MIT). No build step, no framework, works offline.
  The scene module is loaded lazily; without WebGL the dashboard falls back to a 2D apron map.

## 4. Honesty rules

1. No metric is computed by the dashboard that the engine already computes. Charts over time are built
   from snapshots *as observed* and say so.
2. Every control maps to an engine command: run, pause, step, run-until-quiet, speed (`tick_ms`, the real
   execution speed), reset, scenarios, flight create/abort, scheduler, deadlock policy, memory, disk.
   There is no separate "presentation speed".
3. Comparisons (scheduler, disk) run each algorithm's reference scenario on the engine and read the results.
4. Story Mode drives the real engine (`scenario contention` + `sim step`). Replaying a chapter re-runs the
   deterministic scenario to that chapter's start tick.
5. There is no fabricated deadlock: the normal scripts cannot deadlock, and the story says so and links to
   the real A/B/C scenario.

## 6. Where things live (`web/`)

| Path | Role |
|---|---|
| `index.html`, `css/base.css`, `css/shell.css`, `css/explorer.css` | shell markup; design tokens (palette, type, motion), frame, pages |
| `js/main.js` | bootstrap: SSE connection, routing, intro, lazy 3D load, keyboard |
| `js/core/journal.js` · `history.js` · `model.js` · `state.js` · `sound.js` | event journal · per-tick samples · pure derivations · selection/settings/route · optional cues |
| `js/scene/host.js` | renderer, quality tiers, snapshot → actor sync, picking, labels, adaptive resolution |
| `js/scene/world.js` · `layout.js` · `paths.js` · `models.js` · `actors.js` · `camera.js` · `overlay.js` · `fallback2d.js` | static airport · geometry & routes · motion paths · procedural models · aircraft/vehicle/loader/cart actors · orbit camera · HTML labels & links · 2D fallback |
| `js/shell/*.js` | top bar & menus, drawers (Flights, Ground Ops, Resources), context panel, timeline/log, notices, traffic generator |
| `js/pages/*.js` | OS Explorer modules 01–06, Linux & IPC, Analytics |
| `js/story.js` | Story Mode director |
| `vendor/three/` | Three.js r170 (MIT) |

## 7. Verification (2026-11-20)

- `./scripts/run_tests.sh`: clean build with `-Werror` (0 warnings), 105 unit checks, 76 golden checks, bridge suite OK.
- Headless Chrome (SwiftShader, no GPU) against the live engine: intro, airport, all drawers, context panels (flight, gate, truck, cart), every Explorer module with its reference scenario, Analytics, Story Mode chapters 1–6 including replay, the deadlock scenario in 3D, live traffic, 390 px mobile layout (no horizontal overflow). No console errors.
- Scene cost with the busy apron: about 170 draw calls and 7k triangles. GPU resources stay constant (52 geometries, 5 textures, 12 programs) across nine scenario reloads and a reset. Labels and links cost about 0.06 ms per frame. JS heap is about 12 MB.
- Not measured: real frame rate on a GPU. Turn on **Settings → Frame-rate meter**. Balanced lowers its pixel ratio automatically if the frame rate stays low; Performance disables shadows and caps at 30 fps.

## 8. Known limitations

- At 5× or with **Run to end**, the aircraft follow the engine with a delay. Every intermediate station is still flown, faster than usual, and labels and panels always show the engine's current state.
- A flight that is created and terminated between two streamed snapshots is not drawn in 3D. It still appears in every panel and table.
- Story Mode's chapters follow the order in which the engine actually does things in the *Busy apron* scenario: scheduling and gate contention happen before AI101's ground services.
- The Inter and JetBrains Mono fonts come from Google Fonts. Offline, the UI falls back to system fonts. Everything else, including Three.js, is served locally.
- Deploying: the dashboard relies on the new snapshot fields, so deploy the backend (Render) before the dashboard (Vercel).
