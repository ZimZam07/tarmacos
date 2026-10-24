// detection.h - deadlock DETECTION algorithm for multiple-instance resources.
//
// Textbook algorithm (Silberschatz 8.7.2):
//   Work = Available
//   Finish[i] = true if process i holds nothing (it cannot be part of a cycle)
//   Repeat: find an unfinished i with Request[i] <= Work; then
//           Work += Allocation[i]; Finish[i] = true
//   Every process that is still unfinished is DEADLOCKED.
// Unlike Banker's, this uses what processes are requesting NOW, not their
// maximum claims, so it reports real deadlocks rather than "unsafe" states.
#pragma once

#include <vector>

struct DetectionResult {
    std::vector<int> deadlocked;   // indices of deadlocked processes (empty = none)
    std::vector<int> finishOrder;  // order in which the others could complete
};

DetectionResult detectDeadlock(const std::vector<int>& available,
                               const std::vector<std::vector<int>>& allocation,
                               const std::vector<std::vector<int>>& request);
