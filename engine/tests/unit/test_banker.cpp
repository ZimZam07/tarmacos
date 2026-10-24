// test_banker.cpp - BANKER-REF from tarmacos_blueprint/09 section 8.2.
// Types (Gate, Fuel, Tug), totals (3,2,2).
//        Allocation  Max     Need
//   P1   1 1 0       1 2 1   0 1 1
//   P2   1 0 1       1 1 2   0 1 1
//   P3   1 0 0       1 2 2   0 2 2
//   Available = (0,1,1)
#include "algo/banker.h"
#include "check.h"

static const Vec kAvailable{0, 1, 1};
static const Matrix kAllocation{{1, 1, 0}, {1, 0, 1}, {1, 0, 0}};
static const Matrix kMaximum{{1, 2, 1}, {1, 1, 2}, {1, 2, 2}};

static void testInitialStateIsSafe() {
    SafetyResult r = checkSafety(kAvailable, kAllocation, kMaximum);
    CHECK(r.safe);
    CHECK_EQ(r.sequence, (std::vector<int>{0, 1, 2}));
    CHECK_EQ(r.need[2], (Vec{0, 2, 2}));
    CHECK_EQ(r.steps[0].workAfter, (Vec{1, 2, 1}));
    CHECK_EQ(r.steps[1].workAfter, (Vec{2, 2, 2}));
    CHECK_EQ(r.steps[2].workAfter, (Vec{3, 2, 2}));
}

static void testSafeRequestGranted() {
    RequestResult r = evaluateRequest(kAvailable, kAllocation, kMaximum, 0, {0, 1, 0});  // R1
    CHECK(r.verdict == RequestVerdict::GRANT);
    CHECK_EQ(r.availableAfter, (Vec{0, 0, 1}));
    CHECK_EQ(r.safety.sequence, (std::vector<int>{0, 1, 2}));
}

static void testUnsafeRequestDeferred() {
    RequestResult r = evaluateRequest(kAvailable, kAllocation, kMaximum, 2, {0, 1, 0});  // R2
    CHECK(r.verdict == RequestVerdict::UNSAFE);
    CHECK(!r.safety.safe);
    CHECK_EQ(r.safety.sequence.size(), (size_t)0);  // nobody can finish from Work = (0,0,1)
}

static void testRequestExceedingClaimRejected() {
    RequestResult r = evaluateRequest(kAvailable, kAllocation, kMaximum, 1, {0, 0, 2});  // R3
    CHECK(r.verdict == RequestVerdict::EXCEEDS_CLAIM);
}

static void testUnavailableRequestMustWait() {
    RequestResult r = evaluateRequest(kAvailable, kAllocation, kMaximum, 2, {0, 2, 0});
    CHECK(r.verdict == RequestVerdict::MUST_WAIT);
}

// The A/B/C preset under avoidance: C's request for the Tug is unsafe.
// Types (Gate3, Truck, Tug). A holds Gate3, B holds Truck, C holds nothing.
static void testAbcScenarioTugRequestUnsafe() {
    Matrix allocation{{1, 0, 0}, {0, 1, 0}, {0, 0, 0}};
    Matrix maximum{{1, 1, 0}, {0, 1, 1}, {1, 0, 1}};
    RequestResult r = evaluateRequest({0, 0, 1}, allocation, maximum, 2, {0, 0, 1});
    CHECK(r.verdict == RequestVerdict::UNSAFE);
    // Without C's request the state is safe with sequence B, A, C.
    SafetyResult s = checkSafety({0, 0, 1}, allocation, maximum);
    CHECK(s.safe);
    CHECK_EQ(s.sequence, (std::vector<int>{1, 0, 2}));
}

void bankerTests() {
    runTest("banker: BANKER-REF initial state is safe <P1,P2,P3>", testInitialStateIsSafe);
    runTest("banker: R1 (P1 asks a fuel truck) is granted", testSafeRequestGranted);
    runTest("banker: R2 (P3 asks a fuel truck) is unsafe", testUnsafeRequestDeferred);
    runTest("banker: R3 (P2 asks two tugs) exceeds its claim", testRequestExceedingClaimRejected);
    runTest("banker: unavailable request must wait", testUnavailableRequestMustWait);
    runTest("banker: A/B/C preset, C's tug request is unsafe", testAbcScenarioTugRequestUnsafe);
}
