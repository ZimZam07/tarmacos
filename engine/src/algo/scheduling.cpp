// scheduling.cpp - implementation of the dispatcher and the pure simulator.
#include "algo/scheduling.h"

#include <algorithm>
#include <map>
#include <set>

const char* schedAlgoName(SchedAlgo algo) {
    switch (algo) {
        case SchedAlgo::FCFS: return "FCFS";
        case SchedAlgo::PRIORITY: return "PRIORITY";
        case SchedAlgo::RR: return "RR";
    }
    return "?";
}

bool parseSchedAlgo(const std::string& text, SchedAlgo& algo) {
    if (text == "FCFS") { algo = SchedAlgo::FCFS; return true; }
    if (text == "PRIORITY") { algo = SchedAlgo::PRIORITY; return true; }
    if (text == "RR") { algo = SchedAlgo::RR; return true; }
    return false;
}

void CpuDispatcher::reset() {
    readyQueue.clear();
    runningEntry = ReadyEntry{-1, 0, 0};
    ticksInSlice = 0;
}

void CpuDispatcher::makeReady(const ReadyEntry& entry) {
    readyQueue.push_back(entry);  // FCFS and RR: always join at the tail
}

void CpuDispatcher::removeFromReady(int spid) {
    for (auto it = readyQueue.begin(); it != readyQueue.end(); ++it) {
        if (it->spid == spid) {
            readyQueue.erase(it);
            return;
        }
    }
}

bool CpuDispatcher::isReady(int spid) const {
    for (const ReadyEntry& e : readyQueue)
        if (e.spid == spid) return true;
    return false;
}

// Returns true if a should run before b under priority scheduling.
static bool betterPriority(const ReadyEntry& a, const ReadyEntry& b) {
    if (a.priority != b.priority) return a.priority < b.priority;  // lower number wins
    if (a.arrival != b.arrival) return a.arrival < b.arrival;
    return a.spid < b.spid;
}

int CpuDispatcher::indexOfNext() const {
    if (readyQueue.empty()) return -1;
    if (config.algo != SchedAlgo::PRIORITY) return 0;  // FCFS and RR take the head
    int best = 0;
    for (int i = 1; i < (int)readyQueue.size(); i++)
        if (betterPriority(readyQueue[i], readyQueue[best])) best = i;
    return best;
}

std::vector<int> CpuDispatcher::readyOrder() const {
    std::vector<ReadyEntry> copy(readyQueue.begin(), readyQueue.end());
    if (config.algo == SchedAlgo::PRIORITY)
        std::stable_sort(copy.begin(), copy.end(), betterPriority);
    std::vector<int> order;
    for (const ReadyEntry& e : copy) order.push_back(e.spid);
    return order;
}

TickDecision CpuDispatcher::chooseForTick() {
    TickDecision decision;

    if (runningEntry.spid != -1) {
        bool quantumExpired = config.algo == SchedAlgo::RR && ticksInSlice >= config.quantum;
        int next = indexOfNext();
        bool preempt = config.algo == SchedAlgo::PRIORITY && config.preemptive && next != -1 &&
                       betterPriority(readyQueue[next], runningEntry) &&
                       readyQueue[next].priority < runningEntry.priority;

        if (quantumExpired) {
            // Round Robin re-queuing: the process goes behind everyone who is
            // already waiting (including processes that arrived this tick).
            decision.expiredSpid = runningEntry.spid;
            readyQueue.push_back(runningEntry);
            runningEntry.spid = -1;
        } else if (preempt) {
            decision.preemptedSpid = runningEntry.spid;
            readyQueue.push_back(runningEntry);
            runningEntry.spid = -1;
        }
    }

    if (runningEntry.spid == -1) {
        int next = indexOfNext();
        if (next != -1) {
            runningEntry = readyQueue[next];
            readyQueue.erase(readyQueue.begin() + next);
            ticksInSlice = 0;
            decision.newDispatch = true;
        }
    }

    if (runningEntry.spid != -1) ticksInSlice++;
    decision.runningSpid = runningEntry.spid;
    // If RR re-queued a process and it was the only one, it is dispatched again.
    if (decision.newDispatch && decision.expiredSpid == decision.runningSpid) decision.newDispatch = false;
    return decision;
}

void CpuDispatcher::releaseCpu() {
    runningEntry.spid = -1;
    ticksInSlice = 0;
}

std::vector<GanttSlice> compressTimeline(const std::vector<int>& spidPerTick) {
    std::vector<GanttSlice> slices;
    for (int t = 0; t < (int)spidPerTick.size(); t++) {
        if (!slices.empty() && slices.back().spid == spidPerTick[t] && slices.back().end == t)
            slices.back().end = t + 1;
        else
            slices.push_back(GanttSlice{spidPerTick[t], t, t + 1});
    }
    return slices;
}

static std::string validateJobs(const std::vector<SchedJob>& jobs, const SchedConfig& config) {
    if (jobs.empty()) return "no processes to schedule";
    if (config.quantum < 1) return "quantum must be at least 1";
    std::set<int> seen;
    for (const SchedJob& j : jobs) {
        if (j.burst < 1) return "burst time must be at least 1";
        if (j.arrival < 0) return "arrival time cannot be negative";
        if (!seen.insert(j.spid).second) return "duplicate process id";
    }
    return "";
}

SchedResult simulateSchedule(const std::vector<SchedJob>& jobs, const SchedConfig& config) {
    SchedResult result;
    result.error = validateJobs(jobs, config);
    if (!result.error.empty()) return result;

    // Admit processes in arrival order, ties by SPID (same rule as the engine).
    std::vector<SchedJob> byArrival = jobs;
    std::stable_sort(byArrival.begin(), byArrival.end(), [](const SchedJob& a, const SchedJob& b) {
        return a.arrival != b.arrival ? a.arrival < b.arrival : a.spid < b.spid;
    });

    CpuDispatcher dispatcher;
    dispatcher.config = config;
    std::map<int, int> remaining, firstStart, completion;
    for (const SchedJob& j : jobs) remaining[j.spid] = j.burst;

    std::vector<int> timeline;
    size_t nextArrival = 0;
    size_t finished = 0;
    for (int tick = 0; finished < jobs.size() && tick < 1000000; tick++) {
        while (nextArrival < byArrival.size() && byArrival[nextArrival].arrival == tick) {
            const SchedJob& j = byArrival[nextArrival++];
            dispatcher.makeReady(ReadyEntry{j.spid, j.priority, j.arrival});
        }
        TickDecision d = dispatcher.chooseForTick();
        timeline.push_back(d.runningSpid);
        if (d.runningSpid == -1) continue;  // CPU idle this tick

        if (!firstStart.count(d.runningSpid)) firstStart[d.runningSpid] = tick;
        if (--remaining[d.runningSpid] == 0) {
            completion[d.runningSpid] = tick + 1;  // finishes at the end of this tick
            dispatcher.releaseCpu();
            finished++;
        }
    }

    result.gantt = compressTimeline(timeline);
    std::vector<SchedJob> bySpid = jobs;
    std::sort(bySpid.begin(), bySpid.end(), [](const SchedJob& a, const SchedJob& b) { return a.spid < b.spid; });
    double totalWait = 0, totalTat = 0;
    for (const SchedJob& j : bySpid) {
        JobResult r;
        r.spid = j.spid;
        r.arrival = j.arrival;
        r.burst = j.burst;
        r.priority = j.priority;
        r.firstStart = firstStart[j.spid];
        r.completion = completion[j.spid];
        r.turnaround = r.completion - r.arrival;
        r.waiting = r.turnaround - r.burst;
        r.response = r.firstStart - r.arrival;
        totalWait += r.waiting;
        totalTat += r.turnaround;
        result.jobs.push_back(r);
    }
    result.averageWaiting = totalWait / jobs.size();
    result.averageTurnaround = totalTat / jobs.size();
    return result;
}
