// memory.h - the active-flight memory area, managed with demand paging.
//
// Each flight owns 4 logical pages of "flight information":
//   page 0 flight plan        (touched when the airport phase changes)
//   page 1 allocation record  (touched when it acquires or releases a resource)
//   page 2 service log        (touched by the refuelling worker)
//   page 3 baggage list       (touched by the baggage worker)
// Pages are loaded only when first touched (demand paging) into a small,
// global pool of frames; FIFO replacement chooses the victim (algo/paging.h).
// This is a simulation: no real machine memory is being managed.
#pragma once

#include <deque>
#include <string>
#include <vector>

#include "algo/paging.h"

struct MemoryRecord {
    int tick;
    int spid;  // 0 = the reference-string preset
    int vpn;
    std::string reason;
    PageAccess access;
};

class MemoryManager {
public:
    static constexpr int kPagesPerFlight = 4;
    static constexpr int kPageSize = 256;

    void reset(int frameCount);
    // Accesses page vpn of flight spid and records the result.
    PageAccess touch(int spid, int vpn, int tick, const std::string& reason);
    void freeFlight(int spid);

    // Reference-string preset: one queued reference is processed per tick.
    void queueReferences(const std::vector<int>& pages);
    bool hasQueuedReference() const { return !queued.empty(); }
    int popQueuedReference();

    static int pageKey(int spid, int vpn) { return spid * 100 + vpn; }
    static const char* pageName(int vpn);

    FifoPager pager{8};
    std::vector<int> referenceString;  // full preset string, for display
    int referencesDone = 0;
    std::deque<MemoryRecord> history;  // most recent accesses (oldest first)

private:
    std::deque<int> queued;
};
