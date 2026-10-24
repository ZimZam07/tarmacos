// workers.cpp - the code that runs inside the POSIX threads.
//
// Every worker follows the same pattern (Assignment 5, Q4/Q7):
//     pthread_mutex_lock(&mtx);
//     while (!myTurn && !shutdown) pthread_cond_wait(&myCv, &mtx);
//     ... do one step ...
//     acknowledge; pthread_mutex_unlock(&mtx);
// pthread_cond_wait releases mtx while sleeping and re-acquires it before
// returning, so a blocked flight never stops other threads from working.
#include <unistd.h>

#include <algorithm>

#include "json.h"
#include "simulation.h"

long currentThreadId();

const char* serviceKindName(ServiceKind kind) { return kind == ServiceKind::REFUEL ? "REFUEL" : "BAGGAGE"; }

const char* taskStateName(TaskState state) {
    switch (state) {
        case TaskState::NEW: return "NEW";
        case TaskState::WAITING_GRANT: return "WAITING_GRANT";
        case TaskState::WORKING: return "WORKING";
        case TaskState::WAITING_BAGS: return "WAITING_BAGS";
        case TaskState::FINISHING: return "FINISHING";
        case TaskState::DONE: return "DONE";
    }
    return "?";
}

// ---------------- thread entry points (pthread_create needs void* (*)(void*)) ----------------

void* clockThreadMain(void* sim) {
    static_cast<Simulation*>(sim)->clockLoop();
    return nullptr;
}

void* intakeThreadMain(void* sim) {
    static_cast<Simulation*>(sim)->intakeLoop();
    return nullptr;
}

void* flightThreadMain(void* arg) {
    FlightThreadArgs* args = static_cast<FlightThreadArgs*>(arg);
    Simulation* sim = args->sim;
    Flight* flight = args->flight;
    delete args;  // the arguments were heap-allocated by the creating thread
    sim->flightLoop(flight);
    return nullptr;
}

void* serviceThreadMain(void* arg) {
    ServiceTask* task = static_cast<ServiceTask*>(arg);  // struct argument (Assignment 5 Q2)
    task->sim->serviceLoop(task);
    // Return a heap-allocated result to whoever calls pthread_join (Assignment 5 Q10).
    ServiceResult* result = new ServiceResult{task->waitTicks, task->workTicks, task->bagsServed};
    pthread_exit(result);
}

// ---------------- flight threads ----------------

void Simulation::flightLoop(Flight* f) {
    pthread_mutex_lock(&mtx);
    f->tid = currentThreadId();
    while (true) {
        // Sleep until the dispatcher gives this flight the CPU for one tick.
        while (!f->hasTurn && !shuttingDown && !f->abortRequested) pthread_cond_wait(&f->wakeup, &mtx);
        if (shuttingDown || f->abortRequested) break;

        f->hasTurn = false;
        bool finished = executeFlightStep(f);
        acknowledgeTurn();
        if (finished) break;
    }
    f->threadExited = true;  // joined later by the clock thread or by reset
    pthread_mutex_unlock(&mtx);
}

// Phase markers take no CPU time; they are applied together with the next step.
void Simulation::applyPhaseMarkers(Flight* f) {
    while (f->stepIndex < f->script.size() && f->script[f->stepIndex].kind == StepKind::PHASE) {
        addIntent(Intent::PHASE, f->spid, 0, f->script[f->stepIndex].phase);
        addIntent(Intent::TOUCH, f->spid, 0, Phase::CREATED, ResClass::GATE, 0);
        f->stepIndex++;
    }
}

static bool onlyPhasesLeft(const Flight* f) {
    for (size_t i = f->stepIndex; i < f->script.size(); i++)
        if (f->script[i].kind != StepKind::PHASE) return false;
    return true;
}

// Executes ONE step of the flight's script (one CPU tick). Shared state is not
// changed here: the step only records intents for the resolve phase.
// Returns true when the script is complete and the thread should exit.
bool Simulation::executeFlightStep(Flight* f) {
    if (f->servicesRunning) joinServices(f);  // services finished while we were BLOCKED
    applyPhaseMarkers(f);
    if (f->stepIndex >= f->script.size()) {
        addIntent(Intent::FINISH, f->spid, 0);
        return true;
    }

    const Step& step = f->script[f->stepIndex];
    f->cpuUsed++;
    switch (step.kind) {
        case StepKind::ACQUIRE:
            // The step index moves on only when the request is GRANTED.
            addIntent(Intent::REQUEST, f->spid, 0, Phase::CREATED, step.resClass);
            addIntent(Intent::TOUCH, f->spid, 0, Phase::CREATED, ResClass::GATE, 1);
            f->waitingForGrant = true;
            return false;
        case StepKind::WORK:
            if (++f->workDone >= step.amount) {
                f->stepIndex++;
                f->workDone = 0;
            }
            break;
        case StepKind::SERVICES:
            startServices(f);
            addIntent(Intent::START_SERVICES, f->spid, 0);
            return false;  // the step index moves on after joinServices()
        case StepKind::RELEASE_ALL:
            addIntent(Intent::RELEASE_ALL, f->spid, 0);
            addIntent(Intent::TOUCH, f->spid, 0, Phase::CREATED, ResClass::GATE, 1);
            f->stepIndex++;
            break;
        case StepKind::PHASE:
            break;  // already handled by applyPhaseMarkers
    }

    if (onlyPhasesLeft(f)) {
        applyPhaseMarkers(f);
        addIntent(Intent::FINISH, f->spid, 0);
        return true;
    }
    return false;
}

// Creates one pthread per ground service. Each thread receives a pointer to
// its ServiceTask structure as the pthread_create argument.
void Simulation::startServices(Flight* f) {
    const Step& step = f->script[f->stepIndex];
    std::vector<ServiceKind> kinds;
    if (step.refuel) kinds.push_back(ServiceKind::REFUEL);
    if (step.baggage) kinds.push_back(ServiceKind::BAGGAGE);

    for (ServiceKind kind : kinds) {
        ServiceTask* t = new ServiceTask();
        t->taskId = nextTaskId++;
        t->ownerSpid = f->spid;
        t->kind = kind;
        t->gatePosition = f->gatePosition >= 0 ? f->gatePosition : 0;
        t->startTick = tick;
        t->sim = this;
        pthread_cond_init(&t->wakeup, nullptr);
        int rc = pthread_create(&t->thread, nullptr, serviceThreadMain, t);
        if (rc != 0) {
            // Without a thread the service cannot run; mark it done so the flight is not stuck forever.
            t->state = TaskState::DONE;
            t->joined = true;
            emit("ERROR", "pthread_create failed for a ground service of " + f->flightNo);
        }
        tasks.push_back(t);
        f->services.push_back(t);
    }
    f->servicesRunning = true;
}

// Collects the result of every service thread with pthread_join. mtx is
// released during the join because the service threads may still need it
// for their last few instructions.
void Simulation::joinServices(Flight* f) {
    std::vector<ServiceTask*> toJoin;
    for (ServiceTask* t : f->services)
        if (!t->joined) toJoin.push_back(t);

    pthread_mutex_unlock(&mtx);
    std::vector<ServiceResult> results;
    for (ServiceTask* t : toJoin) {
        void* returned = nullptr;
        pthread_join(t->thread, &returned);
        ServiceResult* r = static_cast<ServiceResult*>(returned);
        results.push_back(r ? *r : ServiceResult{0, 0, 0});
        delete r;
    }
    pthread_mutex_lock(&mtx);

    for (size_t i = 0; i < toJoin.size(); i++) {
        ServiceTask* t = toJoin[i];
        t->joined = true;
        JsonWriter w;
        w.beginObject().field("spid", f->spid).field("task", t->taskId).field("service", serviceKindName(t->kind));
        w.field("wait_ticks", results[i].waitTicks).field("work_ticks", results[i].workTicks);
        w.field("bags", results[i].bagsDelivered).endObject();
        emit("THREAD_JOINED", "pthread_join collected the " + std::string(serviceKindName(t->kind)) +
                                  " worker of " + f->flightNo, w.str());
    }
    f->servicesRunning = false;
    f->stepIndex++;  // past the SERVICES step
}

// ---------------- ground-service threads ----------------

void Simulation::serviceLoop(ServiceTask* t) {
    pthread_mutex_lock(&mtx);
    t->tid = currentThreadId();
    while (true) {
        while (!t->hasTurn && !shuttingDown) pthread_cond_wait(&t->wakeup, &mtx);
        if (shuttingDown) break;
        t->hasTurn = false;
        executeServiceStep(t);
        acknowledgeTurn();
        if (t->state == TaskState::DONE) break;
    }
    pthread_mutex_unlock(&mtx);
}

void Simulation::executeServiceStep(ServiceTask* t) {
    switch (t->state) {
        case TaskState::NEW:
            if (t->kind == ServiceKind::REFUEL) {
                addIntent(Intent::REQUEST, t->ownerSpid, t->taskId, Phase::CREATED, ResClass::FUEL_TRUCK);
                t->state = TaskState::WAITING_GRANT;
            } else {
                produceBags(t);
                if (!shuttingDown) {
                    addIntent(Intent::TOUCH, t->ownerSpid, t->taskId, Phase::CREATED, ResClass::GATE, 3);
                    t->state = TaskState::WAITING_BAGS;
                }
            }
            break;
        case TaskState::WORKING:
            t->workLeft--;
            t->workTicks++;
            addIntent(Intent::TOUCH, t->ownerSpid, t->taskId, Phase::CREATED, ResClass::GATE, 2);
            if (t->workLeft == 0) {
                addIntent(Intent::RELEASE_TASK, t->ownerSpid, t->taskId);
                t->state = TaskState::DONE;
            }
            break;
        case TaskState::FINISHING:
            t->state = TaskState::DONE;
            break;
        default:
            break;
    }
}

// PRODUCER side of the bounded buffer. mtx is released first, because
// sem_wait(emptySlots) may block until the intake thread frees a slot.
void Simulation::produceBags(ServiceTask* t) {
    std::vector<BagItem> bags;
    int positions[3] = {t->gatePosition, (t->gatePosition + 17) % 50, (t->gatePosition + 33) % 50};
    for (int i = 0; i < t->bagsTotal && i < 3; i++)
        bags.push_back(BagItem{positions[i], t->ownerSpid, t->taskId, tick, bagSeq++});
    bagsProduced += (int)bags.size();  // counted now, so resolve knows how many to wait for
    t->producingBags = true;

    for (const BagItem& bag : bags) {
        t->blockedOnFullBuffer = buffer.emptyCount() == 0;  // for the Sync view only
        pthread_mutex_unlock(&mtx);
        bool ok = buffer.produce(bag);  // may block in sem_wait()
        pthread_mutex_lock(&mtx);
        t->blockedOnFullBuffer = false;
        if (!ok || shuttingDown) break;
    }
    t->producingBags = false;
}

// ---------------- intake thread (CONSUMER of the bounded buffer) ----------------

void Simulation::intakeLoop() {
    pthread_mutex_lock(&mtx);
    intakeTid = currentThreadId();
    pthread_mutex_unlock(&mtx);

    while (true) {
        pthread_mutex_lock(&mtx);
        while (intakeHeld && !shuttingDown) pthread_cond_wait(&holdCv, &mtx);  // debug hold only
        bool stop = shuttingDown;
        pthread_mutex_unlock(&mtx);
        if (stop) break;

        BagItem bag;
        if (!buffer.consume(bag)) break;  // blocks in sem_wait(fullSlots) while empty

        pthread_mutex_lock(&mtx);
        storage.addRequest(DiskRequest{bag.position, bag.ownerSpid, bag.task, bag.stampTick, bag.seq});
        bagsConsumed++;
        pthread_cond_broadcast(&intakeCv);
        pthread_mutex_unlock(&mtx);
    }
}
