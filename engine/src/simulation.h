// simulation.h - the TarmacOS engine state and its deterministic tick loop.
//
// ---------------------------------------------------------------------------
// CONCURRENCY MODEL (deterministic lockstep, plan 09 section 3)
// ---------------------------------------------------------------------------
// Threads: main (reads commands), clock, intake, one per flight, one per
// active ground service. One real child process (baggage handler).
//
// Every tick:
//   1. The clock thread admits arriving flights and asks the CPU dispatcher
//      which flight may run (one "apron control CPU").
//   2. It gives a TURN to that flight thread and to every working service
//      thread (sets hasTurn and signals the thread's condition variable),
//      then waits on ackCv until each participant has finished its step.
//   3. Each participant executes exactly ONE step. A step never changes
//      shared tables directly; it appends an INTENT (request, release, phase
//      change, page touch...).
//   4. The clock thread RESOLVES the tick: it sorts the intents into a fixed
//      order (spid, task, seq) and applies them, grants pending requests under
//      the selected deadlock policy, runs detection, pages memory, moves the
//      baggage cart, then publishes events and a snapshot.
// The threads really run concurrently and really block, yet every run of a
// scenario produces the same result, because all decisions are made in step 4
// in a fixed order.
//
// LOCKING RULES
//   - `mtx` protects ALL simulation state (flights, scheduler, resources,
//     deadlock data, memory, storage queue). It is also the mutex used with
//     every condition variable below and in Flight/ServiceTask.
//   - Condition-variable waits are always written as
//         while (!predicate) pthread_cond_wait(&cv, &mtx);
//     so spurious wake-ups and missed signals cannot cause errors.
//   - `mtx` is never held while blocking on a semaphore (bounded buffer) or
//     on the child-process pipe, so those waits can never deadlock the engine.
//   - Lock order: mtx -> BaggageBuffer lock -> Output lock.
// ---------------------------------------------------------------------------
#pragma once

#include <pthread.h>

#include <map>
#include <string>
#include <vector>

#include "algo/scheduling.h"
#include "baggage_buffer.h"
#include "baggage_ipc.h"
#include "deadlock.h"
#include "flight.h"
#include "memory.h"
#include "output.h"
#include "protocol.h"
#include "resources.h"
#include "storage.h"
#include "workers.h"

// A side effect produced by a step, applied later in the resolve phase.
struct Intent {
    enum Kind { PHASE, REQUEST, RELEASE_ALL, RELEASE_TASK, START_SERVICES, TOUCH, FINISH } kind;
    int spid;
    int task;  // 0 = the flight itself
    long seq;  // order of intents created by the same thread
    Phase phase;
    ResClass cls;
    int vpn;
};

struct EventRecord {
    long seq;
    int tick;
    std::string kind;
    std::string message;
    std::string dataJson;
};

class Simulation {
public:
    Simulation(Output& output, BaggageHandlerProcess& child);
    ~Simulation();

    void start();     // starts the clock and intake threads
    void shutdown();  // stops and joins every thread (used by reset and quit)

    // Executes one command; returns the JSON "result" object. Throws CommandError.
    std::string handleCommand(const Command& command);
    bool quitRequested() const { return quitFlag; }

    // ----- called by the worker threads (workers.cpp) -----
    void clockLoop();
    void intakeLoop();
    void flightLoop(Flight* flight);
    void serviceLoop(ServiceTask* task);

private:
    // Shared state (guarded by mtx)
    pthread_mutex_t mtx;
    pthread_cond_t ackCv;       // clock waits here for participants to finish their step
    pthread_cond_t controlCv;   // clock waits here while paused
    pthread_cond_t idleCv;      // a command waits here for "sim run-until-quiet" to finish
    pthread_cond_t intakeCv;    // resolve waits here until the intake thread caught up
    pthread_cond_t holdCv;      // debug: intake thread waits here while held

    Output& output;
    BaggageHandlerProcess& child;

    int tick = 0;
    int epoch = 0;
    long version = 0;
    long eventSeq = 0;
    long intentSeq = 0;
    bool running = false;        // continuous run
    int stepBudget = 0;          // ticks requested with "sim step N"
    bool fastRun = false;        // run-until-quiet: no delay between ticks
    int fastRunLimit = 0;
    int tickMs = 500;
    bool tickInProgress = false;
    bool shuttingDown = false;
    bool quitFlag = false;
    std::string scenarioName = "free-play";
    std::string scenarioNote = "Empty apron. Create flights or start a guided scenario.";

    // Threads
    pthread_t clockThread{};
    pthread_t intakeThread{};
    bool threadsRunning = false;
    long clockTid = 0, intakeTid = 0, mainTid = 0;

    // Flights
    std::vector<Flight*> flights;   // all flights of this epoch, in SPID order
    int nextSpid = 1;
    std::vector<ServiceTask*> tasks;
    int nextTaskId = 1;

    // Per-tick lockstep bookkeeping
    int pendingAcks = 0;
    std::vector<Intent> intents;
    bool newBlockThisTick = false;
    std::vector<Flight*> requeueAfterGrants;  // victims and refused flights re-enter READY last

    // Modules
    CpuDispatcher dispatcher;
    std::vector<int> timeline;      // SPID that ran in each tick (-1 = idle)
    std::vector<std::pair<int, std::string>> schedChanges;  // tick, new config
    ResourceTable resources;
    DeadlockManager deadlock;
    MemoryManager memory;
    StorageManager storage;
    BaggageBuffer buffer;
    int bagsProduced = 0;           // counted when a producer starts
    int bagsConsumed = 0;           // counted by the intake thread
    int bagSeq = 0;
    bool intakeHeld = false;        // debug intake hold
    bool storageRequestInFlight = false;  // a pipe round trip to the child is in progress
    std::string invariantError;     // first invariant violation found (empty = OK)
    int invariantChecks = 0;

    // Copies of the child-process exchange, updated under mtx for the snapshot.
    std::string ipcStatus = "RUNNING";
    std::string ipcLastSent, ipcLastReceived, ipcLastError;
    long ipcExchanges = 0;

    std::vector<EventRecord> recentEvents;

    // ----- tick (simulation.cpp) -----
    void runOneTick();
    void admitArrivals();
    void dispatchCpu();
    void runParticipants();
    bool isQuiet() const;
    void joinFinishedThreads();

    // ----- resolve phase (resolve.cpp) -----
    void resolveTick();
    void applyIntent(const Intent& intent);
    void grantPendingRequests();
    bool grantOne(PendingRequest& request, std::string& outcome);
    void markWaiting(PendingRequest& request, const std::string& reason);
    void releaseResourcesOf(int spid, int task);
    void runDetectionAndRecovery();
    void recoverFrom(std::vector<int> deadlocked);
    void refuseOutOfOrder(Flight* flight, ResClass cls);
    void finishFlight(Flight* flight, const std::string& endStatus);
    void requeueDeferredFlights();
    void advanceMemoryReference();
    void advanceStorage();
    void updateServiceProgress();
    void checkInvariants();
    void makeReady(Flight* flight);

    // ----- worker steps (workers.cpp) -----
    bool executeFlightStep(Flight* flight);
    void applyPhaseMarkers(Flight* flight);
    void startServices(Flight* flight);
    void joinServices(Flight* flight);
    void executeServiceStep(ServiceTask* task);
    void produceBags(ServiceTask* task);
    void addIntent(Intent::Kind kind, int spid, int task, Phase phase = Phase::CREATED,
                   ResClass cls = ResClass::GATE, int vpn = 0);
    void acknowledgeTurn();

    // ----- helpers -----
    Flight* findFlight(int spid) const;
    ServiceTask* findTask(int taskId) const;
    std::vector<Flight*> activeFlights() const;
    std::string flightName(int spid) const;
    void emit(const std::string& kind, const std::string& message, const std::string& dataJson = "{}");
    void publishSnapshot();
    std::string snapshotJson();  // snapshot.cpp
    void abortFlight(Flight* flight, const std::string& reason);

    // ----- commands (commands.cpp) -----
    std::string cmdFlight(const Command& c);
    std::string cmdSched(const Command& c);
    std::string cmdDeadlock(const Command& c);
    std::string cmdMem(const Command& c);
    std::string cmdDisk(const Command& c);
    std::string cmdSim(const Command& c);
    std::string cmdScenario(const Command& c);
    std::string cmdSysInfo();
    std::string cmdDebug(const Command& c);
    Flight* createFlight(const std::string& flightNo, OpType op, int priority, int burst, int arrive,
                         const std::vector<Step>* customScript);
    void requireNoResourcesInUse(const std::string& what) const;
    void waitUntilIdle();

    // ----- reset (scenarios.cpp) -----
    void resetWorld(int gates, int trucks, int tugs, int frames);
    void stopWorkerThreads();
    void freeEpochObjects();
};
