// snapshot.cpp - the complete engine state as one JSON object.
// The dashboard renders ONLY what is in this snapshot; it computes nothing itself.
#include <unistd.h>

#include "json.h"
#include "simulation.h"

static void writeMatrix(JsonWriter& w, const std::string& name, const Matrix& m) {
    w.key(name).beginArray();
    for (const Vec& row : m) w.intArray(row);
    w.endArray();
}

std::string Simulation::snapshotJson() {
    JsonWriter w;
    w.beginObject().field("type", "snapshot").field("epoch", epoch).field("version", version).field("tick", tick);

    // ---- simulation control ----
    w.key("sim").beginObject();
    w.field("running", running).field("fast", fastRun).field("tick_ms", tickMs).field("quiet", isQuiet());
    w.field("scenario", scenarioName).field("note", scenarioNote).field("step_budget", stepBudget);
    w.field("invariant_error", invariantError).field("invariant_checks", invariantChecks);
    w.endObject();

    // ---- CPU scheduler ----
    double sumWt = 0, sumTat = 0;
    int done = 0;
    for (Flight* f : flights) {
        if (f->state == OsState::TERMINATED && f->endStatus == "DONE") {
            done++;
            sumWt += f->readyTicks;
            sumTat += f->finishTick - f->arrivalTick;
        }
    }
    w.key("cpu").beginObject();
    w.field("algo", schedAlgoName(dispatcher.config.algo)).field("quantum", dispatcher.config.quantum);
    w.field("preemptive", dispatcher.config.preemptive).field("running", dispatcher.running());
    w.field("slice_used", dispatcher.sliceUsed());
    w.key("ready").intArray(dispatcher.readyOrder());
    w.key("gantt").beginArray();
    for (const GanttSlice& s : compressTimeline(timeline))
        w.beginObject().field("spid", s.spid).field("start", s.start).field("end", s.end).endObject();
    w.endArray();
    w.key("changes").beginArray();
    for (const auto& change : schedChanges) w.beginObject().field("tick", change.first).field("config", change.second).endObject();
    w.endArray();
    w.field("completed", done);
    w.key("avg_waiting");
    if (done) w.value(sumWt / done); else w.null();
    w.key("avg_turnaround");
    if (done) w.value(sumTat / done); else w.null();
    w.endObject();

    // ---- flights ----
    w.key("flights").beginArray();
    for (Flight* f : flights) {
        w.beginObject().field("spid", f->spid).field("flight_no", f->flightNo).field("op", opTypeName(f->op));
        w.field("priority", f->priority).field("arrival", f->arrivalTick).field("burst", f->burst);
        w.field("cpu_used", f->cpuUsed).field("state", osStateName(f->state)).field("phase", phaseName(f->phase));
        w.field("block_reason", f->blockReason).field("end_status", f->endStatus);
        w.field("waiting", f->readyTicks).field("blocked_ticks", f->blockedTicks);
        w.field("first_dispatch", f->firstDispatch).field("finish", f->finishTick);
        w.key("turnaround");
        if (f->finishTick >= 0) w.value(f->finishTick - f->arrivalTick); else w.null();
        w.field("step_index", (int)f->stepIndex).field("tid", f->tid).field("gate_position", f->gatePosition);
        w.key("held").beginArray();
        for (int idx : resources.instancesHeldBy(f->spid)) w.value(resources.instances[idx].id);
        w.endArray();
        w.key("requested").beginArray();
        for (const PendingRequest& p : resources.pending)
            if (p.spid == f->spid) w.value(resClassName(p.cls));
        w.endArray();
        w.key("max_claim").intArray({f->maxClaim[0], f->maxClaim[1], f->maxClaim[2]});
        w.key("script").beginArray();
        for (const Step& s : f->script) w.value(stepLabel(s));
        w.endArray();
        w.endObject();
    }
    w.endArray();

    // ---- resources ----
    w.key("resources").beginArray();
    for (const ResourceInstance& r : resources.instances) {
        w.beginObject().field("id", r.id).field("class", resClassName(r.cls)).field("enabled", r.enabled);
        w.field("owner", r.ownerSpid).field("owner_task", r.ownerTask).field("position", r.beltPosition).endObject();
    }
    w.endArray();
    w.key("pending").beginArray();
    for (const PendingRequest& p : resources.pending) {
        w.beginObject().field("spid", p.spid).field("task", p.task).field("class", resClassName(p.cls));
        w.field("since", p.requestTick).field("reason", p.waitReason).endObject();
    }
    w.endArray();

    // ---- deadlock ----
    ResourceMatrices live = buildMatrices(resources, activeFlights());
    w.key("deadlock").beginObject();
    w.field("policy", policyName(deadlock.policy)).field("action", recoveryActionName(deadlock.action));
    w.key("deadlocked").intArray(deadlock.deadlockedSpids);
    w.key("last_detected").intArray(deadlock.lastDetectedSpids);
    w.field("detected_at", deadlock.detectedAtTick).field("detection_runs", deadlock.detectionRuns);
    w.key("edges").beginArray();
    for (const WaitEdge& e : DeadlockManager::waitForEdges(resources))
        w.beginObject().field("from", e.fromSpid).field("to", e.toSpid).field("resource", e.resourceId).endObject();
    w.endArray();
    w.key("ranks").beginObject().field("GATE", 1).field("FUEL_TRUCK", 2).field("TUG", 3).endObject();
    w.key("matrices").beginObject();
    w.key("spids").intArray(live.spids).key("available").intArray(live.available);
    writeMatrix(w, "allocation", live.allocation);
    writeMatrix(w, "maximum", live.maximum);
    writeMatrix(w, "request", live.request);
    w.endObject();
    w.key("banker");
    if (deadlock.hasBankerCheck) {
        const RequestResult& r = deadlock.bankerResult;
        w.beginObject().field("tick", deadlock.bankerTick).field("requester", deadlock.bankerRequester);
        w.field("class", resClassName(deadlock.bankerClass)).field("verdict", requestVerdictName(r.verdict));
        w.field("reason", r.reason).key("spids").intArray(deadlock.bankerMatrices.spids);
        w.key("available").intArray(deadlock.bankerMatrices.available);
        writeMatrix(w, "allocation", deadlock.bankerMatrices.allocation);
        writeMatrix(w, "maximum", deadlock.bankerMatrices.maximum);
        w.key("available_after").intArray(r.availableAfter);
        writeMatrix(w, "need", r.safety.need);
        w.field("safe", r.safety.safe).key("sequence").intArray(r.safety.sequence);
        w.endObject();
    } else {
        w.null();
    }
    w.key("recovery_log").beginArray();
    for (const std::string& line : deadlock.recoveryLog) w.value(line);
    w.endArray();
    w.endObject();

    // ---- memory ----
    w.key("memory").beginObject();
    w.field("frame_count", memory.pager.frameCount()).field("page_size", MemoryManager::kPageSize);
    w.field("pages_per_flight", MemoryManager::kPagesPerFlight);
    w.field("faults", memory.pager.faults()).field("hits", memory.pager.hits());
    w.key("frames").beginArray();
    for (int page : memory.pager.frameContents()) {
        if (page < 0) { w.null(); continue; }
        w.beginObject().field("spid", page / 100).field("vpn", page % 100).endObject();
    }
    w.endArray();
    w.key("fifo").beginArray();
    for (int page : memory.pager.fifoQueue()) w.beginObject().field("spid", page / 100).field("vpn", page % 100).endObject();
    w.endArray();
    w.key("reference").intArray(memory.referenceString).field("reference_done", memory.referencesDone);
    w.key("history").beginArray();
    for (const MemoryRecord& m : memory.history) {
        w.beginObject().field("tick", m.tick).field("spid", m.spid).field("vpn", m.vpn).field("reason", m.reason);
        w.field("hit", m.access.hit).field("frame", m.access.frame);
        w.key("evicted");
        if (m.access.evicted >= 0) w.beginObject().field("spid", m.access.evicted / 100).field("vpn", m.access.evicted % 100).endObject();
        else w.null();
        w.key("frames_after").beginArray();
        for (int page : m.access.framesAfter) {
            if (page < 0) w.null();
            else w.beginObject().field("spid", page / 100).field("vpn", page % 100).endObject();
        }
        w.endArray().endObject();
    }
    w.endArray();
    w.endObject();

    // ---- storage (baggage cart = disk head) ----
    w.key("disk").beginObject();
    w.field("algo", diskAlgoName(storage.algo)).field("direction", directionName(storage.direction));
    w.field("head", storage.head).field("min", storage.minCyl).field("max", storage.maxCyl);
    w.field("speed", storage.cartSpeed).field("busy", storage.busy);
    w.key("waiting").beginArray();
    for (const DiskRequest& r : storage.waiting) w.beginObject().field("position", r.position).field("spid", r.ownerSpid).endObject();
    w.endArray();
    w.key("batch_remaining").beginArray();
    for (const DiskRequest& r : storage.batch) w.beginObject().field("position", r.position).field("spid", r.ownerSpid).endObject();
    w.endArray();
    w.key("order").intArray(storage.plan.order).key("path").intArray(storage.plan.path);
    w.field("next_waypoint", (int)storage.nextWaypoint).field("batch_start", storage.batchStartHead);
    w.field("moved_in_batch", storage.movedInBatch).field("planned_movement", storage.plan.totalMovement);
    w.field("last_batch_movement", storage.lastBatchMovement).field("total_movement", storage.totalMovement);
    w.field("served_count", storage.requestsServed).field("batches", storage.batchesDone);
    w.key("served").beginArray();
    for (const ServedRecord& s : storage.served)
        w.beginObject().field("tick", s.tick).field("position", s.position).field("spid", s.ownerSpid).endObject();
    w.endArray();
    w.key("trail").intArray(std::vector<int>(storage.headTrail.begin(), storage.headTrail.end()));
    w.endObject();

    // ---- synchronisation: bounded buffer ----
    w.key("sync").beginObject();
    w.field("capacity", BaggageBuffer::kCapacity);
    w.field("empty_sem", buffer.emptyCount()).field("full_sem", buffer.fullCount());
    w.field("produced", bagsProduced).field("consumed", bagsConsumed).field("intake_held", intakeHeld);
    w.key("buffer").beginArray();
    for (const BagItem& b : buffer.contents()) w.beginObject().field("position", b.position).field("spid", b.ownerSpid).endObject();
    w.endArray();
    w.endObject();

    // ---- real process + pipes ----
    w.key("ipc").beginObject();
    w.field("engine_pid", (int)getpid()).field("child_pid", (int)child.childPid).field("status", ipcStatus);
    w.field("request_fd", child.requestWriteFd).field("result_fd", child.resultReadFd);
    w.field("exchanges", ipcExchanges).field("last_sent", ipcLastSent).field("last_received", ipcLastReceived);
    w.field("last_error", ipcLastError).field("in_flight", storageRequestInFlight);
    w.endObject();

    // ---- threads (real Linux TIDs) ----
    w.key("threads").beginArray();
    w.beginObject().field("name", "main (command reader)").field("kind", "main").field("tid", mainTid)
        .field("state", "read() on stdin").field("spid", -1).endObject();
    w.beginObject().field("name", "clock").field("kind", "clock").field("tid", clockTid)
        .field("state", tickInProgress ? "running a tick" : (running || fastRun ? "between ticks" : "cond_wait: paused"))
        .field("spid", -1).endObject();
    w.beginObject().field("name", "baggage intake (consumer)").field("kind", "intake").field("tid", intakeTid)
        .field("state", intakeHeld ? "held (debug)" : "sem_wait(full) / moving bags").field("spid", -1).endObject();
    for (Flight* f : flights) {
        if (!f->threadStarted || f->threadJoined || f->threadExited) continue;
        std::string state = f->hasTurn ? "executing a step" :
                            f->state == OsState::BLOCKED ? (f->servicesRunning ? "cond_wait: waiting for its services"
                                                                               : "cond_wait: waiting for a resource")
                                                         : "cond_wait: waiting for a CPU turn";
        if (f->servicesRunning && f->state != OsState::BLOCKED) state = "pthread_join: collecting services";
        w.beginObject().field("name", "flight " + f->flightNo).field("kind", "flight").field("tid", f->tid);
        w.field("state", state).field("spid", f->spid).endObject();
    }
    for (ServiceTask* t : tasks) {
        if (t->joined) continue;
        std::string state = t->blockedOnFullBuffer ? "sem_wait(empty): buffer full" :
                            t->state == TaskState::WAITING_GRANT ? "cond_wait: waiting for a fuel truck" :
                            t->state == TaskState::WAITING_BAGS ? "cond_wait: waiting for the cart" :
                            t->state == TaskState::DONE ? "exiting (pthread_exit)" : "cond_wait: waiting for a turn";
        w.beginObject().field("name", std::string(serviceKindName(t->kind)) + " #" + std::to_string(t->taskId) +
                                          " for " + flightName(t->ownerSpid));
        w.field("kind", "service").field("tid", t->tid).field("state", state).field("spid", t->ownerSpid);
        w.field("task_state", taskStateName(t->state)).endObject();
    }
    w.endArray();

    // ---- recent events (newest last) ----
    w.key("events").beginArray();
    size_t first = recentEvents.size() > 60 ? recentEvents.size() - 60 : 0;
    for (size_t i = first; i < recentEvents.size(); i++) {
        const EventRecord& e = recentEvents[i];
        w.beginObject().field("seq", e.seq).field("tick", e.tick).field("kind", e.kind).field("msg", e.message).endObject();
    }
    w.endArray();

    w.endObject();
    return w.str();
}
