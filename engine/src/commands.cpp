// commands.cpp - the text command interface (one command per stdin line).
// Every command validates its arguments BEFORE changing anything, so an
// invalid command can never leave the simulation half-modified.
#include <fstream>
#include <sstream>
#include <unistd.h>

#include <cctype>
#include <cerrno>
#include <cstring>

#include "json.h"
#include "simulation.h"

namespace {
// Locks a pthread mutex for the lifetime of a scope (RAII), so that a thrown
// CommandError can never leave the simulation mutex locked.
class ScopedLock {
public:
    explicit ScopedLock(pthread_mutex_t& m) : mutex(m) { pthread_mutex_lock(&mutex); }
    ~ScopedLock() { pthread_mutex_unlock(&mutex); }
    ScopedLock(const ScopedLock&) = delete;
    ScopedLock& operator=(const ScopedLock&) = delete;

private:
    pthread_mutex_t& mutex;
};

bool parseOnOff(const std::string& text, bool& value) {
    if (text == "on") { value = true; return true; }
    if (text == "off") { value = false; return true; }
    return false;
}

const char* kHelp[] = {
    "flight create <NO> <TURNAROUND|ARRIVAL|DEPARTURE|CUSTOM> <prio 0-9> [burst=N] [arrive=T]",
    "flight abort <spid>",
    "sched set <FCFS|PRIORITY|RR> [q=1-20] [preempt=on|off]",
    "deadlock policy <PREVENTION|AVOIDANCE|DETECTION|RECOVERY> [action=PREEMPT|TERMINATE]",
    "deadlock banker-ref [request=0-3]",
    "mem set frames=<1-16> | mem ref <p1,p2,...> | mem xlate <spid> <page> <offset>",
    "disk set [algo=FCFS|SSTF|SCAN] [dir=UP|DOWN] [head=0-49] | disk req <p1,p2,...>",
    "sim run | sim pause | sim step [n] | sim speed <ms> | sim reset | sim run-until-quiet [max]",
    "scenario <sched-ref|emergency|deadlock|mem-ref|disk-ref|contention> [args]",
    "state | sys info | help | quit",
};
}  // namespace

std::string Simulation::handleCommand(const Command& c) {
    const std::string verb = c.word(0);
    if (verb == "quit") {
        quitFlag = true;
        return "{\"bye\":true}";
    }
    // These two reset the world, which joins threads, so they manage the lock themselves.
    if (verb == "scenario") return cmdScenario(c);
    if (verb == "sim" && c.word(1) == "reset") {
        resetWorld(6, 2, 2, 8);
        return "{\"reset\":true}";
    }

    ScopedLock lock(mtx);
    if (verb == "help") {
        JsonWriter w;
        w.beginObject().key("commands").beginArray();
        for (const char* line : kHelp) w.value(line);
        return w.endArray().endObject().str();
    }
    if (verb == "state") return snapshotJson();
    if (verb == "sys" && c.word(1) == "info") return cmdSysInfo();
    if (verb == "flight") return cmdFlight(c);
    if (verb == "sched") return cmdSched(c);
    if (verb == "deadlock") return cmdDeadlock(c);
    if (verb == "mem") return cmdMem(c);
    if (verb == "disk") return cmdDisk(c);
    if (verb == "sim") return cmdSim(c);
    if (verb == "debug") return cmdDebug(c);
    throw CommandError("E_UNKNOWN_CMD", "unknown command '" + verb + "' (try 'help')");
}

// ---------------------------------------------------------------- flights

Flight* Simulation::createFlight(const std::string& flightNo, OpType op, int priority, int burst, int arrive,
                                 const std::vector<Step>* customScript) {
    int active = (int)activeFlights().size();
    if (active >= 24) throw CommandError("E_LIMIT", "at most 24 active flights are allowed");
    for (Flight* f : flights)
        if (f->state != OsState::TERMINATED && f->flightNo == flightNo)
            throw CommandError("E_DUPLICATE_FLIGHT", "flight " + flightNo + " is already active");

    Flight* f = new Flight();
    f->spid = nextSpid;
    f->flightNo = flightNo;
    f->op = op;
    f->priority = priority;
    f->script = customScript ? *customScript : buildScript(op, burst);
    f->burst = cpuBurstOf(f->script);
    // A flight that arrives "in the past" is admitted at the next tick.
    int earliest = tickInProgress ? tick + 1 : tick;
    f->arrivalTick = arrive > earliest ? arrive : earliest;

    // Maximum claim (Banker's): every ACQUIRE in the script, plus the fuel
    // truck that a REFUEL service will request on the flight's behalf.
    for (const Step& s : f->script) {
        if (s.kind == StepKind::ACQUIRE) f->maxClaim[(int)s.resClass]++;
        if (s.kind == StepKind::SERVICES && s.refuel) f->maxClaim[(int)ResClass::FUEL_TRUCK]++;
    }
    for (int c = 0; c < kResClassCount; c++) {
        if (f->maxClaim[c] > resources.countEnabled((ResClass)c)) {
            delete f;
            throw CommandError("E_BAD_ARG", std::string("this airport has no open ") + resClassName((ResClass)c) +
                                                ", so the flight could never finish");
        }
    }

    pthread_cond_init(&f->wakeup, nullptr);
    FlightThreadArgs* args = new FlightThreadArgs{this, f};
    int rc = pthread_create(&f->thread, nullptr, flightThreadMain, args);
    if (rc != 0) {
        delete args;
        pthread_cond_destroy(&f->wakeup);
        delete f;
        throw CommandError("E_INTERNAL", std::string("pthread_create failed: ") + std::strerror(rc));
    }
    f->threadStarted = true;
    nextSpid++;
    flights.push_back(f);

    JsonWriter w;
    w.beginObject().field("spid", f->spid).field("flight_no", f->flightNo).field("op", opTypeName(op));
    w.field("priority", priority).field("arrival", f->arrivalTick).field("burst", f->burst).endObject();
    emit("FLIGHT_CREATED", "Flight " + flightNo + " created as SPID " + std::to_string(f->spid) + " (" +
                               opTypeName(op) + ", priority " + std::to_string(priority) + ", burst " +
                               std::to_string(f->burst) + ")", w.str());
    return f;
}

std::string Simulation::cmdFlight(const Command& c) {
    const std::string sub = c.word(1);
    if (sub == "create") {
        std::string number = toUpper(c.word(2));
        if (number.size() < 2 || number.size() > 8)
            throw CommandError("E_BAD_ARG", "flight number must be 2 to 8 characters (e.g. AI101)");
        for (char ch : number)
            if (!std::isalnum((unsigned char)ch) && ch != '-')
                throw CommandError("E_BAD_ARG", "flight number may only contain letters, digits and '-'");
        OpType op;
        if (!parseOpType(toUpper(c.word(3)), op))
            throw CommandError("E_BAD_ARG", "operation type must be TURNAROUND, ARRIVAL, DEPARTURE or CUSTOM");
        int priority = parseIntArg(c.word(4), "priority", 0, 9);
        int burst = 0;
        if (op == OpType::CUSTOM) burst = parseIntArg(c.option("burst", ""), "burst (required for CUSTOM)", 1, 50);
        else if (c.hasOption("burst"))
            throw CommandError("E_BAD_ARG", "burst is fixed by the operation script; use CUSTOM for a manual burst");
        int arrive = c.hasOption("arrive") ? parseIntArg(c.option("arrive", ""), "arrival tick", 0, 10000) : 0;

        Flight* f = createFlight(number, op, priority, burst, arrive, nullptr);
        publishSnapshot();
        return JsonWriter().beginObject().field("spid", f->spid).field("arrival", f->arrivalTick)
            .field("burst", f->burst).endObject().str();
    }
    if (sub == "abort") {
        int spid = parseIntArg(c.word(2), "spid", 1, 100000);
        Flight* f = findFlight(spid);
        if (!f) throw CommandError("E_UNKNOWN_FLIGHT", "no flight with SPID " + std::to_string(spid));
        if (f->state == OsState::TERMINATED) throw CommandError("E_FLIGHT_DONE", f->flightNo + " has already terminated");
        if (f->servicesRunning)
            throw CommandError("E_STATE", f->flightNo + " has ground-service threads running; abort it after they finish");
        if (tickInProgress) throw CommandError("E_BUSY", "a tick is being processed; try again");
        abortFlight(f, "aborted by the operator");
        publishSnapshot();
        return JsonWriter().beginObject().field("spid", spid).field("status", "ABORTED").endObject().str();
    }
    throw CommandError("E_UNKNOWN_CMD", "usage: flight create ... | flight abort <spid>");
}

// ---------------------------------------------------------------- scheduler

std::string Simulation::cmdSched(const Command& c) {
    if (c.word(1) != "set") throw CommandError("E_UNKNOWN_CMD", "usage: sched set <FCFS|PRIORITY|RR> [q=N] [preempt=on|off]");
    SchedConfig cfg = dispatcher.config;
    if (!parseSchedAlgo(toUpper(c.word(2)), cfg.algo))
        throw CommandError("E_BAD_ARG", "algorithm must be FCFS, PRIORITY or RR");
    if (c.hasOption("q")) cfg.quantum = parseIntArg(c.option("q", ""), "quantum", 1, 20);
    if (c.hasOption("preempt") && !parseOnOff(c.option("preempt", ""), cfg.preemptive))
        throw CommandError("E_BAD_ARG", "preempt must be on or off");
    if (cfg.algo != SchedAlgo::PRIORITY) cfg.preemptive = false;

    dispatcher.config = cfg;
    std::string label = std::string(schedAlgoName(cfg.algo)) +
                        (cfg.algo == SchedAlgo::RR ? " q=" + std::to_string(cfg.quantum) : "") +
                        (cfg.preemptive ? " preemptive" : "");
    schedChanges.push_back({tick, label});
    emit("SCHED_CHANGED", "Scheduler set to " + label + " (applies from the next tick)");
    publishSnapshot();
    return JsonWriter().beginObject().field("config", label).endObject().str();
}

// ---------------------------------------------------------------- deadlock

void Simulation::requireNoResourcesInUse(const std::string& what) const {
    for (const ResourceInstance& r : resources.instances)
        if (r.ownerSpid != -1)
            throw CommandError("E_BUSY", what + " cannot change while resources are allocated (reset first)");
    if (!resources.pending.empty())
        throw CommandError("E_BUSY", what + " cannot change while requests are pending (reset first)");
}

std::string Simulation::cmdDeadlock(const Command& c) {
    const std::string sub = c.word(1);
    if (sub == "policy") {
        DeadlockPolicy policy;
        if (!parsePolicy(toUpper(c.word(2)), policy))
            throw CommandError("E_BAD_ARG", "policy must be PREVENTION, AVOIDANCE, DETECTION or RECOVERY");
        RecoveryAction action = deadlock.action;
        if (c.hasOption("action") && !parseRecoveryAction(toUpper(c.option("action", "")), action))
            throw CommandError("E_BAD_ARG", "action must be PREEMPT or TERMINATE");
        requireNoResourcesInUse("the deadlock policy");
        deadlock.policy = policy;
        deadlock.action = action;
        emit("POLICY_CHANGED", std::string("Deadlock policy set to ") + policyName(policy));
        publishSnapshot();
        return JsonWriter().beginObject().field("policy", policyName(policy)).endObject().str();
    }
    if (sub == "banker-ref") {
        int request = c.hasOption("request") ? parseIntArg(c.option("request", ""), "request", 0, 3) : 0;
        return bankerReferenceJson(request);
    }
    throw CommandError("E_UNKNOWN_CMD", "usage: deadlock policy <P> [action=A] | deadlock banker-ref [request=N]");
}

// ---------------------------------------------------------------- memory

std::string Simulation::cmdMem(const Command& c) {
    const std::string sub = c.word(1);
    if (sub == "set") {
        int frames = parseIntArg(c.option("frames", ""), "frames", 1, 16);
        if (!activeFlights().empty() || memory.hasQueuedReference())
            throw CommandError("E_BUSY", "the frame count can only change when no flight is active (reset first)");
        memory.reset(frames);
        emit("MEM_CONFIG", "Memory reset with " + std::to_string(frames) + " frames");
        publishSnapshot();
        return JsonWriter().beginObject().field("frames", frames).endObject().str();
    }
    if (sub == "ref") {
        std::vector<int> pages = parseIntList(c.word(2), "page number", 0, 99);
        memory.queueReferences(pages);
        emit("MEM_REFERENCES", std::to_string(pages.size()) + " page references queued (one per tick)");
        publishSnapshot();
        return JsonWriter().beginObject().field("queued", (int)pages.size()).endObject().str();
    }
    if (sub == "xlate") {
        int spid = parseIntArg(c.word(2), "spid", 0, 100000);
        int vpn = parseIntArg(c.word(3), "page", 0, 99);
        int offset = parseIntArg(c.word(4), "offset", 0, MemoryManager::kPageSize - 1);
        int frame = memory.pager.frameOf(MemoryManager::pageKey(spid, vpn));
        JsonWriter w;
        w.beginObject().field("spid", spid).field("page", vpn).field("offset", offset);
        w.field("logical", vpn * MemoryManager::kPageSize + offset).field("resident", frame >= 0);
        if (frame >= 0) w.field("frame", frame).field("physical", translateAddress(frame, offset, MemoryManager::kPageSize));
        return w.endObject().str();
    }
    throw CommandError("E_UNKNOWN_CMD", "usage: mem set frames=N | mem ref p1,p2,... | mem xlate spid page offset");
}

// ---------------------------------------------------------------- disk

std::string Simulation::cmdDisk(const Command& c) {
    const std::string sub = c.word(1);
    if (sub == "set") {
        DiskAlgo algo = storage.algo;
        Direction dir = storage.direction;
        int head = storage.head;
        if (c.hasOption("algo") && !parseDiskAlgo(toUpper(c.option("algo", "")), algo))
            throw CommandError("E_BAD_ARG", "disk algorithm must be FCFS, SSTF or SCAN");
        if (c.hasOption("dir") && !parseDirection(toUpper(c.option("dir", "")), dir))
            throw CommandError("E_BAD_ARG", "direction must be UP or DOWN");
        if (c.hasOption("head")) head = parseIntArg(c.option("head", ""), "head position", storage.minCyl, storage.maxCyl);
        if (storage.busy || storageRequestInFlight || !storage.waiting.empty())
            throw CommandError("E_BUSY", "the cart is serving requests; change settings when the queue is empty");
        storage.algo = algo;
        storage.direction = dir;
        storage.head = head;
        emit("DISK_CONFIG", std::string("Disk scheduling set to ") + diskAlgoName(algo) + ", direction " +
                                directionName(dir) + ", head " + std::to_string(head));
        publishSnapshot();
        return JsonWriter().beginObject().field("algo", diskAlgoName(algo)).field("head", head).endObject().str();
    }
    if (sub == "req") {
        std::vector<int> positions = parseIntList(c.word(2), "belt position", storage.minCyl, storage.maxCyl);
        int stamp = tickInProgress ? tick : tick - 1;  // ready to be batched at the next resolve
        for (int p : positions) storage.addRequest(DiskRequest{p, 0, 0, stamp, bagSeq++});
        emit("DISK_REQ_ADDED", std::to_string(positions.size()) + " baggage requests added to the queue");
        publishSnapshot();
        return JsonWriter().beginObject().field("queued", (int)positions.size()).endObject().str();
    }
    throw CommandError("E_UNKNOWN_CMD", "usage: disk set [algo=] [dir=] [head=] | disk req p1,p2,...");
}

// ---------------------------------------------------------------- simulation control

void Simulation::waitUntilIdle() {
    while (fastRun && !shuttingDown) pthread_cond_wait(&idleCv, &mtx);
}

std::string Simulation::cmdSim(const Command& c) {
    const std::string sub = c.word(1);
    if (sub == "run") {
        running = true;
        pthread_cond_broadcast(&controlCv);
    } else if (sub == "pause") {
        running = false;
        stepBudget = 0;
        pthread_cond_broadcast(&controlCv);
    } else if (sub == "step") {
        int n = c.word(2).empty() ? 1 : parseIntArg(c.word(2), "step count", 1, 200);
        if (running) throw CommandError("E_STATE", "pause the simulation before stepping");
        stepBudget += n;
        pthread_cond_broadcast(&controlCv);
    } else if (sub == "speed") {
        tickMs = parseIntArg(c.word(2), "tick length in ms", 0, 2000);
        pthread_cond_broadcast(&controlCv);
    } else if (sub == "run-until-quiet") {
        int limit = c.word(2).empty() ? 500 : parseIntArg(c.word(2), "tick limit", 1, 5000);
        running = false;
        stepBudget = 0;
        fastRun = true;
        fastRunLimit = limit;
        pthread_cond_broadcast(&controlCv);
        waitUntilIdle();  // the clock runs the ticks with no delay, then wakes us
    } else {
        throw CommandError("E_UNKNOWN_CMD", "usage: sim run|pause|step [n]|speed <ms>|reset|run-until-quiet [max]");
    }
    if (sub != "run-until-quiet") publishSnapshot();
    return JsonWriter().beginObject().field("tick", tick).field("running", running).field("tick_ms", tickMs)
        .field("quiet", isQuiet()).endObject().str();
}

// ---------------------------------------------------------------- real OS information

static int threadCountFromProc() {
    std::ifstream status("/proc/self/status");
    std::string line;
    while (std::getline(status, line))
        if (line.rfind("Threads:", 0) == 0) return std::stoi(line.substr(8));
    return -1;
}

std::string Simulation::cmdSysInfo() {
    child.checkIfExited();
    ipcStatus = child.status;
    JsonWriter w;
    w.beginObject().field("engine_pid", (int)getpid()).field("child_pid", (int)child.childPid);
    w.field("child_status", child.status).field("child_exit", child.exitDescription);
    w.field("request_fd", child.requestWriteFd).field("result_fd", child.resultReadFd);
    w.field("threads", threadCountFromProc());
    w.key("tids").beginArray().value(mainTid).value(clockTid).value(intakeTid);
    for (Flight* f : flights)
        if (f->threadStarted && !f->threadExited) w.value(f->tid);
    for (ServiceTask* t : tasks)
        if (!t->joined) w.value(t->tid);
    w.endArray();
    return w.endObject().str();
}

std::string Simulation::cmdDebug(const Command& c) {
    if (c.word(1) != "intake" || (c.word(2) != "hold" && c.word(2) != "release"))
        throw CommandError("E_UNKNOWN_CMD", "usage: debug intake hold|release");
    intakeHeld = c.word(2) == "hold";
    pthread_cond_broadcast(&holdCv);
    pthread_cond_broadcast(&intakeCv);
    publishSnapshot();
    return JsonWriter().beginObject().field("intake_held", intakeHeld).endObject().str();
}
