// test_main.cpp - runs every unit-test group and prints a summary.
#include "check.h"

TestStats& testStats() {
    static TestStats stats;
    return stats;
}

void runTest(const char* name, void (*test)()) {
    int before = testStats().failures;
    test();
    std::cout << (testStats().failures == before ? "  ok    " : "  FAILED ") << name << "\n";
}

void schedulingTests();
void bankerTests();
void detectionTests();
void pagingTests();
void diskTests();
void protocolTests();

int main() {
    std::cout << "TarmacOS unit tests\n";
    schedulingTests();
    bankerTests();
    detectionTests();
    pagingTests();
    diskTests();
    protocolTests();
    std::cout << testStats().checks << " checks, " << testStats().failures << " failures\n";
    return testStats().failures == 0 ? 0 : 1;
}
