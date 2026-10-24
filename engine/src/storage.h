// storage.h - the baggage belt modelled as a disk.
//
// Analogy: positions 0..49 on the baggage belt are "cylinders" and the
// baggage cart is the "disk head". Requests wait in a queue; when the cart is
// idle it takes every waiting request as one BATCH, asks the baggage-handler
// child process (real fork + pipes, baggage_ipc.h) for the service order, and
// then drives along that path at a fixed speed per tick.
// Simplification (TL-5): requests that arrive while a batch is being served
// wait for the next batch.
#pragma once

#include <deque>
#include <string>
#include <vector>

#include "algo/disk.h"

struct DiskRequest {
    int position;
    int ownerSpid;   // 0 = reference preset
    int task;        // baggage service task id (0 for presets)
    int stampTick;   // tick in which it was produced
    int seq;
};

struct ServedRecord {
    int tick;
    int position;
    int ownerSpid;
};

class StorageManager {
public:
    DiskAlgo algo = DiskAlgo::FCFS;
    Direction direction = Direction::UP;
    int head = 20;
    int minCyl = 0;
    int maxCyl = 49;
    int cartSpeed = 4;  // positions per tick

    std::vector<DiskRequest> waiting;  // queued, not yet in a batch

    bool busy = false;                  // a batch is being served
    std::vector<DiskRequest> batch;
    DiskPlan plan;                      // order and path for the batch (from the child process)
    std::vector<bool> waypointIsRequest;
    size_t nextWaypoint = 1;
    int batchStartHead = 0;
    int movedInBatch = 0;
    int batchesDone = 0;
    int totalMovement = 0;
    int requestsServed = 0;
    int lastBatchMovement = -1;
    std::deque<ServedRecord> served;    // recent services
    std::deque<int> headTrail;          // head position at the end of each tick (recent)

    void reset();
    void addRequest(const DiskRequest& request);
    // Requests produced before currentTick, in a fixed (deterministic) order.
    std::vector<DiskRequest> takeBatch(int currentTick);
    void startBatch(const std::vector<DiskRequest>& requests, const DiskPlan& childPlan);
    // Moves the cart for one tick; returns the requests served during this tick.
    std::vector<DiskRequest> advanceCart(int tick);
    std::vector<int> positionsOf(const std::vector<DiskRequest>& requests) const;
};
