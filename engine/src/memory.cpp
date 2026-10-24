// memory.cpp - MemoryManager.
#include "memory.h"

void MemoryManager::reset(int frameCount) {
    pager = FifoPager(frameCount);
    referenceString.clear();
    referencesDone = 0;
    history.clear();
    queued.clear();
}

PageAccess MemoryManager::touch(int spid, int vpn, int tick, const std::string& reason) {
    PageAccess access = pager.access(pageKey(spid, vpn));
    history.push_back(MemoryRecord{tick, spid, vpn, reason, access});
    while (history.size() > 64) history.pop_front();
    return access;
}

void MemoryManager::freeFlight(int spid) { pager.removePagesOf(spid); }

void MemoryManager::queueReferences(const std::vector<int>& pages) {
    for (int p : pages) {
        queued.push_back(p);
        referenceString.push_back(p);
    }
}

int MemoryManager::popQueuedReference() {
    int page = queued.front();
    queued.pop_front();
    referencesDone++;
    return page;
}

const char* MemoryManager::pageName(int vpn) {
    switch (vpn) {
        case 0: return "flight plan";
        case 1: return "allocation record";
        case 2: return "service log";
        case 3: return "baggage list";
    }
    return "reference page";
}
