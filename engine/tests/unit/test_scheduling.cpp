// test_scheduling.cpp - hand-calculated reference cases from
// tarmacos_blueprint/09 section 8.1 (SCHED-REF and EMERGENCY).
#include "algo/scheduling.h"
#include "check.h"

// SCHED-REF: all arrive at 0.  P1 burst 6 prio 3, P2 3/1, P3 8/4, P4 2/2.
static std::vector<SchedJob> schedRef() {
    return {{1, 0, 6, 3}, {2, 0, 3, 1}, {3, 0, 8, 4}, {4, 0, 2, 2}};
}

static std::vector<int> waits(const SchedResult& r) {
    std::vector<int> w;
    for (const JobResult& j : r.jobs) w.push_back(j.waiting);
    return w;
}
static std::vector<int> turnarounds(const SchedResult& r) {
    std::vector<int> t;
    for (const JobResult& j : r.jobs) t.push_back(j.turnaround);
    return t;
}
// Gantt as "spid:start-end" strings for readable comparisons.
static std::vector<std::string> gantt(const SchedResult& r) {
    std::vector<std::string> g;
    for (const GanttSlice& s : r.gantt)
        g.push_back(std::to_string(s.spid) + ":" + std::to_string(s.start) + "-" + std::to_string(s.end));
    return g;
}

static void testFcfs() {
    SchedConfig cfg;
    cfg.algo = SchedAlgo::FCFS;
    SchedResult r = simulateSchedule(schedRef(), cfg);
    CHECK_EQ(r.error, std::string(""));
    CHECK_EQ(gantt(r), (std::vector<std::string>{"1:0-6", "2:6-9", "3:9-17", "4:17-19"}));
    CHECK_EQ(waits(r), (std::vector<int>{0, 6, 9, 17}));
    CHECK_EQ(turnarounds(r), (std::vector<int>{6, 9, 17, 19}));
    CHECK_EQ(r.averageWaiting, 8.0);
    CHECK_EQ(r.averageTurnaround, 12.75);
}

static void testPriorityNonPreemptive() {
    SchedConfig cfg;
    cfg.algo = SchedAlgo::PRIORITY;
    SchedResult r = simulateSchedule(schedRef(), cfg);
    CHECK_EQ(gantt(r), (std::vector<std::string>{"2:0-3", "4:3-5", "1:5-11", "3:11-19"}));
    CHECK_EQ(waits(r), (std::vector<int>{5, 0, 11, 3}));
    CHECK_EQ(turnarounds(r), (std::vector<int>{11, 3, 19, 5}));
    CHECK_EQ(r.averageWaiting, 4.75);
    CHECK_EQ(r.averageTurnaround, 9.5);
}

static void testRoundRobin() {
    SchedConfig cfg;
    cfg.algo = SchedAlgo::RR;
    cfg.quantum = 4;
    SchedResult r = simulateSchedule(schedRef(), cfg);
    CHECK_EQ(gantt(r), (std::vector<std::string>{"1:0-4", "2:4-7", "3:7-11", "4:11-13", "1:13-15", "3:15-19"}));
    CHECK_EQ(waits(r), (std::vector<int>{9, 4, 11, 11}));
    CHECK_EQ(turnarounds(r), (std::vector<int>{15, 7, 19, 13}));
    CHECK_EQ(r.averageWaiting, 8.75);
    CHECK_EQ(r.averageTurnaround, 13.5);
}

// EMERGENCY: P1 arrives 0 burst 5 prio 3; P2 (emergency) arrives 2 burst 2 prio 0.
static void testEmergency() {
    std::vector<SchedJob> jobs{{1, 0, 5, 3}, {2, 2, 2, 0}};
    SchedConfig cfg;
    cfg.algo = SchedAlgo::PRIORITY;

    cfg.preemptive = false;
    SchedResult off = simulateSchedule(jobs, cfg);
    CHECK_EQ(gantt(off), (std::vector<std::string>{"1:0-5", "2:5-7"}));
    CHECK_EQ(waits(off), (std::vector<int>{0, 3}));
    CHECK_EQ(turnarounds(off), (std::vector<int>{5, 5}));

    cfg.preemptive = true;
    SchedResult on = simulateSchedule(jobs, cfg);
    CHECK_EQ(gantt(on), (std::vector<std::string>{"1:0-2", "2:2-4", "1:4-7"}));
    CHECK_EQ(waits(on), (std::vector<int>{2, 0}));
    CHECK_EQ(turnarounds(on), (std::vector<int>{7, 2}));
}

// Equal priorities are broken by arrival time, then by SPID.
static void testPriorityTieBreak() {
    std::vector<SchedJob> jobs{{3, 0, 1, 1}, {1, 0, 1, 1}, {2, 0, 1, 0}};
    SchedConfig cfg;
    cfg.algo = SchedAlgo::PRIORITY;
    SchedResult r = simulateSchedule(jobs, cfg);
    CHECK_EQ(gantt(r), (std::vector<std::string>{"2:0-1", "1:1-2", "3:2-3"}));
}

// A gap between arrivals leaves the CPU idle (spid -1 in the Gantt chart).
static void testIdleGap() {
    std::vector<SchedJob> jobs{{1, 0, 2, 1}, {2, 4, 1, 1}};
    SchedConfig cfg;
    SchedResult r = simulateSchedule(jobs, cfg);
    CHECK_EQ(gantt(r), (std::vector<std::string>{"1:0-2", "-1:2-4", "2:4-5"}));
    CHECK_EQ(waits(r), (std::vector<int>{0, 0}));
}

static void testInvalidInput() {
    SchedConfig cfg;
    CHECK_EQ(simulateSchedule({}, cfg).error, std::string("no processes to schedule"));
    CHECK_EQ(simulateSchedule({{1, 0, 0, 1}}, cfg).error, std::string("burst time must be at least 1"));
    CHECK_EQ(simulateSchedule({{1, -1, 2, 1}}, cfg).error, std::string("arrival time cannot be negative"));
    CHECK_EQ(simulateSchedule({{1, 0, 2, 1}, {1, 0, 2, 1}}, cfg).error, std::string("duplicate process id"));
    cfg.algo = SchedAlgo::RR;
    cfg.quantum = 0;
    CHECK_EQ(simulateSchedule({{1, 0, 2, 1}}, cfg).error, std::string("quantum must be at least 1"));
}

void schedulingTests() {
    runTest("scheduling: FCFS reference case", testFcfs);
    runTest("scheduling: Priority (non-preemptive) reference case", testPriorityNonPreemptive);
    runTest("scheduling: Round Robin q=4 reference case", testRoundRobin);
    runTest("scheduling: emergency flight, preemption off/on", testEmergency);
    runTest("scheduling: priority tie-breaking", testPriorityTieBreak);
    runTest("scheduling: idle CPU gap", testIdleGap);
    runTest("scheduling: invalid input is rejected", testInvalidInput);
}
