// simulation.cpp - construction, the clock thread and the first half of a tick
// (admission, CPU dispatch, giving turns to the participant threads).
#include "simulation.h"

#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <ctime>

#include "json.h"

long currentThreadId() { return (long)syscall(SYS_gettid); }  // the TID that `ps -T` shows

Simulation::Simulation(Output& out, BaggageHandlerProcess& baggageChild) : output(out), child(baggageChild) {
    pthread_mutex_init(&mtx, nullptr);
    pthread_cond_init(&ackCv, nullptr);
    pthread_cond_init(&controlCv, nullptr);
    pthread_cond_init(&idleCv, nullptr);
    pthread_cond_init(&intakeCv, nullptr);
    pthread_cond_init(&holdCv, nullptr);
    mainTid = currentThreadId();
}

Simulation::~Simulation() {
    pthread_cond_destroy(&ackCv);
    pthread_cond_destroy(&controlCv);
    pthread_cond_destroy(&idleCv);
    pthread_cond_destroy(&intakeCv);
    pthread_cond_destroy(&holdCv);
    pthread_mutex_destroy(&mtx);
}

void Simulation::start() {
    epoch = -1;  // resetWorld increments it to 0
    resetWorld(6, 2, 2, 8);
}

void Simulation::shutdown() {
    stopWorkerThreads();
    freeEpochObjects();
}

// ---------------------------------------------------------------- clock thread

void Simulation::clockLoop() {
    pthread_mutex_lock(&mtx);
    clockTid = currentThreadId();
    while (!shuttingDown) {
        // Paused: sleep until "sim run", "sim step" or "sim run-until-quiet".
        while (!shuttingDown && !running && stepBudget == 0 && !fastRun) pthread_cond_wait(&controlCv, &mtx);
        if (shuttingDown) break;

        runOneTick();
        if (shuttingDown) break;

        if (stepBudget > 0) stepBudget--;
        bool quiet = isQuiet();
        if (fastRun) {
            if (quiet || --fastRunLimit <= 0) {
                fastRun = false;
                publishSnapshot();
                pthread_cond_broadcast(&idleCv);  // wake the waiting "run-until-quiet" command
            }
            continue;
        }
        if (running && quiet) {
            running = false;  // auto-pause: nothing left that can make progress
            emit("SIM_IDLE", "Simulation paused: no flight can make further progress");
            publishSnapshot();
        }
        if (running && stepBudget == 0 && tickMs > 0) {
            // Sleep tickMs, but wake early if paused, reset or asked to step.
            timespec deadline;
            clock_gettime(CLOCK_REALTIME, &deadline);
            long ns = deadline.tv_nsec + (long)tickMs * 1000000L;
            deadline.tv_sec += ns / 1000000000L;
            deadline.tv_nsec = ns % 1000000000L;
            while (running && !shuttingDown && stepBudget == 0 && !fastRun) {
                if (pthread_cond_timedwait(&controlCv, &mtx, &deadline) == ETIMEDOUT) break;
            }
        }
    }
    pthread_mutex_unlock(&mtx);
}

void Simulation::runOneTick() {
    tickInProgress = true;
    newBlockThisTick = false;
    intents.clear();

    joinFinishedThreads();
    admitArrivals();
    dispatchCpu();
    runParticipants();  // releases mtx while the participants execute their steps
    if (shuttingDown) return;

    resolveTick();
    tick++;
    tickInProgress = false;
    if (!fastRun) publishSnapshot();
}

// NEW -> READY for every flight whose arrival time has come (SPID order).
void Simulation::admitArrivals() {
    for (Flight* f : flights) {
        if (f->state != OsState::NEW || f->arrivalTick > tick) continue;
        makeReady(f);
        memory.touch(f->spid, 0, tick, "flight plan loaded on admission");
        emit("FLIGHT_ADMITTED", f->flightNo + " entered the ready queue",
             JsonWriter().beginObject().field("spid", f->spid).endObject().str());
    }
}

void Simulation::dispatchCpu() {
    TickDecision d = dispatcher.chooseForTick();

    if (d.expiredSpid != -1) {
        Flight* f = findFlight(d.expiredSpid);
        f->state = OsState::READY;
        emit("QUANTUM_EXPIRED", f->flightNo + " used its " + std::to_string(dispatcher.config.quantum) +
                                    "-tick quantum and moved to the tail of the ready queue",
             JsonWriter().beginObject().field("spid", f->spid).endObject().str());
    }
    if (d.preemptedSpid != -1) {
        Flight* f = findFlight(d.preemptedSpid);
        f->state = OsState::READY;
        emit("PREEMPTED", f->flightNo + " was preempted by a higher-priority flight",
             JsonWriter().beginObject().field("spid", f->spid).endObject().str());
    }
    if (d.runningSpid != -1) {
        Flight* f = findFlight(d.runningSpid);
        f->state = OsState::RUNNING;
        if (f->firstDispatch < 0) f->firstDispatch = tick;
        if (d.newDispatch)
            emit("DISPATCHED", std::string(schedAlgoName(dispatcher.config.algo)) + " dispatched " + f->flightNo,
                 JsonWriter().beginObject().field("spid", f->spid).endObject().str());
    }
    timeline.push_back(d.runningSpid);

    // Waiting time = ticks spent READY (in the queue but not on the CPU).
    for (Flight* f : flights) {
        if (f->state == OsState::READY) f->readyTicks++;
        if (f->state == OsState::BLOCKED) f->blockedTicks++;
    }
}

// Gives this tick's turn to the running flight and every active service task,
// then waits until all of them have acknowledged.
void Simulation::runParticipants() {
    std::vector<pthread_cond_t*> wake;
    if (dispatcher.running() != -1) {
        Flight* f = findFlight(dispatcher.running());
        f->hasTurn = true;
        wake.push_back(&f->wakeup);
    }
    for (ServiceTask* t : tasks) {
        if (t->state == TaskState::NEW || t->state == TaskState::WORKING || t->state == TaskState::FINISHING) {
            t->hasTurn = true;
            wake.push_back(&t->wakeup);
        }
    }
    pendingAcks = (int)wake.size();
    for (pthread_cond_t* cv : wake) pthread_cond_signal(cv);

    while (pendingAcks > 0 && !shuttingDown) pthread_cond_wait(&ackCv, &mtx);
}

void Simulation::acknowledgeTurn() {
    pendingAcks--;
    if (pendingAcks == 0) pthread_cond_signal(&ackCv);
}

// A flight thread that has finished is joined here (pthread_join), so that
// finished flights do not leave zombie threads behind.
void Simulation::joinFinishedThreads() {
    for (Flight* f : flights) {
        if (f->threadStarted && f->threadExited && !f->threadJoined) {
            pthread_join(f->thread, nullptr);
            f->threadJoined = true;
        }
    }
}

bool Simulation::isQuiet() const {
    for (Flight* f : flights)
        if (f->state == OsState::NEW || f->state == OsState::READY || f->state == OsState::RUNNING) return false;
    for (ServiceTask* t : tasks)
        if (t->state != TaskState::DONE && t->state != TaskState::WAITING_GRANT) return false;
    if (storage.busy || !storage.waiting.empty() || memory.hasQueuedReference()) return false;
    if (bagsConsumed < bagsProduced) return false;
    return true;
}

// ---------------------------------------------------------------- helpers

Flight* Simulation::findFlight(int spid) const {
    for (Flight* f : flights)
        if (f->spid == spid) return f;
    return nullptr;
}

ServiceTask* Simulation::findTask(int taskId) const {
    for (ServiceTask* t : tasks)
        if (t->taskId == taskId) return t;
    return nullptr;
}

std::vector<Flight*> Simulation::activeFlights() const {
    std::vector<Flight*> active;
    for (Flight* f : flights)
        if (f->state != OsState::TERMINATED) active.push_back(f);
    return active;
}

std::string Simulation::flightName(int spid) const {
    Flight* f = findFlight(spid);
    return f ? f->flightNo : (spid == 0 ? "REF" : "SPID " + std::to_string(spid));
}

void Simulation::makeReady(Flight* f) {
    f->state = OsState::READY;
    f->blockReason.clear();
    dispatcher.makeReady(ReadyEntry{f->spid, f->priority, f->arrivalTick});
}

void Simulation::addIntent(Intent::Kind kind, int spid, int task, Phase phase, ResClass cls, int vpn) {
    intents.push_back(Intent{kind, spid, task, ++intentSeq, phase, cls, vpn});
}

void Simulation::emit(const std::string& kind, const std::string& message, const std::string& dataJson) {
    EventRecord record{++eventSeq, tick, kind, message, dataJson};
    recentEvents.push_back(record);
    if (recentEvents.size() > 80) recentEvents.erase(recentEvents.begin());

    JsonWriter w;
    w.beginObject().field("type", "event").field("epoch", epoch).field("seq", record.seq).field("tick", tick);
    w.field("kind", kind).field("msg", message).key("data").raw(dataJson).endObject();
    output.writeLine(w.str());
}

void Simulation::publishSnapshot() {
    version++;
    output.writeLine(snapshotJson());
}
