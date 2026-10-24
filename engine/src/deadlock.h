// deadlock.h - the four deadlock-handling policies.
//
//   PREVENTION  make deadlock impossible by breaking one Coffman condition.
//               TarmacOS breaks CIRCULAR WAIT with a resource order
//               (Gate < Fuel truck < Tug); an out-of-order request is REFUSED.
//   AVOIDANCE   flights declare maximum claims; a request is granted only if
//               Banker's algorithm says the resulting state is SAFE, otherwise
//               it is DEFERRED (the flight waits without the resource).
//   DETECTION   requests are granted whenever possible; the detection
//               algorithm then REPORTS any deadlock but does nothing about it.
//   RECOVERY    detection + action: a victim is chosen and either rolled back
//               (its resources are preempted) or terminated.
// Prevention and avoidance act BEFORE a request is granted; detection and
// recovery act AFTER a deadlock has formed.
#pragma once

#include <string>
#include <vector>

#include "algo/banker.h"
#include "flight.h"
#include "resources.h"

enum class DeadlockPolicy { PREVENTION, AVOIDANCE, DETECTION, RECOVERY };
enum class RecoveryAction { PREEMPT, TERMINATE };

const char* policyName(DeadlockPolicy p);
bool parsePolicy(const std::string& text, DeadlockPolicy& p);
const char* recoveryActionName(RecoveryAction a);
bool parseRecoveryAction(const std::string& text, RecoveryAction& a);

// Matrices built from the live tables (rows = active flights in SPID order,
// columns = GATE, FUEL_TRUCK, TUG).
struct ResourceMatrices {
    std::vector<int> spids;
    Vec available;
    Matrix allocation;
    Matrix maximum;
    Matrix request;
};

ResourceMatrices buildMatrices(const ResourceTable& table, const std::vector<Flight*>& activeFlights);

struct WaitEdge {
    int fromSpid;  // waiting flight
    int toSpid;    // flight holding the resource it wants
    std::string resourceId;
};

class DeadlockManager {
public:
    DeadlockPolicy policy = DeadlockPolicy::RECOVERY;
    RecoveryAction action = RecoveryAction::PREEMPT;

    // Results kept for the Deadlock Observatory view.
    bool hasBankerCheck = false;
    int bankerTick = -1;
    int bankerRequester = -1;
    ResClass bankerClass = ResClass::GATE;
    ResourceMatrices bankerMatrices;
    RequestResult bankerResult;

    std::vector<int> deadlockedSpids;  // current deadlock (empty = none right now)
    std::vector<int> lastDetectedSpids;  // most recent deadlock found, kept after recovery
    int detectedAtTick = -1;
    int detectionRuns = 0;
    std::vector<std::string> recoveryLog;

    void reset();

    // PREVENTION: true if the request would break the resource order.
    bool violatesOrdering(const ResourceTable& table, int spid, ResClass cls) const;

    // AVOIDANCE: Banker's resource-request algorithm for one instance of cls.
    RequestResult checkWithBanker(const ResourceTable& table, const std::vector<Flight*>& activeFlights,
                                  int spid, ResClass cls, int tick);

    // DETECTION: returns the SPIDs of deadlocked flights.
    std::vector<int> detect(const ResourceTable& table, const std::vector<Flight*>& activeFlights);

    // RECOVERY victim: lowest priority (largest number), then the youngest (largest SPID).
    int chooseVictim(const std::vector<int>& deadlocked, const std::vector<Flight*>& activeFlights) const;

    static std::vector<WaitEdge> waitForEdges(const ResourceTable& table);
};

// The standalone BANKER-REF example (09 section 8.2), computed by the engine
// for the "Safety check" panel. requestNo: 0 = state only, 1..3 = R1..R3.
std::string bankerReferenceJson(int requestNo);
