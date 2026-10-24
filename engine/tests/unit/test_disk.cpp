// test_disk.cpp - DISK-REF-1 (Silberschatz) and DISK-REF-2 (apron).
#include "algo/disk.h"
#include "check.h"

static const std::vector<int> kTextbookQueue{98, 183, 37, 122, 14, 124, 65, 67};
static const std::vector<int> kApronQueue{5, 37, 12, 44, 21, 3};

static void testTextbookCase() {
    DiskPlan fcfs = planDisk(DiskAlgo::FCFS, Direction::UP, 53, 0, 199, kTextbookQueue);
    CHECK_EQ(fcfs.totalMovement, 640);
    CHECK_EQ(fcfs.order, kTextbookQueue);

    DiskPlan sstf = planDisk(DiskAlgo::SSTF, Direction::UP, 53, 0, 199, kTextbookQueue);
    CHECK_EQ(sstf.order, (std::vector<int>{65, 67, 37, 14, 98, 122, 124, 183}));
    CHECK_EQ(sstf.totalMovement, 236);

    DiskPlan scanDown = planDisk(DiskAlgo::SCAN, Direction::DOWN, 53, 0, 199, kTextbookQueue);
    CHECK_EQ(scanDown.order, (std::vector<int>{37, 14, 65, 67, 98, 122, 124, 183}));
    CHECK_EQ(scanDown.path, (std::vector<int>{53, 37, 14, 0, 65, 67, 98, 122, 124, 183}));
    CHECK_EQ(scanDown.totalMovement, 236);

    DiskPlan scanUp = planDisk(DiskAlgo::SCAN, Direction::UP, 53, 0, 199, kTextbookQueue);
    CHECK_EQ(scanUp.order, (std::vector<int>{65, 67, 98, 122, 124, 183, 37, 14}));
    CHECK_EQ(scanUp.totalMovement, 331);
}

static void testApronCase() {
    DiskPlan fcfs = planDisk(DiskAlgo::FCFS, Direction::UP, 20, 0, 49, kApronQueue);
    CHECK_EQ(fcfs.totalMovement, 145);

    DiskPlan sstf = planDisk(DiskAlgo::SSTF, Direction::UP, 20, 0, 49, kApronQueue);
    CHECK_EQ(sstf.order, (std::vector<int>{21, 12, 5, 3, 37, 44}));
    CHECK_EQ(sstf.totalMovement, 60);

    DiskPlan scanUp = planDisk(DiskAlgo::SCAN, Direction::UP, 20, 0, 49, kApronQueue);
    CHECK_EQ(scanUp.order, (std::vector<int>{21, 37, 44, 12, 5, 3}));
    CHECK_EQ(scanUp.path, (std::vector<int>{20, 21, 37, 44, 49, 12, 5, 3}));
    CHECK_EQ(scanUp.totalMovement, 75);

    DiskPlan scanDown = planDisk(DiskAlgo::SCAN, Direction::DOWN, 20, 0, 49, kApronQueue);
    CHECK_EQ(scanDown.order, (std::vector<int>{12, 5, 3, 21, 37, 44}));
    CHECK_EQ(scanDown.totalMovement, 64);
}

static void testScanWithoutReversal() {
    // All requests are ahead of the head, so SCAN never needs to visit the edge.
    DiskPlan p = planDisk(DiskAlgo::SCAN, Direction::UP, 10, 0, 49, {30, 20});
    CHECK_EQ(p.path, (std::vector<int>{10, 20, 30}));
    CHECK_EQ(p.totalMovement, 20);
}

static void testSstfTieGoesToLowerPosition() {
    DiskPlan p = planDisk(DiskAlgo::SSTF, Direction::UP, 20, 0, 49, {25, 15});
    CHECK_EQ(p.order, (std::vector<int>{15, 25}));
}

static void testInvalidInput() {
    CHECK(!planDisk(DiskAlgo::FCFS, Direction::UP, 60, 0, 49, {1}).error.empty());
    CHECK(!planDisk(DiskAlgo::FCFS, Direction::UP, 10, 0, 49, {50}).error.empty());
    CHECK_EQ(planDisk(DiskAlgo::SSTF, Direction::UP, 10, 0, 49, {}).totalMovement, 0);
}

void diskTests() {
    runTest("disk: Silberschatz case FCFS 640, SSTF 236, SCAN 236/331", testTextbookCase);
    runTest("disk: apron case FCFS 145, SSTF 60, SCAN 75/64", testApronCase);
    runTest("disk: SCAN without reversal does not visit the edge", testScanWithoutReversal);
    runTest("disk: SSTF tie goes to the lower position", testSstfTieGoesToLowerPosition);
    runTest("disk: invalid positions are rejected", testInvalidInput);
}
