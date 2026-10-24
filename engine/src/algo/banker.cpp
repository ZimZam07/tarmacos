// banker.cpp - safety algorithm and resource-request algorithm.
#include "algo/banker.h"

const char* requestVerdictName(RequestVerdict verdict) {
    switch (verdict) {
        case RequestVerdict::GRANT: return "GRANT";
        case RequestVerdict::UNSAFE: return "UNSAFE";
        case RequestVerdict::MUST_WAIT: return "MUST_WAIT";
        case RequestVerdict::EXCEEDS_CLAIM: return "EXCEEDS_CLAIM";
        case RequestVerdict::INVALID: return "INVALID";
    }
    return "?";
}

static bool fitsIn(const Vec& small, const Vec& big) {
    for (size_t j = 0; j < small.size(); j++)
        if (small[j] > big[j]) return false;
    return true;
}

SafetyResult checkSafety(const Vec& available, const Matrix& allocation, const Matrix& maximum) {
    SafetyResult result;
    size_t n = allocation.size();
    size_t m = available.size();

    // Step 1: Need = Max - Allocation
    result.need.assign(n, Vec(m, 0));
    for (size_t i = 0; i < n; i++)
        for (size_t j = 0; j < m; j++) result.need[i][j] = maximum[i][j] - allocation[i][j];

    // Step 2: Work = Available, Finish[i] = false
    Vec work = available;
    std::vector<bool> finish(n, false);

    // Step 3: find the lowest-index unfinished process whose Need <= Work.
    // Step 4: pretend it finishes and releases its allocation; restart the scan.
    bool progress = true;
    while (progress) {
        progress = false;
        for (size_t i = 0; i < n; i++) {
            if (finish[i] || !fitsIn(result.need[i], work)) continue;
            SafetyStep step;
            step.process = (int)i;
            step.workBefore = work;
            for (size_t j = 0; j < m; j++) work[j] += allocation[i][j];
            step.workAfter = work;
            result.steps.push_back(step);
            result.sequence.push_back((int)i);
            finish[i] = true;
            progress = true;
            break;
        }
    }

    // Step 5: safe only if every process could finish.
    result.safe = result.sequence.size() == n;
    return result;
}

RequestResult evaluateRequest(const Vec& available, const Matrix& allocation, const Matrix& maximum,
                              int process, const Vec& request) {
    RequestResult result;
    if (process < 0 || process >= (int)allocation.size() || request.size() != available.size()) {
        result.reason = "invalid process index or request size";
        return result;
    }

    Vec need(available.size());
    for (size_t j = 0; j < available.size(); j++) need[j] = maximum[process][j] - allocation[process][j];

    // 1. A process may never ask for more than it declared.
    if (!fitsIn(request, need)) {
        result.verdict = RequestVerdict::EXCEEDS_CLAIM;
        result.reason = "request exceeds the declared maximum claim (Need)";
        return result;
    }
    // 2. The resources must actually be free right now.
    if (!fitsIn(request, available)) {
        result.verdict = RequestVerdict::MUST_WAIT;
        result.reason = "resources are not available; the process must wait";
        return result;
    }
    // 3. Pretend to grant and test whether the new state is safe.
    result.availableAfter = available;
    result.allocationAfter = allocation;
    for (size_t j = 0; j < available.size(); j++) {
        result.availableAfter[j] -= request[j];
        result.allocationAfter[process][j] += request[j];
    }
    result.safety = checkSafety(result.availableAfter, result.allocationAfter, maximum);
    if (result.safety.safe) {
        result.verdict = RequestVerdict::GRANT;
        result.reason = "the resulting state is safe";
    } else {
        result.verdict = RequestVerdict::UNSAFE;
        result.reason = "granting would leave no safe sequence, so the request is deferred";
    }
    return result;
}
