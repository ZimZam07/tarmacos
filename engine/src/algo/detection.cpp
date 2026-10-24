// detection.cpp - see detection.h for the algorithm description.
#include "algo/detection.h"

DetectionResult detectDeadlock(const std::vector<int>& available,
                               const std::vector<std::vector<int>>& allocation,
                               const std::vector<std::vector<int>>& request) {
    DetectionResult result;
    size_t n = allocation.size();
    size_t m = available.size();
    std::vector<int> work = available;
    std::vector<bool> finish(n, false);

    for (size_t i = 0; i < n; i++) {
        bool holdsNothing = true;
        for (size_t j = 0; j < m; j++)
            if (allocation[i][j] != 0) holdsNothing = false;
        finish[i] = holdsNothing;
    }

    bool progress = true;
    while (progress) {
        progress = false;
        for (size_t i = 0; i < n; i++) {
            if (finish[i]) continue;
            bool canProceed = true;
            for (size_t j = 0; j < m; j++)
                if (request[i][j] > work[j]) canProceed = false;
            if (!canProceed) continue;
            // Process i can get what it wants, finish, and release everything.
            for (size_t j = 0; j < m; j++) work[j] += allocation[i][j];
            finish[i] = true;
            result.finishOrder.push_back((int)i);
            progress = true;
        }
    }

    for (size_t i = 0; i < n; i++)
        if (!finish[i]) result.deadlocked.push_back((int)i);
    return result;
}
