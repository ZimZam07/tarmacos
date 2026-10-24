// deadlock.cpp - building matrices from the live tables and applying the policies.
#include "deadlock.h"

#include "algo/detection.h"
#include "json.h"

const char* policyName(DeadlockPolicy p) {
    switch (p) {
        case DeadlockPolicy::PREVENTION: return "PREVENTION";
        case DeadlockPolicy::AVOIDANCE: return "AVOIDANCE";
        case DeadlockPolicy::DETECTION: return "DETECTION";
        case DeadlockPolicy::RECOVERY: return "RECOVERY";
    }
    return "?";
}

bool parsePolicy(const std::string& text, DeadlockPolicy& p) {
    if (text == "PREVENTION") { p = DeadlockPolicy::PREVENTION; return true; }
    if (text == "AVOIDANCE") { p = DeadlockPolicy::AVOIDANCE; return true; }
    if (text == "DETECTION") { p = DeadlockPolicy::DETECTION; return true; }
    if (text == "RECOVERY") { p = DeadlockPolicy::RECOVERY; return true; }
    return false;
}

const char* recoveryActionName(RecoveryAction a) { return a == RecoveryAction::PREEMPT ? "PREEMPT" : "TERMINATE"; }

bool parseRecoveryAction(const std::string& text, RecoveryAction& a) {
    if (text == "PREEMPT") { a = RecoveryAction::PREEMPT; return true; }
    if (text == "TERMINATE") { a = RecoveryAction::TERMINATE; return true; }
    return false;
}

void DeadlockManager::reset() {
    hasBankerCheck = false;
    bankerTick = -1;
    bankerRequester = -1;
    deadlockedSpids.clear();
    lastDetectedSpids.clear();
    detectedAtTick = -1;
    detectionRuns = 0;
    recoveryLog.clear();
}

ResourceMatrices buildMatrices(const ResourceTable& table, const std::vector<Flight*>& activeFlights) {
    ResourceMatrices m;
    m.available.assign(kResClassCount, 0);
    for (int c = 0; c < kResClassCount; c++) m.available[c] = table.countFree((ResClass)c);

    for (Flight* f : activeFlights) {
        m.spids.push_back(f->spid);
        Vec alloc(kResClassCount, 0), max(kResClassCount, 0), req(kResClassCount, 0);
        for (int c = 0; c < kResClassCount; c++) {
            alloc[c] = table.countHeldBy(f->spid, (ResClass)c);
            max[c] = f->maxClaim[c];
        }
        for (const PendingRequest& p : table.pending)
            if (p.spid == f->spid) req[(int)p.cls]++;
        m.allocation.push_back(alloc);
        m.maximum.push_back(max);
        m.request.push_back(req);
    }
    return m;
}

bool DeadlockManager::violatesOrdering(const ResourceTable& table, int spid, ResClass cls) const {
    return resClassRank(cls) <= table.highestRankHeldBy(spid);
}

RequestResult DeadlockManager::checkWithBanker(const ResourceTable& table, const std::vector<Flight*>& activeFlights,
                                               int spid, ResClass cls, int tick) {
    ResourceMatrices m = buildMatrices(table, activeFlights);
    int row = -1;
    for (int i = 0; i < (int)m.spids.size(); i++)
        if (m.spids[i] == spid) row = i;

    Vec request(kResClassCount, 0);
    request[(int)cls] = 1;
    RequestResult result = evaluateRequest(m.available, m.allocation, m.maximum, row, request);

    hasBankerCheck = true;
    bankerTick = tick;
    bankerRequester = spid;
    bankerClass = cls;
    bankerMatrices = m;
    bankerResult = result;
    return result;
}

std::vector<int> DeadlockManager::detect(const ResourceTable& table, const std::vector<Flight*>& activeFlights) {
    ResourceMatrices m = buildMatrices(table, activeFlights);
    DetectionResult r = detectDeadlock(m.available, m.allocation, m.request);
    detectionRuns++;
    std::vector<int> spids;
    for (int row : r.deadlocked) spids.push_back(m.spids[row]);
    return spids;
}

int DeadlockManager::chooseVictim(const std::vector<int>& deadlocked, const std::vector<Flight*>& activeFlights) const {
    Flight* victim = nullptr;
    for (Flight* f : activeFlights) {
        bool inSet = false;
        for (int s : deadlocked)
            if (s == f->spid) inSet = true;
        if (!inSet) continue;
        if (!victim || f->priority > victim->priority || (f->priority == victim->priority && f->spid > victim->spid))
            victim = f;
    }
    return victim ? victim->spid : -1;
}

std::vector<WaitEdge> DeadlockManager::waitForEdges(const ResourceTable& table) {
    std::vector<WaitEdge> edges;
    for (const PendingRequest& p : table.pending) {
        for (const ResourceInstance& r : table.instances) {
            if (r.cls != p.cls || !r.enabled || r.ownerSpid == -1 || r.ownerSpid == p.spid) continue;
            edges.push_back(WaitEdge{p.spid, r.ownerSpid, r.id});
        }
    }
    return edges;
}

// ---------- BANKER-REF example ----------

static void writeMatrix(JsonWriter& w, const std::string& name, const Matrix& m) {
    w.key(name).beginArray();
    for (const Vec& row : m) w.intArray(row);
    w.endArray();
}

static void writeSafety(JsonWriter& w, const SafetyResult& s) {
    w.key("safety").beginObject().field("safe", s.safe);
    w.key("sequence").intArray(s.sequence);
    w.key("steps").beginArray();
    for (const SafetyStep& st : s.steps) {
        w.beginObject().field("process", st.process);
        w.key("work_before").intArray(st.workBefore);
        w.key("work_after").intArray(st.workAfter);
        w.endObject();
    }
    w.endArray();
    writeMatrix(w, "need", s.need);
    w.endObject();
}

std::string bankerReferenceJson(int requestNo) {
    const Vec available{0, 1, 1};
    const Matrix allocation{{1, 1, 0}, {1, 0, 1}, {1, 0, 0}};
    const Matrix maximum{{1, 2, 1}, {1, 1, 2}, {1, 2, 2}};

    JsonWriter w;
    w.beginObject().field("example", "BANKER-REF");
    w.key("resources").beginArray().value("GATE").value("FUEL_TRUCK").value("TUG").endArray();
    w.key("total").intArray({3, 2, 2});
    w.key("available").intArray(available);
    writeMatrix(w, "allocation", allocation);
    writeMatrix(w, "maximum", maximum);
    writeSafety(w, checkSafety(available, allocation, maximum));

    if (requestNo >= 1 && requestNo <= 3) {
        // R1: P1 asks (0,1,0)  R2: P3 asks (0,1,0)  R3: P2 asks (0,0,2)
        int process = requestNo == 1 ? 0 : requestNo == 2 ? 2 : 1;
        Vec request = requestNo == 3 ? Vec{0, 0, 2} : Vec{0, 1, 0};
        RequestResult r = evaluateRequest(available, allocation, maximum, process, request);
        w.key("request").beginObject().field("label", "R" + std::to_string(requestNo)).field("process", process);
        w.key("vector").intArray(request);
        w.field("verdict", requestVerdictName(r.verdict)).field("reason", r.reason);
        if (r.verdict == RequestVerdict::GRANT || r.verdict == RequestVerdict::UNSAFE) {
            w.key("available_after").intArray(r.availableAfter);
            writeMatrix(w, "allocation_after", r.allocationAfter);
            writeSafety(w, r.safety);
        }
        w.endObject();
    }
    w.endObject();
    return w.str();
}
