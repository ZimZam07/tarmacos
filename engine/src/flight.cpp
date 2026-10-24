// flight.cpp - names, parsing and the op-type scripts.
#include "flight.h"

const char* osStateName(OsState s) {
    switch (s) {
        case OsState::NEW: return "NEW";
        case OsState::READY: return "READY";
        case OsState::RUNNING: return "RUNNING";
        case OsState::BLOCKED: return "BLOCKED";
        case OsState::TERMINATED: return "TERMINATED";
    }
    return "?";
}

const char* phaseName(Phase p) {
    switch (p) {
        case Phase::CREATED: return "CREATED";
        case Phase::APPROACHING: return "APPROACHING";
        case Phase::LANDING: return "LANDING";
        case Phase::TAXIING: return "TAXIING";
        case Phase::AT_GATE: return "AT_GATE";
        case Phase::TURNAROUND: return "TURNAROUND";
        case Phase::PUSHBACK: return "PUSHBACK";
        case Phase::DEPARTED: return "DEPARTED";
        case Phase::ARRIVED: return "ARRIVED";
    }
    return "?";
}

const char* opTypeName(OpType op) {
    switch (op) {
        case OpType::TURNAROUND: return "TURNAROUND";
        case OpType::ARRIVAL: return "ARRIVAL";
        case OpType::DEPARTURE: return "DEPARTURE";
        case OpType::CUSTOM: return "CUSTOM";
        case OpType::SCRIPTED: return "SCRIPTED";
    }
    return "?";
}

bool parseOpType(const std::string& text, OpType& op) {
    if (text == "TURNAROUND") { op = OpType::TURNAROUND; return true; }
    if (text == "ARRIVAL") { op = OpType::ARRIVAL; return true; }
    if (text == "DEPARTURE") { op = OpType::DEPARTURE; return true; }
    if (text == "CUSTOM") { op = OpType::CUSTOM; return true; }
    return false;  // SCRIPTED flights are created only by scenario presets
}

const char* resClassName(ResClass c) {
    switch (c) {
        case ResClass::GATE: return "GATE";
        case ResClass::FUEL_TRUCK: return "FUEL_TRUCK";
        case ResClass::TUG: return "TUG";
    }
    return "?";
}

// Prevention by resource ordering: a flight may only request a class whose
// rank is HIGHER than every class it already holds (Gate < Fuel truck < Tug).
int resClassRank(ResClass c) { return (int)c + 1; }

static Step phase(Phase p) { Step s{StepKind::PHASE}; s.phase = p; return s; }
static Step acquire(ResClass c) { Step s{StepKind::ACQUIRE}; s.resClass = c; return s; }
static Step work(int ticks) { Step s{StepKind::WORK}; s.amount = ticks; return s; }
static Step releaseAll() { return Step{StepKind::RELEASE_ALL}; }
static Step services(bool refuel, bool baggage) {
    Step s{StepKind::SERVICES};
    s.refuel = refuel;
    s.baggage = baggage;
    return s;
}

// The scripts follow the resource order Gate -> Fuel truck -> Tug, so normal
// airport traffic can never deadlock (prevention by design). Deadlock only
// appears in the scripted A/B/C scenario (scenarios.cpp).
std::vector<Step> buildScript(OpType op, int customBurst) {
    switch (op) {
        case OpType::TURNAROUND:
            return {phase(Phase::APPROACHING), acquire(ResClass::GATE), phase(Phase::LANDING), work(2),
                    phase(Phase::TAXIING), work(1), phase(Phase::AT_GATE), phase(Phase::TURNAROUND),
                    services(true, true), phase(Phase::PUSHBACK), acquire(ResClass::TUG), work(1),
                    releaseAll(), phase(Phase::DEPARTED)};
        case OpType::ARRIVAL:
            return {phase(Phase::APPROACHING), acquire(ResClass::GATE), phase(Phase::LANDING), work(2),
                    phase(Phase::TAXIING), work(1), phase(Phase::AT_GATE), services(false, true),
                    releaseAll(), phase(Phase::ARRIVED)};
        case OpType::DEPARTURE:
            return {phase(Phase::AT_GATE), acquire(ResClass::GATE), services(true, false), phase(Phase::PUSHBACK),
                    acquire(ResClass::TUG), work(1), releaseAll(), phase(Phase::DEPARTED)};
        case OpType::CUSTOM:
        case OpType::SCRIPTED:
            break;
    }
    return {work(customBurst)};  // CUSTOM: pure CPU burst, used for scheduler reference runs
}

int cpuBurstOf(const std::vector<Step>& script) {
    int ticks = 0;
    for (const Step& s : script) {
        if (s.kind == StepKind::WORK) ticks += s.amount;
        else if (s.kind != StepKind::PHASE) ticks += 1;
    }
    return ticks;
}

std::string stepLabel(const Step& s) {
    switch (s.kind) {
        case StepKind::PHASE: return std::string("phase ") + phaseName(s.phase);
        case StepKind::ACQUIRE: return std::string("acquire ") + resClassName(s.resClass);
        case StepKind::WORK: return "work " + std::to_string(s.amount);
        case StepKind::RELEASE_ALL: return "release all";
        case StepKind::SERVICES: {
            std::string label = "services";
            if (s.refuel) label += " refuel";
            if (s.baggage) label += " baggage";
            return label;
        }
    }
    return "?";
}
