// banker.h - Banker's algorithm (deadlock AVOIDANCE).
//
// Matrices use the textbook names (Silberschatz):
//   available[j]      free instances of resource type j
//   allocation[i][j]  instances of type j held by process i
//   maximum[i][j]     maximum claim of process i for type j (declared in advance)
//   need[i][j]        maximum - allocation (what process i may still ask for)
//
// The safety algorithm repeatedly picks the LOWEST-index unfinished process
// whose Need fits in Work, pretends it finishes, and returns its allocation
// to Work. If every process can finish this way the state is SAFE.
// Note: an UNSAFE state is not a deadlock; it only means the system can no
// longer guarantee that every process will finish.
#pragma once

#include <string>
#include <vector>

using Vec = std::vector<int>;
using Matrix = std::vector<std::vector<int>>;

struct SafetyStep {
    int process;  // index of the process that could finish
    Vec workBefore;
    Vec workAfter;
};

struct SafetyResult {
    bool safe = false;
    Matrix need;
    std::vector<int> sequence;      // safe sequence (complete only if safe)
    std::vector<SafetyStep> steps;  // trace for the UI and the viva
};

SafetyResult checkSafety(const Vec& available, const Matrix& allocation, const Matrix& maximum);

enum class RequestVerdict { GRANT, UNSAFE, MUST_WAIT, EXCEEDS_CLAIM, INVALID };

const char* requestVerdictName(RequestVerdict verdict);

struct RequestResult {
    RequestVerdict verdict = RequestVerdict::INVALID;
    std::string reason;
    // State that was tested ("pretend the request is granted").
    Vec availableAfter;
    Matrix allocationAfter;
    SafetyResult safety;
};

// Resource-request algorithm: may process `process` receive `request` now?
RequestResult evaluateRequest(const Vec& available, const Matrix& allocation, const Matrix& maximum,
                              int process, const Vec& request);
