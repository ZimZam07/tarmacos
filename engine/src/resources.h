// resources.h - the airport's shared resources and who owns them.
//
// Every resource instance (Gate G3, fuel truck FT1, ...) has at most ONE
// owner. A request that cannot be satisfied stays in the pending list and the
// requesting flight (or ground-service task) is BLOCKED until it is granted.
// The table is protected by the simulation mutex (see simulation.h).
#pragma once

#include <string>
#include <vector>

#include "flight.h"

struct ResourceInstance {
    std::string id;         // "G3", "FT1", "TG1"
    ResClass cls;
    int beltPosition = -1;  // gates only: position on the baggage belt (0..49)
    bool enabled = true;    // scenarios can close some instances
    int ownerSpid = -1;     // -1 = free
    int ownerTask = 0;      // 0 = held by the flight itself, otherwise a service task id
    int acquiredAtStep = -1;  // script step of the ACQUIRE (used for rollback)
};

struct PendingRequest {
    int spid;          // flight that wants the resource
    int task;          // 0 = the flight itself, otherwise a service task id
    ResClass cls;
    int requestTick;
    int seq;           // tie-breaker inside one tick
    std::string waitReason;  // "" (new), "held" (no free instance), "unsafe" (Banker's)
};

class ResourceTable {
public:
    std::vector<ResourceInstance> instances;
    std::vector<PendingRequest> pending;

    void setup(int gates, int fuelTrucks, int tugs);   // default airport layout
    int findFree(ResClass cls) const;                  // index of the lowest free instance, -1 if none
    int countEnabled(ResClass cls) const;
    int countFree(ResClass cls) const;
    int countHeldBy(int spid, ResClass cls) const;     // includes the flight's service tasks
    int highestRankHeldBy(int spid) const;             // 0 if it holds nothing
    std::vector<int> instancesHeldBy(int spid) const;
    bool hasPending(int spid) const;
    void removePendingOf(int spid);
};
