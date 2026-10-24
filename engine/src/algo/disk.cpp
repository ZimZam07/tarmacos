// disk.cpp - FCFS, SSTF and SCAN service order and head movement.
#include "algo/disk.h"

#include <algorithm>
#include <cstdlib>

const char* diskAlgoName(DiskAlgo algo) {
    switch (algo) {
        case DiskAlgo::FCFS: return "FCFS";
        case DiskAlgo::SSTF: return "SSTF";
        case DiskAlgo::SCAN: return "SCAN";
    }
    return "?";
}

bool parseDiskAlgo(const std::string& text, DiskAlgo& algo) {
    if (text == "FCFS") { algo = DiskAlgo::FCFS; return true; }
    if (text == "SSTF") { algo = DiskAlgo::SSTF; return true; }
    if (text == "SCAN") { algo = DiskAlgo::SCAN; return true; }
    return false;
}

const char* directionName(Direction dir) { return dir == Direction::UP ? "UP" : "DOWN"; }

bool parseDirection(const std::string& text, Direction& dir) {
    if (text == "UP") { dir = Direction::UP; return true; }
    if (text == "DOWN") { dir = Direction::DOWN; return true; }
    return false;
}

// SSTF: repeatedly pick the pending request closest to the current head.
static std::vector<int> sstfOrder(int head, std::vector<int> pending) {
    std::vector<int> order;
    while (!pending.empty()) {
        size_t best = 0;
        for (size_t i = 1; i < pending.size(); i++) {
            int d = std::abs(pending[i] - head), bestD = std::abs(pending[best] - head);
            if (d < bestD || (d == bestD && pending[i] < pending[best])) best = i;
        }
        head = pending[best];
        order.push_back(head);
        pending.erase(pending.begin() + best);
    }
    return order;
}

// SCAN (elevator): sweep in one direction, then reverse.
// Returns the path, including the edge if the head has to turn around.
static std::vector<int> scanPath(Direction dir, int head, int minCyl, int maxCyl, const std::vector<int>& requests,
                                 std::vector<int>& order) {
    std::vector<int> ahead, behind;
    for (int r : requests) {
        bool isAhead = dir == Direction::UP ? r >= head : r <= head;
        (isAhead ? ahead : behind).push_back(r);
    }
    if (dir == Direction::UP) {
        std::sort(ahead.begin(), ahead.end());                     // serve upward
        std::sort(behind.begin(), behind.end(), std::greater<>());  // then downward
    } else {
        std::sort(ahead.begin(), ahead.end(), std::greater<>());
        std::sort(behind.begin(), behind.end());
    }

    std::vector<int> path{head};
    for (int r : ahead) { path.push_back(r); order.push_back(r); }
    if (!behind.empty()) {
        path.push_back(dir == Direction::UP ? maxCyl : minCyl);  // travel to the edge, then reverse
        for (int r : behind) { path.push_back(r); order.push_back(r); }
    }
    return path;
}

DiskPlan planDisk(DiskAlgo algo, Direction dir, int head, int minCyl, int maxCyl,
                  const std::vector<int>& requests) {
    DiskPlan plan;
    if (minCyl > maxCyl) { plan.error = "invalid cylinder range"; return plan; }
    if (head < minCyl || head > maxCyl) { plan.error = "head position is outside the cylinder range"; return plan; }
    for (int r : requests)
        if (r < minCyl || r > maxCyl) { plan.error = "request position is outside the cylinder range"; return plan; }

    if (algo == DiskAlgo::SCAN) {
        plan.path = scanPath(dir, head, minCyl, maxCyl, requests, plan.order);
    } else {
        plan.order = algo == DiskAlgo::FCFS ? requests : sstfOrder(head, requests);
        plan.path.push_back(head);
        for (int r : plan.order) plan.path.push_back(r);
    }
    for (size_t i = 1; i < plan.path.size(); i++) plan.totalMovement += std::abs(plan.path[i] - plan.path[i - 1]);
    return plan;
}
