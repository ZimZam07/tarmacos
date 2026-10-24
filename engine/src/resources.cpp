// resources.cpp - resource table helpers.
#include "resources.h"

#include <algorithm>

// Gates G1..G6 sit at belt positions 5, 13, 21, 29, 37, 45 (one every 8 units).
void ResourceTable::setup(int gates, int fuelTrucks, int tugs) {
    instances.clear();
    pending.clear();
    for (int i = 1; i <= gates; i++) {
        ResourceInstance r;
        r.id = "G" + std::to_string(i);
        r.cls = ResClass::GATE;
        r.beltPosition = 5 + (i - 1) * 8;
        instances.push_back(r);
    }
    for (int i = 1; i <= fuelTrucks; i++) {
        ResourceInstance r;
        r.id = "FT" + std::to_string(i);
        r.cls = ResClass::FUEL_TRUCK;
        instances.push_back(r);
    }
    for (int i = 1; i <= tugs; i++) {
        ResourceInstance r;
        r.id = "TG" + std::to_string(i);
        r.cls = ResClass::TUG;
        instances.push_back(r);
    }
}

int ResourceTable::findFree(ResClass cls) const {
    for (int i = 0; i < (int)instances.size(); i++)
        if (instances[i].cls == cls && instances[i].enabled && instances[i].ownerSpid == -1) return i;
    return -1;
}

int ResourceTable::countEnabled(ResClass cls) const {
    int n = 0;
    for (const ResourceInstance& r : instances)
        if (r.cls == cls && r.enabled) n++;
    return n;
}

int ResourceTable::countFree(ResClass cls) const {
    int n = 0;
    for (const ResourceInstance& r : instances)
        if (r.cls == cls && r.enabled && r.ownerSpid == -1) n++;
    return n;
}

int ResourceTable::countHeldBy(int spid, ResClass cls) const {
    int n = 0;
    for (const ResourceInstance& r : instances)
        if (r.cls == cls && r.ownerSpid == spid) n++;
    return n;
}

int ResourceTable::highestRankHeldBy(int spid) const {
    int rank = 0;
    for (const ResourceInstance& r : instances)
        if (r.ownerSpid == spid) rank = std::max(rank, resClassRank(r.cls));
    return rank;
}

std::vector<int> ResourceTable::instancesHeldBy(int spid) const {
    std::vector<int> held;
    for (int i = 0; i < (int)instances.size(); i++)
        if (instances[i].ownerSpid == spid) held.push_back(i);
    return held;
}

bool ResourceTable::hasPending(int spid) const {
    for (const PendingRequest& p : pending)
        if (p.spid == spid) return true;
    return false;
}

void ResourceTable::removePendingOf(int spid) {
    pending.erase(std::remove_if(pending.begin(), pending.end(),
                                 [spid](const PendingRequest& p) { return p.spid == spid; }),
                  pending.end());
}
