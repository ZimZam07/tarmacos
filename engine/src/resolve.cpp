// resolve.cpp - the second half of a tick. Runs in the clock thread with mtx
// held, after every participant has finished its step.
#include <algorithm>

#include "json.h"
#include "simulation.h"

static std::string spidData(int spid) { return JsonWriter().beginObject().field("spid", spid).endObject().str(); }

void Simulation::resolveTick() {
    // 1. Apply the intents in a FIXED order so that thread timing cannot change the result.
    std::sort(intents.begin(), intents.end(), [](const Intent& a, const Intent& b) {
        if (a.spid != b.spid) return a.spid < b.spid;
        if (a.task != b.task) return a.task < b.task;
        return a.seq < b.seq;
    });
    for (const Intent& intent : intents) applyIntent(intent);
    intents.clear();

    // 2. Allocation decisions under the selected deadlock policy.
    grantPendingRequests();
    if ((deadlock.policy == DeadlockPolicy::DETECTION || deadlock.policy == DeadlockPolicy::RECOVERY) &&
        newBlockThisTick)
        runDetectionAndRecovery();
    requeueDeferredFlights();

    // 3. Memory reference preset, baggage cart, services, invariants.
    advanceMemoryReference();
    advanceStorage();
    if (shuttingDown) return;
    updateServiceProgress();
    checkInvariants();
}

void Simulation::applyIntent(const Intent& in) {
    Flight* f = findFlight(in.spid);
    if (!f || f->state == OsState::TERMINATED) return;  // e.g. aborted earlier in this tick

    switch (in.kind) {
        case Intent::PHASE:
            f->phase = in.phase;
            emit("PHASE_CHANGED", f->flightNo + " is now " + phaseName(in.phase),
                 JsonWriter().beginObject().field("spid", f->spid).field("phase", phaseName(in.phase)).endObject().str());
            break;
        case Intent::REQUEST: {
            resources.pending.push_back(PendingRequest{in.spid, in.task, in.cls, tick, (int)in.seq, ""});
            std::string who = in.task ? f->flightNo + " (refuel worker)" : f->flightNo;
            emit("RES_REQUESTED", who + " requested a " + resClassName(in.cls),
                 JsonWriter().beginObject().field("spid", in.spid).field("task", in.task)
                     .field("class", resClassName(in.cls)).endObject().str());
            break;
        }
        case Intent::RELEASE_ALL:
            releaseResourcesOf(in.spid, -1);
            break;
        case Intent::RELEASE_TASK:
            releaseResourcesOf(in.spid, in.task);
            break;
        case Intent::START_SERVICES: {
            f->state = OsState::BLOCKED;
            f->blockReason = "waiting for ground services";
            if (dispatcher.running() == f->spid) dispatcher.releaseCpu();
            JsonWriter w;
            w.beginObject().field("spid", f->spid).key("tasks").beginArray();
            for (ServiceTask* t : f->services) w.value(t->taskId);
            w.endArray().endObject();
            emit("SERVICES_STARTED", f->flightNo + " started " + std::to_string(f->services.size()) +
                                         " ground-service thread(s) and is BLOCKED until they finish", w.str());
            break;
        }
        case Intent::TOUCH: {
            PageAccess a = memory.touch(in.spid, in.vpn, tick, MemoryManager::pageName(in.vpn));
            if (!a.hit) {
                std::string msg = "Page fault: " + f->flightNo + " page " + std::to_string(in.vpn) + " (" +
                                  MemoryManager::pageName(in.vpn) + ") loaded into frame " + std::to_string(a.frame);
                if (a.evicted >= 0)
                    msg += ", FIFO evicted " + flightName(a.evicted / 100) + " page " + std::to_string(a.evicted % 100);
                emit("PAGE_FAULT", msg,
                     JsonWriter().beginObject().field("spid", in.spid).field("vpn", in.vpn).field("frame", a.frame)
                         .field("evicted", a.evicted).endObject().str());
            }
            break;
        }
        case Intent::FINISH:
            finishFlight(f, "DONE");
            break;
    }
}

// Frees resources held by a flight (task = -1: all, otherwise one service task).
void Simulation::releaseResourcesOf(int spid, int task) {
    for (ResourceInstance& r : resources.instances) {
        if (r.ownerSpid != spid || (task >= 0 && r.ownerTask != task)) continue;
        r.ownerSpid = -1;
        r.ownerTask = 0;
        r.acquiredAtStep = -1;
        emit("RES_RELEASED", flightName(spid) + " released " + r.id,
             JsonWriter().beginObject().field("spid", spid).field("resource", r.id).endObject().str());
    }
}

// Goes through the pending requests (oldest first) and grants whatever the
// active policy allows. Repeats until nothing changes, because one grant or
// refusal can free resources for someone else.
void Simulation::grantPendingRequests() {
    bool changed = true;
    while (changed) {
        changed = false;
        std::vector<PendingRequest> ordered = resources.pending;
        std::sort(ordered.begin(), ordered.end(), [](const PendingRequest& a, const PendingRequest& b) {
            if (a.requestTick != b.requestTick) return a.requestTick < b.requestTick;
            if (a.spid != b.spid) return a.spid < b.spid;
            if (a.task != b.task) return a.task < b.task;
            return a.seq < b.seq;
        });
        for (const PendingRequest& candidate : ordered) {
            auto it = std::find_if(resources.pending.begin(), resources.pending.end(), [&](const PendingRequest& p) {
                return p.spid == candidate.spid && p.task == candidate.task && p.seq == candidate.seq;
            });
            if (it == resources.pending.end()) continue;  // removed by an earlier refusal
            std::string outcome;
            if (grantOne(*it, outcome)) changed = true;
        }
    }
}

// Returns true if the request was granted or refused (the table changed).
bool Simulation::grantOne(PendingRequest& req, std::string& outcome) {
    Flight* f = findFlight(req.spid);

    // PREVENTION: refuse a request that breaks the resource order.
    if (deadlock.policy == DeadlockPolicy::PREVENTION && req.task == 0 &&
        deadlock.violatesOrdering(resources, req.spid, req.cls)) {
        refuseOutOfOrder(f, req.cls);
        outcome = "refused";
        return true;
    }

    int index = resources.findFree(req.cls);
    if (index < 0) {
        markWaiting(req, "held");
        outcome = "waiting";
        return false;
    }

    // AVOIDANCE: grant only if Banker's algorithm says the new state is safe.
    if (deadlock.policy == DeadlockPolicy::AVOIDANCE) {
        RequestResult r = deadlock.checkWithBanker(resources, activeFlights(), req.spid, req.cls, tick);
        if (r.verdict != RequestVerdict::GRANT) {
            markWaiting(req, r.verdict == RequestVerdict::UNSAFE ? "unsafe" : "claim");
            outcome = "deferred";
            return false;
        }
    }

    // Grant: record the owner, then let the requester continue.
    ResourceInstance& inst = resources.instances[index];
    inst.ownerSpid = req.spid;
    inst.ownerTask = req.task;
    inst.acquiredAtStep = req.task == 0 ? (int)f->stepIndex : -1;
    PendingRequest granted = req;
    resources.pending.erase(std::find_if(resources.pending.begin(), resources.pending.end(), [&](const PendingRequest& p) {
        return p.spid == granted.spid && p.task == granted.task && p.seq == granted.seq;
    }));
    std::string why = deadlock.policy == DeadlockPolicy::AVOIDANCE ? " (Banker's: state stays safe)" : "";
    emit("RES_GRANTED", f->flightNo + (granted.task ? " (refuel worker)" : "") + " acquired " + inst.id + why,
         JsonWriter().beginObject().field("spid", granted.spid).field("task", granted.task)
             .field("resource", inst.id).field("waited", tick - granted.requestTick).endObject().str());

    if (granted.task == 0) {
        f->waitingForGrant = false;
        f->stepIndex++;  // the ACQUIRE step is complete
        if (inst.cls == ResClass::GATE) f->gatePosition = inst.beltPosition;
        if (f->state == OsState::BLOCKED) {
            makeReady(f);
            emit("FLIGHT_READY", f->flightNo + " was woken up and is READY again", spidData(f->spid));
        }
    } else if (ServiceTask* t = findTask(granted.task)) {
        t->state = TaskState::WORKING;
        t->workLeft = 3;
    }
    outcome = "granted";
    return true;
}

void Simulation::markWaiting(PendingRequest& req, const std::string& reason) {
    if (req.waitReason == reason) return;  // already waiting for the same reason
    bool firstTime = req.waitReason.empty();
    req.waitReason = reason;
    if (firstTime) newBlockThisTick = true;

    Flight* f = findFlight(req.spid);
    std::string text;
    if (reason == "held") text = std::string("waiting: every ") + resClassName(req.cls) + " is in use";
    else if (reason == "unsafe") text = std::string("deferred: granting a ") + resClassName(req.cls) +
                                        " would make the state UNSAFE (Banker's)";
    else text = "rejected: the request exceeds the declared maximum claim";

    if (req.task == 0) {
        f->blockReason = text;
        if (f->state == OsState::RUNNING || f->state == OsState::READY) {
            if (dispatcher.running() == f->spid) dispatcher.releaseCpu();
            dispatcher.removeFromReady(f->spid);
            f->state = OsState::BLOCKED;
        }
    }
    std::string kind = reason == "unsafe" ? "UNSAFE_DEFERRED" : "RES_BLOCKED";
    emit(kind, f->flightNo + (req.task ? " (refuel worker) " : " ") + text,
         JsonWriter().beginObject().field("spid", req.spid).field("task", req.task)
             .field("class", resClassName(req.cls)).field("reason", reason).endObject().str());
}

// PREVENTION: the flight broke the resource order. It must release what it
// holds and restart, requesting resources in increasing rank order.
void Simulation::refuseOutOfOrder(Flight* f, ResClass cls) {
    emit("POLICY_REFUSED", f->flightNo + " requested a " + resClassName(cls) + " (rank " +
                               std::to_string(resClassRank(cls)) + ") while holding rank " +
                               std::to_string(resources.highestRankHeldBy(f->spid)) +
                               "; refused by the resource-ordering rule. It releases everything and restarts in order.",
         spidData(f->spid));
    releaseResourcesOf(f->spid, -1);
    resources.removePendingOf(f->spid);

    // Re-order the ACQUIRE steps by rank; WORK steps keep their positions.
    std::vector<size_t> positions;
    std::vector<ResClass> classes;
    for (size_t i = 0; i < f->script.size(); i++) {
        if (f->script[i].kind == StepKind::ACQUIRE) {
            positions.push_back(i);
            classes.push_back(f->script[i].resClass);
        }
    }
    std::sort(classes.begin(), classes.end(), [](ResClass a, ResClass b) { return resClassRank(a) < resClassRank(b); });
    for (size_t k = 0; k < positions.size(); k++) f->script[positions[k]].resClass = classes[k];

    f->stepIndex = 0;
    f->workDone = 0;
    f->waitingForGrant = false;
    if (dispatcher.running() == f->spid) dispatcher.releaseCpu();
    dispatcher.removeFromReady(f->spid);
    f->state = OsState::READY;
    requeueAfterGrants.push_back(f);  // re-enters the ready queue after this tick's grants
}

void Simulation::runDetectionAndRecovery() {
    std::vector<int> deadlocked = deadlock.detect(resources, activeFlights());
    if (deadlocked.empty()) {
        deadlock.deadlockedSpids.clear();
        return;
    }
    if (deadlocked != deadlock.deadlockedSpids) {
        deadlock.deadlockedSpids = deadlocked;
        deadlock.lastDetectedSpids = deadlocked;
        deadlock.detectedAtTick = tick;
        std::string names;
        for (int s : deadlocked) names += (names.empty() ? "" : ", ") + flightName(s);
        JsonWriter w;
        w.beginObject().key("deadlocked").intArray(deadlocked).key("edges").beginArray();
        for (const WaitEdge& e : DeadlockManager::waitForEdges(resources))
            w.beginObject().field("from", e.fromSpid).field("to", e.toSpid).field("resource", e.resourceId).endObject();
        w.endArray().endObject();
        emit("DEADLOCK_DETECTED", "Deadlock detected: " + names + " are waiting on each other in a cycle", w.str());
    }
    if (deadlock.policy == DeadlockPolicy::RECOVERY) recoverFrom(deadlocked);
}

// RECOVERY: break the deadlock by choosing a victim, then let the others continue.
void Simulation::recoverFrom(std::vector<int> deadlocked) {
    for (int round = 0; round < 32 && !deadlocked.empty(); round++) {
        int victimSpid = deadlock.chooseVictim(deadlocked, activeFlights());
        Flight* victim = findFlight(victimSpid);
        if (!victim) break;
        emit("VICTIM_SELECTED", victim->flightNo + " chosen as victim (lowest priority " +
                                    std::to_string(victim->priority) + ", then youngest SPID)", spidData(victimSpid));

        std::string released;
        int earliestStep = (int)victim->script.size();
        for (int idx : resources.instancesHeldBy(victimSpid)) {
            released += (released.empty() ? "" : ", ") + resources.instances[idx].id;
            if (resources.instances[idx].acquiredAtStep >= 0)
                earliestStep = std::min(earliestStep, resources.instances[idx].acquiredAtStep);
        }

        std::string text;
        if (deadlock.action == RecoveryAction::PREEMPT) {
            // Resource preemption + rollback: take its resources away and roll
            // its script back to the step where it first acquired one of them.
            releaseResourcesOf(victimSpid, -1);
            resources.removePendingOf(victimSpid);
            victim->stepIndex = earliestStep < (int)victim->script.size() ? earliestStep : 0;
            victim->workDone = 0;
            victim->waitingForGrant = false;
            if (dispatcher.running() == victimSpid) dispatcher.releaseCpu();
            victim->state = OsState::READY;
            requeueAfterGrants.push_back(victim);
            text = victim->flightNo + " was rolled back to step " + std::to_string(victim->stepIndex) +
                   " and lost " + released;
        } else {
            finishFlight(victim, "ABORTED");
            text = victim->flightNo + " was terminated; released " + released;
        }
        deadlock.recoveryLog.push_back("tick " + std::to_string(tick) + ": " + text);
        emit("RECOVERED", "Recovery (" + std::string(recoveryActionName(deadlock.action)) + "): " + text,
             JsonWriter().beginObject().field("victim", victimSpid).field("action", recoveryActionName(deadlock.action))
                 .field("released", released).endObject().str());

        grantPendingRequests();  // the released resources go to the waiting flights
        deadlocked = deadlock.detect(resources, activeFlights());
    }
    deadlock.deadlockedSpids = deadlocked;
}

void Simulation::requeueDeferredFlights() {
    for (Flight* f : requeueAfterGrants)
        if (f->state != OsState::TERMINATED && !dispatcher.isReady(f->spid)) makeReady(f);
    requeueAfterGrants.clear();
}

// Terminates a flight: releases everything it holds and frees its memory.
void Simulation::finishFlight(Flight* f, const std::string& endStatus) {
    releaseResourcesOf(f->spid, -1);
    resources.removePendingOf(f->spid);
    if (dispatcher.running() == f->spid) dispatcher.releaseCpu();
    dispatcher.removeFromReady(f->spid);
    f->state = OsState::TERMINATED;
    f->endStatus = endStatus;
    f->blockReason.clear();
    f->finishTick = tick + 1;
    f->waitingForGrant = false;
    memory.freeFlight(f->spid);
    if (endStatus == "ABORTED") {
        f->abortRequested = true;
        pthread_cond_signal(&f->wakeup);  // its thread wakes up, sees the flag and exits
    }
    int tat = f->finishTick - f->arrivalTick;
    emit("FLIGHT_TERMINATED", f->flightNo + (endStatus == "DONE" ? " completed" : " was ABORTED") + " (TAT " +
                                  std::to_string(tat) + ", WT " + std::to_string(f->readyTicks) + ")",
         JsonWriter().beginObject().field("spid", f->spid).field("status", endStatus).field("finish", f->finishTick)
             .field("tat", tat).field("wt", f->readyTicks).endObject().str());
}

void Simulation::abortFlight(Flight* f, const std::string& reason) {
    emit("FLIGHT_ABORT", f->flightNo + " aborted: " + reason, spidData(f->spid));
    finishFlight(f, "ABORTED");
    grantPendingRequests();
    requeueDeferredFlights();
}

// MEM-REF preset: one reference per tick, each explained in the event log.
void Simulation::advanceMemoryReference() {
    if (!memory.hasQueuedReference()) return;
    int page = memory.popQueuedReference();
    PageAccess a = memory.touch(0, page, tick, "reference string");
    std::string msg = "Reference " + std::to_string(memory.referencesDone) + ": page " + std::to_string(page);
    if (a.hit) {
        msg += " is already in frame " + std::to_string(a.frame) + " (hit)";
    } else if (a.evicted >= 0) {
        msg += " -> page fault; FIFO replaces page " + std::to_string(a.evicted % 100) +
               " (resident the longest) in frame " + std::to_string(a.frame);
    } else {
        msg += " -> page fault; loaded into free frame " + std::to_string(a.frame);
    }
    emit(a.hit ? "PAGE_HIT" : "PAGE_FAULT", msg,
         JsonWriter().beginObject().field("spid", 0).field("vpn", page).field("frame", a.frame)
             .field("evicted", a.evicted).key("frames").intArray(a.framesAfter).endObject().str());
}

// Moves the baggage cart. A new batch is planned by the CHILD PROCESS over the pipes.
void Simulation::advanceStorage() {
    // Wait until the intake thread has moved every produced bag into the queue,
    // otherwise the batch contents would depend on thread timing.
    while (bagsConsumed < bagsProduced && !shuttingDown && !intakeHeld) pthread_cond_wait(&intakeCv, &mtx);
    if (shuttingDown) return;

    if (!storage.busy) {
        std::vector<DiskRequest> batch = storage.takeBatch(tick + 1);
        if (!batch.empty()) {
            std::vector<int> positions = storage.positionsOf(batch);
            DiskAlgo algo = storage.algo;
            Direction dir = storage.direction;
            int head = storage.head, minCyl = storage.minCyl, maxCyl = storage.maxCyl;

            // Never hold mtx while blocked on a pipe.
            storageRequestInFlight = true;
            pthread_mutex_unlock(&mtx);
            DiskPlan childPlan;
            std::string error;
            bool ok = child.requestPlan(algo, dir, head, minCyl, maxCyl, positions, childPlan, error);
            pthread_mutex_lock(&mtx);
            storageRequestInFlight = false;
            ipcStatus = child.status;
            if (shuttingDown) return;

            if (!ok) {
                ipcLastError = error;
                storage.waiting.insert(storage.waiting.begin(), batch.begin(), batch.end());  // keep them pending
                emit("ERROR", "E_IPC: " + error, JsonWriter().beginObject().field("code", "E_IPC").endObject().str());
            } else {
                ipcExchanges++;
                ipcLastSent = child.lastSent;
                ipcLastReceived = child.lastReceived;
                // The parent double-checks the child's answer with the same algorithm.
                DiskPlan check = planDisk(algo, dir, head, minCyl, maxCyl, positions);
                if (check.order != childPlan.order || check.totalMovement != childPlan.totalMovement)
                    invariantError = "child process returned a different disk schedule";
                storage.startBatch(batch, childPlan);
                JsonWriter w;
                w.beginObject().field("algo", diskAlgoName(algo)).field("direction", directionName(dir));
                w.field("head", head).key("order").intArray(childPlan.order).key("path").intArray(childPlan.path);
                w.field("movement", childPlan.totalMovement).field("child_pid", (int)child.childPid).endObject();
                emit("IPC_EXCHANGE", "Sent " + std::to_string(positions.size()) +
                                         " baggage requests to child PID " + std::to_string(child.childPid) +
                                         " over a pipe; it replied with the " + diskAlgoName(algo) + " order",
                     w.str());
                emit("DISK_BATCH_SCHEDULED", std::string(diskAlgoName(algo)) + " order planned, total head movement " +
                                                 std::to_string(childPlan.totalMovement), w.str());
            }
        }
    }

    bool wasBusy = storage.busy;
    for (const DiskRequest& r : storage.advanceCart(tick)) {
        emit("DISK_REQ_SERVED", "Cart served baggage at position " + std::to_string(r.position) + " for " +
                                    flightName(r.ownerSpid),
             JsonWriter().beginObject().field("position", r.position).field("spid", r.ownerSpid).endObject().str());
        if (ServiceTask* t = findTask(r.task)) t->bagsServed++;
    }
    if (wasBusy && !storage.busy) {
        if (storage.lastBatchMovement != storage.plan.totalMovement)
            invariantError = "cart movement differs from the planned movement";
        emit("DISK_BATCH_DONE", "Batch complete: cart moved " + std::to_string(storage.lastBatchMovement) +
                                    " positions (planned " + std::to_string(storage.plan.totalMovement) + ")",
             JsonWriter().beginObject().field("moved", storage.lastBatchMovement)
                 .field("planned", storage.plan.totalMovement).endObject().str());
    }
}

void Simulation::updateServiceProgress() {
    for (ServiceTask* t : tasks) {
        if (t->state == TaskState::WAITING_GRANT || t->state == TaskState::WAITING_BAGS) t->waitTicks++;
        if (t->state == TaskState::WAITING_BAGS && t->bagsServed >= t->bagsTotal) t->state = TaskState::FINISHING;
    }
    // A flight whose ground services are all done is woken up.
    for (Flight* f : flights) {
        if (!f->servicesRunning || f->state != OsState::BLOCKED) continue;
        bool allDone = true;
        for (ServiceTask* t : f->services)
            if (t->state != TaskState::DONE) allDone = false;
        if (allDone) {
            makeReady(f);
            emit("SERVICES_COMPLETE", "All ground services of " + f->flightNo + " finished; it is READY again",
                 spidData(f->spid));
        }
    }
}

// The invariants of 09 section 9.3, checked after every tick.
void Simulation::checkInvariants() {
    invariantChecks++;
    auto fail = [&](const std::string& why) {
        if (invariantError.empty()) {
            invariantError = why;
            emit("INVARIANT_VIOLATION", why);
        }
    };
    for (const ResourceInstance& r : resources.instances) {
        if (r.ownerSpid == -1) continue;
        Flight* owner = findFlight(r.ownerSpid);
        if (!owner || owner->state == OsState::TERMINATED) fail(r.id + " is owned by a flight that does not exist");
        if (!r.enabled) fail(r.id + " is closed but has an owner");
    }
    for (Flight* f : flights) {
        int pendingOwn = 0;
        for (const PendingRequest& p : resources.pending)
            if (p.spid == f->spid && p.task == 0) pendingOwn++;
        if (pendingOwn > 1) fail(f->flightNo + " has more than one pending request");
        if (f->state == OsState::BLOCKED && !f->servicesRunning && pendingOwn != 1)
            fail(f->flightNo + " is BLOCKED without exactly one pending request");
        if (f->state == OsState::TERMINATED) {
            if (!resources.instancesHeldBy(f->spid).empty()) fail(f->flightNo + " finished but still holds resources");
            if (dispatcher.isReady(f->spid)) fail(f->flightNo + " finished but is still in the ready queue");
            for (int page : memory.pager.frameContents())
                if (page >= 0 && page / 100 == f->spid) fail(f->flightNo + " finished but still occupies a frame");
        }
        if (f->state == OsState::READY && !dispatcher.isReady(f->spid))
            fail(f->flightNo + " is READY but not in the ready queue");
        if (f->state == OsState::RUNNING && dispatcher.running() != f->spid && dispatcher.running() != -1)
            fail(f->flightNo + " is RUNNING but does not own the CPU");
    }
}
