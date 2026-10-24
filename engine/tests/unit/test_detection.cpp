// test_detection.cpp - deadlock detection on the A/B/C scenario.
// Types (Gate3, Truck, Tug), one instance each.
#include "algo/detection.h"
#include "check.h"

static const std::vector<std::vector<int>> kAllocation{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};

// Tick 8: A wants Truck, B wants Tug, C wants Gate3. Nothing is free.
static void testCircularWaitIsDetected() {
    std::vector<std::vector<int>> request{{0, 1, 0}, {0, 0, 1}, {1, 0, 0}};
    DetectionResult r = detectDeadlock({0, 0, 0}, kAllocation, request);
    CHECK_EQ(r.deadlocked, (std::vector<int>{0, 1, 2}));
}

// Tick 7: C has not asked for Gate3 yet, so C can finish and the chain unwinds.
static void testNoFalseDeadlockBeforeCycleCloses() {
    std::vector<std::vector<int>> request{{0, 1, 0}, {0, 0, 1}, {0, 0, 0}};
    DetectionResult r = detectDeadlock({0, 0, 0}, kAllocation, request);
    CHECK(r.deadlocked.empty());
    CHECK_EQ(r.finishOrder, (std::vector<int>{2, 1, 0}));
}

// A process that holds nothing is never reported as deadlocked.
static void testProcessHoldingNothingIsNotDeadlocked() {
    std::vector<std::vector<int>> allocation{{1, 0}, {0, 0}};
    std::vector<std::vector<int>> request{{0, 1}, {1, 0}};
    DetectionResult r = detectDeadlock({0, 0}, allocation, request);
    CHECK_EQ(r.deadlocked, (std::vector<int>{0}));  // P0 waits forever for type 1, which nobody holds
}

void detectionTests() {
    runTest("detection: A/B/C circular wait detected", testCircularWaitIsDetected);
    runTest("detection: no false deadlock at tick 7", testNoFalseDeadlockBeforeCycleCloses);
    runTest("detection: process holding nothing is not deadlocked", testProcessHoldingNothingIsNotDeadlocked);
}
