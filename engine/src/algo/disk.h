// disk.h - disk-scheduling algorithms: FCFS, SSTF and SCAN.
//
// In TarmacOS the baggage cart plays the role of the disk head and positions
// on the baggage belt (0..49 by default) play the role of cylinders. This is
// an analogy only: no real disk I/O happens.
//
// Conventions (provisional, documented in 09 section 8.4):
//   - SSTF: on a tie in distance, the LOWER position is served first.
//   - SCAN: move in the current direction serving every request, continue to
//     the edge (minCyl or maxCyl) only if requests remain on the other side,
//     then reverse. The edge visit counts toward head movement.
#pragma once

#include <string>
#include <vector>

enum class DiskAlgo { FCFS, SSTF, SCAN };
enum class Direction { UP, DOWN };

const char* diskAlgoName(DiskAlgo algo);
bool parseDiskAlgo(const std::string& text, DiskAlgo& algo);
const char* directionName(Direction dir);
bool parseDirection(const std::string& text, Direction& dir);

struct DiskPlan {
    std::string error;          // non-empty if the input was invalid
    std::vector<int> order;     // requests in service order
    std::vector<int> path;      // head positions visited, starting at the head (includes a SCAN edge)
    int totalMovement = 0;      // sum of |path[i+1] - path[i]|
};

DiskPlan planDisk(DiskAlgo algo, Direction dir, int head, int minCyl, int maxCyl,
                  const std::vector<int>& requests);
