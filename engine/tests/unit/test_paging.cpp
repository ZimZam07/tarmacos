// test_paging.cpp - FIFO reference strings (Silberschatz and Belady).
#include "algo/paging.h"
#include "check.h"

static const std::vector<int> kSilberschatz{7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1};
static const std::vector<int> kBelady{1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5};

static int countFaults(const std::vector<PageAccess>& trace) {
    int faults = 0;
    for (const PageAccess& a : trace)
        if (!a.hit) faults++;
    return faults;
}

static void testSilberschatzThreeFrames() {
    std::vector<PageAccess> trace = simulateFifo(3, kSilberschatz);
    CHECK_EQ(countFaults(trace), 15);
    CHECK_EQ((int)trace.size() - countFaults(trace), 5);
    CHECK_EQ(trace.back().framesAfter, (std::vector<int>{7, 0, 1}));
    // Step-by-step checks: the 4th reference (page 2) evicts page 7 from frame 0.
    CHECK_EQ(trace[3].evicted, 7);
    CHECK_EQ(trace[3].frame, 0);
    CHECK(trace[4].hit);  // page 0 is still resident
    // The 6th reference (page 3) evicts page 0, the oldest remaining page.
    CHECK_EQ(trace[5].evicted, 0);
}

static void testFifoQueueOrder() {
    FifoPager pager(3);
    for (int page : kSilberschatz) pager.access(page);
    CHECK_EQ(std::vector<int>(pager.fifoQueue().begin(), pager.fifoQueue().end()), (std::vector<int>{7, 0, 1}));
    CHECK_EQ(pager.faults(), 15);
    CHECK_EQ(pager.hits(), 5);
}

static void testBeladyAnomaly() {
    CHECK_EQ(countFaults(simulateFifo(3, kBelady)), 9);
    CHECK_EQ(countFaults(simulateFifo(4, kBelady)), 10);  // more frames, MORE faults
}

static void testAddressTranslation() {
    FifoPager pager(3);
    pager.access(7);
    pager.access(0);  // page 0 is loaded into frame 1
    CHECK_EQ(pager.frameOf(0), 1);
    CHECK_EQ(translateAddress(pager.frameOf(0), 42, 256), 298);
}

static void testRemovePagesOfFlight() {
    FifoPager pager(4);
    pager.access(101);  // flight 1, page 1
    pager.access(201);  // flight 2, page 1
    pager.access(102);
    pager.removePagesOf(1);
    CHECK_EQ(pager.frameContents(), (std::vector<int>{-1, 201, -1, -1}));
    CHECK_EQ((int)pager.fifoQueue().size(), 1);
    PageAccess a = pager.access(305);
    CHECK_EQ(a.frame, 0);  // the lowest free frame is reused
}

static void testEmptyReferenceString() {
    CHECK(simulateFifo(3, {}).empty());
}

void pagingTests() {
    runTest("paging: FIFO Silberschatz string, 3 frames = 15 faults", testSilberschatzThreeFrames);
    runTest("paging: FIFO queue order", testFifoQueueOrder);
    runTest("paging: Belady anomaly 9 vs 10 faults", testBeladyAnomaly);
    runTest("paging: address translation (page 0, offset 42) -> 298", testAddressTranslation);
    runTest("paging: frames of a finished flight are freed", testRemovePagesOfFlight);
    runTest("paging: empty reference string", testEmptyReferenceString);
}
