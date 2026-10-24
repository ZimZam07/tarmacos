# Viva preparation: likely questions, answers based on the actual code

**Why C++ and POSIX?**
The lab is about Linux system programming. The engine calls the POSIX APIs directly (`fork`, `pipe`, `read`, `write`, `poll`, `waitpid`, `pthread_create`/`join`, `pthread_mutex_*`, `pthread_cond_*`, `sem_*`), so every mechanism can be shown in code and in `ps`/`/proc`. C++ is used only for structure (classes, `std::vector`). We avoided `std::thread`/`std::mutex` because they would hide the POSIX calls the course teaches.

**What is the difference between an SPID and a real PID?**
An SPID is a simulated process id stored in our `Flight` record. Flights are logical processes, each executed by one pthread inside the engine. Real PIDs belong to the kernel: the engine process and the baggage-handler child. The UI labels them separately, and `sys children` shows the child's real PID with PPID = engine.

**How do fork, pipes, read/write and wait work here?** (`baggage_ipc.cpp`)
- `main()` calls `pipe()` twice, then `fork()`, *before any thread exists*. Forking a multi-threaded process copies only the calling thread and can leave locks held.
- The child closes the write end of the request pipe and the read end of the result pipe; the parent closes the opposite ends. If a process kept an extra write end open, the reader would never see EOF.
- The parent writes `SCHED SCAN UP 20 0 49 6 5 37 …\n` and waits with `poll()` (1 s timeout) before `read()`.
- The child computes the order and writes `ORDER … PATH … MOVE 75 PID 613`.
- On quit the parent writes `QUIT`, closes its end and calls `waitpid()`. `WIFEXITED`/`WEXITSTATUS` give "exited with status 0". If the child is killed, the next exchange fails, `waitpid(WNOHANG)` reaps it, and the engine reports "killed by signal 9" instead of crashing (SIGPIPE is ignored).

**How do pthreads and mutexes protect shared state?** (`simulation.h`, `workers.cpp`)
- One `pthread_mutex_t mtx` protects every table.
- A flight thread waits with `while (!f->hasTurn && !shuttingDown) pthread_cond_wait(&f->wakeup, &mtx);`. `pthread_cond_wait` releases the mutex while sleeping and re-acquires it on wake-up; the `while` re-checks the condition, so spurious wake-ups are harmless.
- The clock signals exactly the threads that get a turn, then waits on `ackCv` until each has finished its step.
- Ground services are created with `pthread_create(&t->thread, nullptr, serviceThreadMain, task)` (a struct argument) and joined with `pthread_join(t->thread, &returned)`, which collects a heap `ServiceResult`.

**Where are semaphores used?** (`baggage_buffer.cpp`)
- The baggage bounded buffer is the classic producer-consumer: `sem_wait(emptySlots)` → lock → insert → unlock → `sem_post(fullSlots)`, and the reverse for the intake thread. With the intake held, `sync.full = 4`, `empty = 0`, and a producer is visibly blocked in `sem_wait`.
- A binary semaphore (initial value 1) guards the child pipe.

**If threads run concurrently, why is every run identical?**
Steps only record intents. The clock applies them at the end of the tick, sorted by (SPID, task, sequence), and all grants are decided there oldest-first. Threads still block for real, but no decision depends on which thread got the mutex first. The tests compare event streams over 10 runs.

**How are the scheduling metrics calculated?**
The dispatcher records which SPID ran in each tick; the Gantt chart is that log, compressed into slices. Waiting time is incremented once per tick while a flight is READY. Turnaround = completion − arrival. For the reference set the live engine gives exactly the hand-calculated values (RR q=4: 8.75 / 13.50).

**What distinguishes prevention, avoidance, detection and recovery?**
- Prevention makes deadlock impossible by breaking a Coffman condition. We break circular wait with the order Gate < Truck < Tug, and C's out-of-order request is refused.
- Avoidance allows a request only if Banker's still finds a safe sequence, so C's tug request is deferred at t2.
- Detection lets the cycle form and finds it from Allocation/Request/Available at t8, but takes no action.
- Recovery = detection + action: victim C is rolled back (or terminated) and the others finish.

**How does Banker's algorithm decide safety?** (`algo/banker.cpp`)
- Need = Max − Allocation, and Work = Available.
- Repeatedly pick the lowest-index unfinished process whose Need ≤ Work, add its allocation to Work, and mark it finished. If all finish, the state is safe and that order is the safe sequence.
- For a request, first check Request ≤ Need and Request ≤ Available, pretend to grant it, and run the safety check. BANKER-REF: R1 safe, R2 unsafe, R3 exceeds the claim.

**Why doesn't the detector deadlock the engine?**
Blocked flights wait on condition variables, which release `mtx`. The detector runs in the clock thread while holding `mtx`, so it never waits for a lock held by the threads it inspects. Semaphore and pipe waits are always done without holding `mtx`.

**How does FIFO page replacement work?**
Each flight has 4 logical pages, loaded on first touch. On a fault with no free frame, the oldest resident page is evicted, whatever its use. The Silberschatz string with 3 frames gives 15 faults. Belady's string gives 9 faults with 3 frames but 10 with 4, which is the anomaly FIFO is known for.

**How do the disk algorithms differ?**
FCFS serves in arrival order (145 for the apron case), SSTF picks the nearest request (60, but may starve distant requests), and SCAN sweeps like an elevator (75 going up, including the edge at 49). Belt positions are only an analogy for cylinders.

**What are the limitations?**
- Flights are logical processes, not OS processes.
- Time is discrete and lockstep.
- One CPU.
- The cart serves one batch at a time.
- Memory and disk are algorithm simulations.
- Several conventions (priority direction, quantum, the SSTF tie rule, the victim rule, which deadlock/memory/disk algorithms) are textbook choices, because the lab sheets we have do not specify them.
- Live airport scripts acquire resources in rank order, so a deadlock appears only in the dedicated A/B/C scenario.
