// paging.h - demand paging with FIFO page replacement.
//
// Pages are plain integers. The live engine encodes "page vpn of flight spid"
// as spid * 100 + vpn so one global FIFO queue can hold pages of every flight
// (global replacement). The reference-string presets use owner 0, so their
// pages are just the numbers from the string.
//
// FIFO rule: on a page fault with no free frame, evict the page that has been
// resident the LONGEST (the head of the FIFO queue), regardless of how often
// or how recently it was used.
#pragma once

#include <deque>
#include <string>
#include <vector>

struct PageAccess {
    int page;
    bool hit;
    int frame;                   // frame that holds the page after the access
    int evicted;                 // page that was replaced, -1 if none
    std::vector<int> framesAfter;  // frame contents after the access (-1 = empty)
};

class FifoPager {
public:
    explicit FifoPager(int frameCount = 3);

    PageAccess access(int page);
    void removePagesOf(int ownerSpid);  // frees the frames of a finished flight

    int frameCount() const { return (int)frames.size(); }
    int faults() const { return faultCount; }
    int hits() const { return hitCount; }
    const std::vector<int>& frameContents() const { return frames; }
    const std::deque<int>& fifoQueue() const { return queue; }
    int frameOf(int page) const;  // -1 if not resident

private:
    std::vector<int> frames;  // frames[f] = page in frame f, or -1
    std::deque<int> queue;    // resident pages, oldest first
    int faultCount = 0;
    int hitCount = 0;
};

// Runs a whole reference string from empty frames (used by the unit tests).
std::vector<PageAccess> simulateFifo(int frameCount, const std::vector<int>& references);

// Address translation for a resident page: physical = frame * pageSize + offset.
int translateAddress(int frame, int offset, int pageSize);
