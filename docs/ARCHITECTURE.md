# TarmacOS architecture

```
 Browser (web/)                    Bridge (bridge/server.py)             Engine (engine/build/tarmac_engine)
 ┌──────────────────────┐  HTTP    ┌──────────────────────────┐  pipes  ┌──────────────────────────────────────┐
 │ 9 views render the   │ ───────► │ POST /api/cmd  -> line   │ ──────► │ main thread: read command from stdin │
 │ latest snapshot only │  POST    │ GET /api/stream (SSE)    │ stdin   │ clock thread: lockstep ticks         │
 │ (store.js)           │ ◄─────── │ POST /api/sys (ps, ls)   │ ◄────── │ 1 pthread per flight                 │
 └──────────────────────┘  SSE     │ serves web/ files        │ stdout  │ 1 pthread per ground service         │
                                   └──────────────────────────┘ (JSON)  │ intake thread (sem_t consumer)       │
                                                                        └──────────────┬───────────────────────┘
                                                                         fork() + 2 pipes│ "SCHED ..." / "ORDER ..."
                                                                        ┌──────────────▼───────────────────────┐
                                                                        │ baggage-handler CHILD PROCESS        │
                                                                        └──────────────────────────────────────┘
```

In public mode (`TARMAC_PUBLIC=1`, the hosted copy) the bridge runs one such engine per browser session (`?sid=`); see [DEPLOYMENT.md](DEPLOYMENT.md).

The bridge↔engine pipes are only **transport**. The course-relevant IPC demonstration is the engine↔child exchange, which is genuine `fork`/`pipe`/`read`/`write`/`waitpid` code in `engine/src/baggage_ipc.cpp`.

## Engine source map (`engine/src/`)

| File | Responsibility |
|---|---|
| `algo/scheduling.*` | `CpuDispatcher` (FCFS/Priority/RR rules), `simulateSchedule()` for reference runs |
| `algo/banker.*`, `algo/detection.*` | Banker's safety and request algorithms; deadlock detection |
| `algo/paging.*`, `algo/disk.*` | FIFO pager; FCFS/SSTF/SCAN plans |
| `flight.*` | Flight record (SPID, OS state, phase, script, metrics) and op-type scripts |
| `resources.*` | resource instances, owners, pending requests |
| `deadlock.*` | the four policies, matrices from live tables, victim choice, BANKER-REF example |
| `memory.*`, `storage.*` | live paging of flight pages; baggage cart (disk head) movement |
| `baggage_buffer.*` | bounded buffer: `sem_t emptySlots/fullSlots` + `pthread_mutex_t` |
| `baggage_ipc.*` | child process, two pipes, `poll()` timeout, binary semaphore, `waitpid` |
| `simulation.h/.cpp` | engine state, locking rules, clock loop, admission and dispatch |
| `workers.cpp` | code that runs inside the flight, service and intake threads |
| `resolve.cpp` | end-of-tick decisions: grants, policies, detection/recovery, memory, cart, invariants |
| `commands.cpp`, `scenarios.cpp` | text command interface; reset and the demonstration presets |
| `snapshot.cpp`, `json.*`, `output.*`, `protocol.*` | JSON snapshot, JSON writer, stdout writer, command parser |
| `main.cpp` | start-up order: ignore SIGPIPE → fork child → start threads → command loop |

## One tick (deterministic lockstep)

1. **Admit.** The clock thread moves flights whose arrival time has come from NEW to READY, in SPID order.
2. **Dispatch.** `CpuDispatcher::chooseForTick()` picks the flight that may use the single "apron control CPU" for this tick.
3. **Turns.** The clock gives a turn to that flight thread and to every working service thread (`hasTurn = true; pthread_cond_signal`), then waits on `ackCv` until all of them have acknowledged.
4. **Steps.** Each participant executes exactly one script step. Steps do not change shared tables; they append **intents** (request, release, phase change, page touch, finish).
5. **Resolve.** The clock sorts the intents by `(spid, task, seq)` and applies them. It then:
   - grants pending requests oldest-first under the deadlock policy
   - runs detection and recovery if a new block happened
   - pages memory
   - moves the cart, asking the child process for a new batch plan if needed
   - checks invariants
   - publishes the events and a snapshot
6. **Pace.** It sleeps `tick_ms`, or waits while paused.

The threads really run in parallel and really block (`pthread_cond_wait`, `sem_wait`), yet results are reproducible, because every shared decision is made in step 5 in a fixed order. The golden tests run each scenario 10 times and require byte-identical event streams.

## Locking rules

- `Simulation::mtx` (a `pthread_mutex_t`) protects all simulation state. Every condition variable is used with it.
- Every wait is `while (!condition) pthread_cond_wait(&cv, &mtx);`, so spurious wake-ups and lost signals cannot cause errors.
- `mtx` is **never** held while blocking on a semaphore (bounded buffer) or on the child's pipe (`poll`/`read`). So those waits can never deadlock the engine, and the deadlock detector never needs a lock held by the threads it inspects.
- Lock order: `mtx` → bounded-buffer mutex → output mutex (innermost).

## Reset and shutdown

- **Reset** (`sim reset`, scenarios):
  1. set `shuttingDown` and broadcast every condition variable
  2. post the bounded buffer's semaphores so blocked producers and the consumer return
  3. join the clock, intake, flight and service threads, in that order
  4. free everything, rebuild the initial state, and increment `epoch`
- **The child process survives a reset.** It is stateless.
- **Quit** does the same, then sends `QUIT` to the child, closes the write end of the request pipe, reads until EOF, calls `waitpid`, and reports the exit status.

## Protocol

- **Commands** are text lines, optionally prefixed with `#id`, e.g. `#7 flight create AI101 TURNAROUND 2`. Run `help` for the full grammar.
- **Responses:**
  - `{"type":"resp","id":"7","ok":true,"result":{…}}`
  - `{"type":"resp","id":"7","ok":false,"error":{"code":"E_BAD_ARG","msg":"…"}}`
- **Error codes:** `E_PARSE`, `E_UNKNOWN_CMD`, `E_BAD_ARG`, `E_UNKNOWN_FLIGHT`, `E_DUPLICATE_FLIGHT`, `E_FLIGHT_DONE`, `E_BUSY`, `E_STATE`, `E_LIMIT`, `E_IPC`, `E_INTERNAL`. The bridge adds `E_ENGINE_OFFLINE`, `E_TIMEOUT` and `E_BAD_REQUEST`, and in public mode `E_CAPACITY`, `E_SESSION_EXPIRED` and `E_RATE_LIMIT`.
- **Events:** `{"type":"event","epoch":…,"seq":…,"tick":…,"kind":"RES_GRANTED","msg":"…","data":{…}}`
- **Snapshots:** `{"type":"snapshot", "sim", "cpu", "flights", "resources", "pending", "deadlock", "memory", "disk", "sync", "ipc", "threads", "events"}`. The UI ignores snapshots older than the one it holds, using `epoch` and `version`.
