// scheduling.h - CPU scheduling algorithms (FCFS, Priority, Round Robin).
//
// The same CpuDispatcher class is used in two places:
//   1. simulateSchedule() below, a pure tick-by-tick simulation used by the
//      unit tests and by the "scheduler reference" checks.
//   2. The live engine (simulation.cpp), which asks the dispatcher once per
//      tick which flight may use the single "apron control CPU".
// Using one class for both guarantees that the live Gantt chart follows
// exactly the same rules as the hand-checked reference results.
//
// Conventions (documented in tarmacos_blueprint/09 section 8.1, configurable,
// NOT claimed to be the instructor's convention):
//   - Priority: a LOWER number means a HIGHER priority.
//   - Ties: earlier arrival first, then smaller SPID.
//   - Round Robin: a process whose quantum expires goes to the TAIL of the
//     ready queue, behind processes that became ready during that tick.
#pragma once

#include <deque>
#include <string>
#include <vector>

enum class SchedAlgo { FCFS, PRIORITY, RR };

const char* schedAlgoName(SchedAlgo algo);
bool parseSchedAlgo(const std::string& text, SchedAlgo& algo);

struct SchedConfig {
    SchedAlgo algo = SchedAlgo::FCFS;
    int quantum = 4;          // Round Robin time slice in ticks
    bool preemptive = false;  // Priority only: may a better process interrupt?
};

// The information the dispatcher needs about one ready process.
struct ReadyEntry {
    int spid;
    int priority;
    int arrival;
};

// What happened at the start of one tick (used for events and the Gantt chart).
struct TickDecision {
    int runningSpid = -1;   // process that uses the CPU this tick, -1 = idle
    bool newDispatch = false;
    int expiredSpid = -1;   // Round Robin: quantum ran out
    int preemptedSpid = -1; // Priority: interrupted by a better process
};

class CpuDispatcher {
public:
    SchedConfig config;

    void reset();
    void makeReady(const ReadyEntry& entry);  // process enters the ready queue
    void removeFromReady(int spid);
    bool isReady(int spid) const;
    std::vector<int> readyOrder() const;      // display order of the ready queue

    // Called once at the start of every tick.
    TickDecision chooseForTick();

    // The running process blocked or finished during the tick.
    void releaseCpu();

    int running() const { return runningEntry.spid; }
    int sliceUsed() const { return ticksInSlice; }

private:
    std::deque<ReadyEntry> readyQueue;
    ReadyEntry runningEntry{-1, 0, 0};
    int ticksInSlice = 0;

    int indexOfNext() const;  // index in readyQueue of the process to run next
};

// ---------- Pure simulation (no threads) ----------

struct SchedJob {
    int spid;
    int arrival;
    int burst;
    int priority;
};

struct GanttSlice {
    int spid;   // -1 means the CPU was idle
    int start;  // inclusive tick
    int end;    // exclusive tick
};

struct JobResult {
    int spid;
    int arrival;
    int burst;
    int priority;
    int firstStart;
    int completion;
    int turnaround;  // completion - arrival
    int waiting;     // turnaround - burst (time spent in the ready queue)
    int response;    // firstStart - arrival
};

struct SchedResult {
    std::string error;  // non-empty when the input was invalid
    std::vector<GanttSlice> gantt;
    std::vector<JobResult> jobs;  // in SPID order
    double averageWaiting = 0;
    double averageTurnaround = 0;
};

SchedResult simulateSchedule(const std::vector<SchedJob>& jobs, const SchedConfig& config);

// Merges a per-tick list of running SPIDs into Gantt slices.
std::vector<GanttSlice> compressTimeline(const std::vector<int>& spidPerTick);
