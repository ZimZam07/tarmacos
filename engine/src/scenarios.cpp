// scenarios.cpp - reset and the reproducible demonstration presets.
//
// Reset is the only operation that stops threads, so it follows a strict order:
//   1. set shuttingDown and wake every condition variable,
//   2. close the bounded buffer (posts its semaphores so blocked threads return),
//   3. join the clock, intake, flight and service threads (in that order),
//   4. free all objects and rebuild the initial state with a new epoch.
// The baggage-handler CHILD PROCESS is stateless and keeps running across resets.
#include "json.h"
#include "simulation.h"

void Simulation::stopWorkerThreads() {
    if (!threadsRunning) return;
    pthread_mutex_lock(&mtx);
    shuttingDown = true;
    running = false;
    fastRun = false;
    pthread_cond_broadcast(&controlCv);
    pthread_cond_broadcast(&ackCv);
    pthread_cond_broadcast(&idleCv);
    pthread_cond_broadcast(&intakeCv);
    pthread_cond_broadcast(&holdCv);
    for (Flight* f : flights) pthread_cond_signal(&f->wakeup);
    for (ServiceTask* t : tasks) pthread_cond_signal(&t->wakeup);
    int producers = (int)tasks.size();
    pthread_mutex_unlock(&mtx);

    buffer.close(producers + 1);
    pthread_join(clockThread, nullptr);
    pthread_join(intakeThread, nullptr);
    // Flights first: a flight thread may itself be joining its service threads.
    for (Flight* f : flights) {
        if (f->threadStarted && !f->threadJoined) {
            pthread_join(f->thread, nullptr);
            f->threadJoined = true;
        }
    }
    for (ServiceTask* t : tasks) {
        if (!t->joined) {
            void* result = nullptr;
            pthread_join(t->thread, &result);
            delete static_cast<ServiceResult*>(result);
            t->joined = true;
        }
    }
    threadsRunning = false;
}

void Simulation::freeEpochObjects() {
    for (Flight* f : flights) {
        pthread_cond_destroy(&f->wakeup);
        delete f;
    }
    flights.clear();
    for (ServiceTask* t : tasks) {
        pthread_cond_destroy(&t->wakeup);
        delete t;
    }
    tasks.clear();
    buffer.destroy();
}

void Simulation::resetWorld(int gates, int trucks, int tugs, int frames) {
    stopWorkerThreads();
    freeEpochObjects();

    pthread_mutex_lock(&mtx);
    shuttingDown = false;
    tick = 0;
    epoch++;
    eventSeq = 0;
    intentSeq = 0;
    running = false;
    stepBudget = 0;
    fastRun = false;
    tickInProgress = false;
    pendingAcks = 0;
    intents.clear();
    requeueAfterGrants.clear();
    timeline.clear();
    schedChanges.clear();
    recentEvents.clear();
    nextSpid = 1;
    nextTaskId = 1;
    bagSeq = 0;
    bagsProduced = 0;
    bagsConsumed = 0;
    intakeHeld = false;
    invariantError.clear();
    invariantChecks = 0;
    ipcLastError.clear();
    child.checkIfExited();
    ipcStatus = child.status;

    // Documented initial state: RR q=4, RECOVERY (preempt), FIFO with `frames`
    // frames, cart at position 20 moving UP with FCFS.
    dispatcher.reset();
    dispatcher.config = SchedConfig{SchedAlgo::RR, 4, false};
    resources.setup(gates, trucks, tugs);
    deadlock.reset();
    deadlock.policy = DeadlockPolicy::RECOVERY;
    deadlock.action = RecoveryAction::PREEMPT;
    memory.reset(frames);
    storage.reset();
    storage.algo = DiskAlgo::FCFS;
    storage.direction = Direction::UP;
    storage.head = 20;
    scenarioName = "free-play";
    scenarioNote = "Empty apron with 6 gates, 2 fuel trucks and 2 tugs. Create flights or start a guided scenario.";

    std::string error;
    if (!buffer.init(error)) emit("ERROR", error);
    emit("SIM_RESET", "Simulation reset (epoch " + std::to_string(epoch) + ")");
    pthread_mutex_unlock(&mtx);

    int rc1 = pthread_create(&clockThread, nullptr, clockThreadMain, this);
    int rc2 = pthread_create(&intakeThread, nullptr, intakeThreadMain, this);
    if (rc1 != 0 || rc2 != 0) throw CommandError("E_INTERNAL", "could not start the engine threads");
    threadsRunning = true;

    pthread_mutex_lock(&mtx);
    publishSnapshot();
    pthread_mutex_unlock(&mtx);
}

// The A/B/C deadlock scripts (plan 09 section 8.2).
static std::vector<Step> deadlockScript(ResClass first, ResClass second) {
    Step phase{StepKind::PHASE};
    phase.phase = Phase::TURNAROUND;
    Step acquire1{StepKind::ACQUIRE};
    acquire1.resClass = first;
    Step work1{StepKind::WORK};
    work1.amount = 1;
    Step acquire2{StepKind::ACQUIRE};
    acquire2.resClass = second;
    Step work2{StepKind::WORK};
    work2.amount = 2;
    Step release{StepKind::RELEASE_ALL};
    Step departed{StepKind::PHASE};
    departed.phase = Phase::DEPARTED;
    return {phase, acquire1, work1, acquire2, work2, release, departed};
}

std::string Simulation::cmdScenario(const Command& c) {
    const std::string name = c.word(1);
    const std::string arg = toUpper(c.word(2));
    bool locked = false;  // createFlight may throw; never leave mtx locked
    try {
    if (name == "sched-ref") {
        SchedAlgo algo = SchedAlgo::FCFS;
        if (!arg.empty() && !parseSchedAlgo(arg, algo)) throw CommandError("E_BAD_ARG", "algorithm must be FCFS, PRIORITY or RR");
        resetWorld(6, 2, 2, 8);
        pthread_mutex_lock(&mtx);
        locked = true;
        dispatcher.config = SchedConfig{algo, 4, false};
        // SCHED-REF: P1 burst 6 prio 3, P2 3/1, P3 8/4, P4 2/2, all arriving at 0.
        int bursts[4] = {6, 3, 8, 2}, prios[4] = {3, 1, 4, 2};
        for (int i = 0; i < 4; i++) createFlight("P" + std::to_string(i + 1), OpType::CUSTOM, prios[i], bursts[i], 0, nullptr);
        scenarioName = std::string("sched-ref ") + schedAlgoName(algo);
        scenarioNote = "Scheduler reference: 4 CPU-only flights arriving at t=0 (P1 6/3, P2 3/1, P3 8/4, P4 2/2 as "
                       "burst/priority). Expected averages: FCFS WT 8.00 TAT 12.75, PRIORITY WT 4.75 TAT 9.50, "
                       "RR q=4 WT 8.75 TAT 13.50.";
    } else if (name == "emergency") {
        std::string preemptText = c.option("preempt", "on");
        if (preemptText != "on" && preemptText != "off") throw CommandError("E_BAD_ARG", "preempt must be on or off");
        bool preempt = preemptText == "on";
        resetWorld(6, 2, 2, 8);
        pthread_mutex_lock(&mtx);
        locked = true;
        dispatcher.config = SchedConfig{SchedAlgo::PRIORITY, 4, preempt};
        createFlight("AI101", OpType::CUSTOM, 3, 5, 0, nullptr);
        createFlight("EMRG7", OpType::CUSTOM, 0, 2, 2, nullptr);
        scenarioName = std::string("emergency preempt=") + (preempt ? "on" : "off");
        scenarioNote = "Priority scheduling: AI101 (burst 5, priority 3) is running when emergency EMRG7 "
                       "(burst 2, priority 0) arrives at t=2. With preemption it takes the CPU immediately.";
    } else if (name == "deadlock") {
        DeadlockPolicy policy = DeadlockPolicy::DETECTION;
        if (!arg.empty() && !parsePolicy(arg, policy)) throw CommandError("E_BAD_ARG", "unknown deadlock policy");
        RecoveryAction action = RecoveryAction::PREEMPT;
        if (c.hasOption("action") && !parseRecoveryAction(toUpper(c.option("action", "")), action))
            throw CommandError("E_BAD_ARG", "action must be PREEMPT or TERMINATE");
        resetWorld(6, 1, 1, 8);
        pthread_mutex_lock(&mtx);
        locked = true;
        // Only Gate 3 is open, with one fuel truck and one tug.
        for (ResourceInstance& r : resources.instances)
            if (r.cls == ResClass::GATE && r.id != "G3") r.enabled = false;
        dispatcher.config = SchedConfig{SchedAlgo::RR, 1, false};  // time-slicing creates the interleaving
        deadlock.policy = policy;
        deadlock.action = action;
        std::vector<Step> a = deadlockScript(ResClass::GATE, ResClass::FUEL_TRUCK);
        std::vector<Step> b = deadlockScript(ResClass::FUEL_TRUCK, ResClass::TUG);
        std::vector<Step> cc = deadlockScript(ResClass::TUG, ResClass::GATE);
        createFlight("A-AI301", OpType::SCRIPTED, 2, 0, 0, &a);
        createFlight("B-6E302", OpType::SCRIPTED, 2, 0, 0, &b);
        createFlight("C-UK303", OpType::SCRIPTED, 3, 0, 0, &cc);
        scenarioName = std::string("deadlock ") + policyName(policy) +
                       (policy == DeadlockPolicy::RECOVERY ? std::string(" ") + recoveryActionName(action) : "");
        scenarioNote = "A holds Gate 3 then wants the fuel truck; B holds the truck then wants the tug; C holds the "
                       "tug then wants Gate 3. Round Robin q=1 interleaves them so the circular wait can form.";
    } else if (name == "mem-ref") {
        std::string which = c.option("string", "silberschatz");
        int frames = c.hasOption("frames") ? parseIntArg(c.option("frames", ""), "frames", 1, 16) : 3;
        std::vector<int> refs;
        if (which == "silberschatz") refs = {7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1};
        else if (which == "belady") refs = {1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5};
        else refs = parseIntList(which, "page number", 0, 99);
        resetWorld(6, 2, 2, frames);
        pthread_mutex_lock(&mtx);
        locked = true;
        memory.queueReferences(refs);
        scenarioName = "mem-ref " + which + " frames=" + std::to_string(frames);
        scenarioNote = "FIFO page replacement, one reference per tick. Expected faults with 3 frames: Silberschatz "
                       "string 15, Belady string 9 (and 10 with 4 frames: Belady's anomaly).";
    } else if (name == "disk-ref") {
        DiskAlgo algo = DiskAlgo::FCFS;
        if (!arg.empty() && !parseDiskAlgo(arg, algo)) throw CommandError("E_BAD_ARG", "disk algorithm must be FCFS, SSTF or SCAN");
        Direction dir = Direction::UP;
        if (c.hasOption("dir") && !parseDirection(toUpper(c.option("dir", "")), dir))
            throw CommandError("E_BAD_ARG", "direction must be UP or DOWN");
        resetWorld(6, 2, 2, 8);
        pthread_mutex_lock(&mtx);
        locked = true;
        storage.algo = algo;
        storage.direction = dir;
        storage.head = 20;
        for (int p : {5, 37, 12, 44, 21, 3}) storage.addRequest(DiskRequest{p, 0, 0, -1, bagSeq++});
        scenarioName = std::string("disk-ref ") + diskAlgoName(algo) + " " + directionName(dir);
        scenarioNote = "Baggage belt 0-49, cart (head) at 20, requests 5 37 12 44 21 3. Expected total movement: "
                       "FCFS 145, SSTF 60, SCAN UP 75, SCAN DOWN 64.";
    } else if (name == "contention") {
        resetWorld(6, 1, 1, 8);
        pthread_mutex_lock(&mtx);
        locked = true;
        for (ResourceInstance& r : resources.instances)
            if (r.cls == ResClass::GATE && r.id > "G3") r.enabled = false;  // G4..G6 closed
        createFlight("AI101", OpType::TURNAROUND, 2, 0, 0, nullptr);
        createFlight("6E202", OpType::TURNAROUND, 1, 0, 1, nullptr);
        createFlight("UK303", OpType::ARRIVAL, 3, 0, 2, nullptr);
        createFlight("SG404", OpType::DEPARTURE, 2, 0, 3, nullptr);
        createFlight("IX505", OpType::TURNAROUND, 4, 0, 4, nullptr);
        scenarioName = "contention";
        scenarioNote = "Busy apron: 5 flights share 3 gates, 1 fuel truck and 1 tug. Ground services run as "
                       "pthreads, baggage flows through the semaphore buffer and the child process plans the cart.";
    } else {
        throw CommandError("E_BAD_ARG", "unknown scenario (sched-ref, emergency, deadlock, mem-ref, disk-ref, contention)");
    }
    } catch (...) {
        if (locked) pthread_mutex_unlock(&mtx);
        throw;
    }

    emit("SCENARIO_LOADED", "Scenario loaded: " + scenarioName);
    publishSnapshot();
    std::string result = JsonWriter().beginObject().field("scenario", scenarioName).endObject().str();
    pthread_mutex_unlock(&mtx);
    return result;
}
