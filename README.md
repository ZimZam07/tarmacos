# TarmacOS: Airport Ground & Gate Operations Control

TarmacOS is an Operating Systems Lab project: an interactive airport-apron simulation in which
**flights are processes**, **ground services are POSIX threads**, **gates, fuel trucks and tugs
are shared resources**, **the baggage cart is a disk head**, and **a real child process plans the
cart's route over pipes**. Every value on the dashboard comes from a C++ engine running on Linux.

| Module | What you can do | OS concept |
|---|---|---|
| Overview | live apron map, KPIs, guided scenarios | the whole system in one state |
| Flights | create flights, follow NEW → READY → RUNNING ⇄ BLOCKED → TERMINATED | process lifecycle |
| Scheduler | FCFS, Priority (optional preemption), Round Robin; Gantt chart and WT/TAT | CPU scheduling |
| Resources | who owns each gate/truck/tug, who is waiting and why | resource allocation, blocking |
| Threads & sync | real Linux TIDs, mutex/condition variables, `sem_t` bounded buffer | pthreads, synchronisation |
| Deadlocks | A/B/C circular wait under Prevention, Avoidance (Banker's), Detection, Recovery | deadlock handling |
| Memory | FIFO demand paging, reference strings, page tables, address translation | memory management |
| Baggage & disk | FCFS / SSTF / SCAN on belt positions 0–49, planned by a forked child | disk scheduling, IPC |
| Ops terminal | engine commands plus real `ps -T`, `ps --ppid`, `/proc/PID/fd` | Linux commands |

## Technology

- **Engine:** C++17 on Linux/WSL2, built with `make`. It uses POSIX APIs directly (`fork`, `pipe`, `read`/`write`, `poll`, `waitpid`, `pthread_*`, `sem_*`). No third-party libraries, and no `std::thread`/`std::mutex`.
- **Bridge:** Python 3 standard library only. It speaks HTTP and Server-Sent Events to the browser, and plain-text commands on the engine's stdin with JSON lines back on its stdout.
- **Dashboard:** plain HTML/CSS/JavaScript ES modules, with no build step and no framework. It renders engine snapshots and computes no OS results itself.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Prerequisites

Linux, or **WSL2** on Windows (the engine is POSIX code and does not run natively on Windows), with:

```bash
sudo apt-get install -y build-essential python3     # g++, make, python3
./scripts/check_env.sh                              # verifies g++, make, python3, ps
```

Developed and tested on Ubuntu 26.04 (WSL2) with GCC 15.2, GNU Make 4.4.1 and Python 3.14.

## Build, test, run

Run all commands inside WSL/Linux from the `tarmacos` directory. From Windows, open a terminal with `wsl`, then `cd /mnt/c/Users/<you>/Downloads/os_project/tarmacos`.

```bash
make -C engine                              # 1. build the engine  -> engine/build/tarmac_engine
make -C engine test                         # 2. unit tests (pure algorithms, hand-calculated cases)
make -C engine golden                       #    end-to-end engine tests (real threads, child process, pipes)
python3 -m unittest bridge/test_bridge.py   #    bridge <-> engine integration tests
./scripts/run_dev.sh                        # 3. build if needed and start bridge + engine on port 8080
```

Then open **http://127.0.0.1:8080** in a browser. On Windows, use `127.0.0.1` rather than `localhost`: WSL2 does not forward the IPv6 address `::1`, which `localhost` may resolve to.

- **Stop:** press `Ctrl+C` in the terminal running `run_dev.sh`. The bridge sends `quit`, the engine joins all its threads, stops and reaps the child process, and exits with status 0.
- **Reset:** use the **Reset** button (with confirmation). All flight and worker threads are stopped and joined, and the apron returns to its initial state: 6 gates, 2 fuel trucks, 2 tugs, RR q=4, RECOVERY policy, 8 frames, cart at 20.
- **Without a browser:** `./scripts/demo_deadlock.sh RECOVERY` drives the engine from the shell.
- **By hand:** `printf 'scenario deadlock DETECTION\nsim run-until-quiet\nstate\nquit\n' | engine/build/tarmac_engine`

## Demonstration in five minutes

1. **Overview → "Three-way deadlock".** On the Deadlocks tab, press **Step** repeatedly. A, B and C take Gate 3, the truck and the tug (t0–t2), then block (t6–t8). At t8 the graph turns red: *deadlock detected*. Detection reports it and does nothing more.
2. Select **Recovery** → **Load A/B/C scenario** → **Run to end**. Victim C is rolled back at t8, and the flights finish at t=13 (B), 18 (A) and 21 (C).
3. Select **Avoidance**. At t2, C's tug request is *deferred* because Banker's finds no safe sequence, so no cycle ever forms. Then try **R1/R2/R3** in the Banker's safety-check example.
4. **Scheduler → RR q=4 → To end.** Averages WT 8.75 / TAT 13.50, which match the hand calculation. Repeat with FCFS (8.00 / 12.75) and Priority (4.75 / 9.50).
5. **Memory → Silberschatz · 3 frames**, then **Step**: watch FIFO evict the oldest page, ending with 15 faults.
6. **Baggage & disk → SCAN ↑**. The child process (its real PID is shown) plans 21 → 37 → 44 → edge 49 → 12 → 5 → 3 = 75.
7. **Overview → "Busy apron" → Run.** Five flights with refuel/baggage threads contend for 3 gates, 1 truck and 1 tug.
8. **Ops terminal → `sys threads`, `sys children`, `sys fds`.** The kernel's view of the same threads, child process and pipes.

## Tests

`./scripts/run_tests.sh` runs everything below from a clean build with warnings as errors.

| Command | What it checks | Last result |
|---|---|---|
| `make -C engine test` | 31 unit tests: scheduling, Banker's, detection, FIFO, disk, protocol | 105 checks, 0 failures |
| `make -C engine golden` | live engine: every reference case, the 4 deadlock policies, determinism (10 runs), real PIDs/pipes/threads, reset ×50, bounded buffer blocking, error codes, killed child | 74 checks, 0 failures |
| `python3 -m unittest bridge/test_bridge.py` | HTTP API, SSE, sys commands, path traversal, engine offline + restart | 7 tests OK |

## Limitations and provisional choices

- The course material names topics but not every algorithm or convention. These are **documented, configurable textbook choices, not instructor requirements**:
  - lower priority number = higher priority, with ties broken by arrival then SPID
  - Round Robin default quantum 4 ticks
  - resource ordering for prevention, Banker's for avoidance, matrix detection, and the victim rule (lowest priority, then youngest)
  - FIFO page replacement
  - SSTF tie → lower position, and SCAN visits the edge only when it must reverse
- Flights are **logical** processes (SPIDs). Only the baggage handler is a real OS process. Logical data is labelled *Simulated* in the UI, and real mechanisms are labelled *Real POSIX*.
- Time is in discrete ticks. Threads run concurrently and block for real, but all decisions are applied at the end of each tick in a fixed order, so every run of a scenario is identical.
- The baggage cart serves one batch at a time: requests that arrive during a batch wait for the next one.
- Memory and disk are simulations of the algorithms; no real memory or disk is managed.
- Single-user local application: no authentication, persistence or remote access (the bridge binds to 127.0.0.1).

Further reading: [docs/OS_CONCEPTS.md](docs/OS_CONCEPTS.md) · [docs/ALGORITHMS.md](docs/ALGORITHMS.md) · [docs/VIVA.md](docs/VIVA.md) · planning documents in `../tarmacos_blueprint/`.
