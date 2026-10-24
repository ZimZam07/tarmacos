// paging.cpp - FIFO demand paging.
#include "algo/paging.h"

FifoPager::FifoPager(int frameCount) : frames(frameCount > 0 ? frameCount : 1, -1) {}

int FifoPager::frameOf(int page) const {
    for (int f = 0; f < (int)frames.size(); f++)
        if (frames[f] == page) return f;
    return -1;
}

PageAccess FifoPager::access(int page) {
    PageAccess result{page, false, -1, -1, {}};

    int frame = frameOf(page);
    if (frame != -1) {
        // Page hit: FIFO does not change the queue on a hit.
        hitCount++;
        result.hit = true;
        result.frame = frame;
    } else {
        // Page fault: use the lowest free frame, otherwise evict the oldest page.
        faultCount++;
        int target = frameOf(-1);
        if (target == -1) {
            int victim = queue.front();
            queue.pop_front();
            target = frameOf(victim);
            result.evicted = victim;
        }
        frames[target] = page;
        queue.push_back(page);
        result.frame = target;
    }
    result.framesAfter = frames;
    return result;
}

void FifoPager::removePagesOf(int ownerSpid) {
    for (int f = 0; f < (int)frames.size(); f++)
        if (frames[f] != -1 && frames[f] / 100 == ownerSpid) frames[f] = -1;
    std::deque<int> kept;
    for (int page : queue)
        if (page / 100 != ownerSpid) kept.push_back(page);
    queue = kept;
}

std::vector<PageAccess> simulateFifo(int frameCount, const std::vector<int>& references) {
    FifoPager pager(frameCount);
    std::vector<PageAccess> trace;
    for (int page : references) trace.push_back(pager.access(page));
    return trace;
}

int translateAddress(int frame, int offset, int pageSize) {
    return frame * pageSize + offset;
}
