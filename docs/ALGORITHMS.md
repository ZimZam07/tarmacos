# Algorithm notes

Time unit: one **tick**. Every flight script step costs one CPU tick; phase markers cost nothing.

## CPU scheduling (`algo/scheduling.cpp`)

| Algorithm | Rule | Source |
|---|---|---|
| FCFS | run the head of the ready queue until it blocks or finishes | Assignment 4 |
| Priority | run the lowest priority *number*; ties go to the earlier arrival, then the smaller SPID. Non-preemptive by default; with `preempt=on`, a strictly better ready flight takes the CPU at the next tick | Assignment 4 Q1 (direction and preemption are **our convention**) |
| Round Robin | after `q` ticks the running flight goes to the **tail** of the queue, behind flights that became ready during that tick (default `q = 4`) | Assignment 4 Q3 (the quantum is **our convention**) |

Metrics:
- waiting time = ticks spent READY
- turnaround = completion − arrival
- response = first dispatch − arrival

The averages cover completed flights only.

**Reference set** (all arrive at 0; burst/priority: P1 6/3, P2 3/1, P3 8/4, P4 2/2):

| | Order | WT | TAT | Avg WT | Avg TAT |
|---|---|---|---|---|---|
| FCFS | P1 0–6, P2 6–9, P3 9–17, P4 17–19 | 0, 6, 9, 17 | 6, 9, 17, 19 | 8.00 | 12.75 |
| Priority | P2 0–3, P4 3–5, P1 5–11, P3 11–19 | 5, 0, 11, 3 | 11, 3, 19, 5 | 4.75 | 9.50 |
| RR q=4 | P1 0–4, P2 4–7, P3 7–11, P4 11–13, P1 13–15, P3 15–19 | 9, 4, 11, 11 | 15, 7, 19, 13 | 8.75 | 13.50 |

**Emergency** (P1 burst 5, prio 3 at t0; P2 burst 2, prio 0 at t2):
- without preemption: P1 0–5, P2 5–7
- with preemption: P1 0–2, P2 2–4, P1 4–7

## Deadlock (`algo/banker.cpp`, `algo/detection.cpp`, `deadlock.cpp`)

Scenario: one instance each of Gate 3, Fuel truck and Tug, with Round Robin q=1. Scripts:
- A: acquire Gate, work, acquire Truck, work 2, release all
- B: Truck, then Tug
- C: Tug, then Gate

| Policy | Mechanism | Result |
|---|---|---|
| Prevention | a request is legal only if its rank (Gate 1 < Truck 2 < Tug 3) is higher than everything the flight holds | t8: C (holding the Tug) asks for Gate 3 → refused; C releases and restarts in order. B=13, A=16, C=21 |
| Avoidance | Banker's: grant only if a safe sequence remains (maximum claims A {G,T}, B {T,Tug}, C {Tug,G}) | t2: C's tug request leaves Need A (0,1,0), B (0,0,1), C (1,0,0) against Work (0,0,0) → unsafe → deferred. B=10, A=15, C=18 |
| Detection | Work = Available; a process that holds nothing is finished; repeatedly finish any process with Request ≤ Work; the rest are deadlocked | t8: Available (0,0,0), Requests (0,1,0), (0,0,1), (1,0,0) → {A,B,C} deadlocked; reported, not resolved |
| Recovery | detection + victim (largest priority number, then largest SPID). PREEMPT releases its resources and rolls it back to its first acquisition; TERMINATE aborts it | PREEMPT: B=13, A=18, C=21. TERMINATE: B=12, A=15, C aborted |

**An unsafe state is not a deadlock.** Banker's only guarantees that the system never enters an unsafe state.

**BANKER-REF** (types Gate/Truck/Tug, totals 3/2/2):

| | Allocation | Max | Need |
|---|---|---|---|
| P1 | 1 1 0 | 1 2 1 | 0 1 1 |
| P2 | 1 0 1 | 1 1 2 | 0 1 1 |
| P3 | 1 0 0 | 1 2 2 | 0 2 2 |

- **Available** = (0,1,1).
- **Safety:** Work (0,1,1) → P1 → (1,2,1) → P2 → (2,2,2) → P3 → (3,2,2). Safe ⟨P1, P2, P3⟩.
- **R1:** P1 asks (0,1,0) → Available (0,0,1); P1 can still finish → granted.
- **R2:** P3 asks (0,1,0) → Available (0,0,1); Needs (0,1,1), (0,1,1), (0,1,2) → nobody can finish → **unsafe**.
- **R3:** P2 asks (0,0,2) > Need (0,1,1) → rejected (exceeds its claim).

## FIFO page replacement (`algo/paging.cpp`)

On a fault, use the lowest free frame. If there is none, evict the page that has been resident longest (the head of the FIFO queue). Hits do not change the queue.

- Silberschatz string `7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1`, 3 frames: **15 faults, 5 hits**; final frames 7 | 0 | 1.
- Belady string `1 2 3 4 1 2 5 1 2 3 4 5`: 9 faults with 3 frames, **10 with 4 frames** (Belady's anomaly).
- Translation: physical = frame × 256 + offset, e.g. page 0 in frame 1, offset 42 → 298.
- **Live flights:** 4 pages each (flight plan, allocation record, service log, baggage list), 8 frames, global FIFO. A flight's frames are freed when it terminates.

## Disk scheduling (`algo/disk.cpp`)

| Algorithm | Rule |
|---|---|
| FCFS | serve in arrival order |
| SSTF | always serve the closest request; on a tie, the lower position |
| SCAN | serve everything in the current direction, go to the edge only if requests remain behind, then reverse |

Total head movement = Σ |path[i+1] − path[i]|.

| Case | FCFS | SSTF | SCAN ↑ | SCAN ↓ |
|---|---|---|---|---|
| Silberschatz: head 53, 0–199, queue 98 183 37 122 14 124 65 67 | 640 | 236 | 331 | 236 |
| Apron: head 20, 0–49, queue 5 37 12 44 21 3 | 145 | 60 | 75 | 64 |

The baggage child process computes the plan, and the parent re-checks it with the same function.
