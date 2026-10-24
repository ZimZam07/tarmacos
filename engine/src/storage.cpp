// storage.cpp - baggage cart (disk head) movement.
#include "storage.h"

#include <algorithm>
#include <cstdlib>

void StorageManager::reset() {
    waiting.clear();
    busy = false;
    batch.clear();
    plan = DiskPlan();
    waypointIsRequest.clear();
    nextWaypoint = 1;
    movedInBatch = 0;
    batchesDone = 0;
    totalMovement = 0;
    requestsServed = 0;
    lastBatchMovement = -1;
    served.clear();
    headTrail.clear();
}

void StorageManager::addRequest(const DiskRequest& request) { waiting.push_back(request); }

std::vector<DiskRequest> StorageManager::takeBatch(int currentTick) {
    std::vector<DiskRequest> ready, later;
    for (const DiskRequest& r : waiting) (r.stampTick < currentTick ? ready : later).push_back(r);
    // Requests from several worker threads may reach the queue in any order;
    // sorting by (tick, owner, task, seq) makes every run reproducible.
    std::sort(ready.begin(), ready.end(), [](const DiskRequest& a, const DiskRequest& b) {
        if (a.stampTick != b.stampTick) return a.stampTick < b.stampTick;
        if (a.ownerSpid != b.ownerSpid) return a.ownerSpid < b.ownerSpid;
        if (a.task != b.task) return a.task < b.task;
        return a.seq < b.seq;
    });
    waiting = later;
    return ready;
}

std::vector<int> StorageManager::positionsOf(const std::vector<DiskRequest>& requests) const {
    std::vector<int> positions;
    for (const DiskRequest& r : requests) positions.push_back(r.position);
    return positions;
}

void StorageManager::startBatch(const std::vector<DiskRequest>& requests, const DiskPlan& childPlan) {
    batch = requests;
    plan = childPlan;
    busy = true;
    nextWaypoint = 1;
    batchStartHead = head;
    movedInBatch = 0;

    // Mark which path points are requests (the others are the SCAN edge).
    waypointIsRequest.assign(plan.path.size(), false);
    size_t nextOrder = 0;
    for (size_t i = 1; i < plan.path.size(); i++) {
        if (nextOrder < plan.order.size() && plan.path[i] == plan.order[nextOrder]) {
            waypointIsRequest[i] = true;
            nextOrder++;
        }
    }
}

std::vector<DiskRequest> StorageManager::advanceCart(int tick) {
    std::vector<DiskRequest> servedNow;
    int budget = cartSpeed;
    while (busy && nextWaypoint < plan.path.size()) {
        int target = plan.path[nextWaypoint];
        int distance = std::abs(target - head);
        int step = std::min(distance, budget);
        head += target > head ? step : -step;
        budget -= step;
        movedInBatch += step;
        totalMovement += step;
        if (head != target) break;  // ran out of movement for this tick

        if (waypointIsRequest[nextWaypoint]) {
            // Serve the first unserved batch request at this position.
            for (auto it = batch.begin(); it != batch.end(); ++it) {
                if (it->position == target) {
                    servedNow.push_back(*it);
                    served.push_back(ServedRecord{tick, target, it->ownerSpid});
                    batch.erase(it);
                    break;
                }
            }
            requestsServed++;
        }
        nextWaypoint++;
    }
    while (served.size() > 40) served.pop_front();

    if (busy && nextWaypoint >= plan.path.size()) {
        busy = false;
        batchesDone++;
        lastBatchMovement = movedInBatch;
    }
    headTrail.push_back(head);
    while (headTrail.size() > 120) headTrail.pop_front();
    return servedNow;
}
