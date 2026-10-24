// flight.h - a flight is a LOGICAL process (identified by an SPID, a
// simulated PID). It is not a real Linux process: each flight is executed by
// one real POSIX thread inside the engine (see workers.cpp).
//
// Two separate state fields:
//   OsState - the textbook process state (NEW, READY, RUNNING, BLOCKED, TERMINATED)
//   Phase   - where the aircraft is (APPROACHING, LANDING, AT_GATE, ...)
// They are deliberately independent: a flight in TURNAROUND can be READY,
// RUNNING or BLOCKED.
//
// A flight runs a SCRIPT: a list of steps (acquire a gate, work for 2 ticks,
// start ground services, release everything...). One step uses one CPU tick.
#pragma once

#include <pthread.h>

#include <string>
#include <vector>

enum class OsState { NEW, READY, RUNNING, BLOCKED, TERMINATED };
enum class Phase { CREATED, APPROACHING, LANDING, TAXIING, AT_GATE, TURNAROUND, PUSHBACK, DEPARTED, ARRIVED };
enum class OpType { TURNAROUND, ARRIVAL, DEPARTURE, CUSTOM, SCRIPTED };
enum class ResClass { GATE = 0, FUEL_TRUCK = 1, TUG = 2 };
constexpr int kResClassCount = 3;

const char* osStateName(OsState state);
const char* phaseName(Phase phase);
const char* opTypeName(OpType op);
bool parseOpType(const std::string& text, OpType& op);
const char* resClassName(ResClass cls);
int resClassRank(ResClass cls);  // ordering used by deadlock PREVENTION

enum class StepKind { PHASE, ACQUIRE, WORK, SERVICES, RELEASE_ALL };

struct Step {
    StepKind kind;
    Phase phase = Phase::CREATED;          // PHASE
    ResClass resClass = ResClass::GATE;    // ACQUIRE
    int amount = 1;                        // WORK: number of ticks
    bool refuel = false;                   // SERVICES: start a REFUEL worker thread
    bool baggage = false;                  // SERVICES: start a BAGGAGE worker thread
};

std::vector<Step> buildScript(OpType op, int customBurst);
std::string stepLabel(const Step& step);
int cpuBurstOf(const std::vector<Step>& script);  // ticks of CPU the script needs

struct ServiceTask;  // defined in workers.h

struct Flight {
    // identity
    int spid = 0;
    std::string flightNo;
    OpType op = OpType::CUSTOM;
    int priority = 5;
    int arrivalTick = 0;

    // state
    OsState state = OsState::NEW;
    Phase phase = Phase::CREATED;
    std::string blockReason;      // why the flight is BLOCKED ("resource", "unsafe", "services")
    std::string endStatus;        // "DONE" or "ABORTED" when TERMINATED

    // script
    std::vector<Step> script;
    size_t stepIndex = 0;
    int workDone = 0;             // progress inside the current WORK step
    bool waitingForGrant = false; // an ACQUIRE request is pending
    bool servicesRunning = false; // SERVICES step started, worker threads not joined yet
    int maxClaim[kResClassCount] = {0, 0, 0};  // declared maximum (Banker's algorithm)

    // metrics, all in ticks
    int burst = 0;
    int cpuUsed = 0;
    int readyTicks = 0;           // waiting time = time spent in the ready queue
    int blockedTicks = 0;
    int firstDispatch = -1;
    int finishTick = -1;

    // the POSIX thread that executes this flight
    pthread_t thread{};
    pthread_cond_t wakeup;        // signalled when the flight gets a CPU turn
    bool hasTurn = false;
    bool threadStarted = false;
    bool threadExited = false;
    bool threadJoined = false;
    bool abortRequested = false;  // set by recovery/abort; the thread exits
    long tid = 0;                 // real Linux thread id (visible in `ps -T`)

    std::vector<ServiceTask*> services;  // ground-service threads started by this flight
    int gatePosition = -1;               // belt position of the gate it holds (for baggage)
};
