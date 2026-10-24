// check.h - a minimal test harness (no external test framework needed).
//
// CHECK(cond) and CHECK_EQ(actual, expected) record failures with the file and
// line, and the test binary returns a non-zero exit code if anything failed.
#pragma once

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

struct TestStats {
    int checks = 0;
    int failures = 0;
};
TestStats& testStats();

template <typename T>
std::string toText(const T& value) {
    std::ostringstream out;
    out << value;
    return out.str();
}

template <typename T>
std::string toText(const std::vector<T>& values) {
    std::ostringstream out;
    out << "[";
    for (size_t i = 0; i < values.size(); i++) out << (i ? "," : "") << values[i];
    out << "]";
    return out.str();
}

#define CHECK(cond)                                                                   \
    do {                                                                              \
        testStats().checks++;                                                         \
        if (!(cond)) {                                                                \
            testStats().failures++;                                                   \
            std::cerr << "  FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
        }                                                                             \
    } while (0)

#define CHECK_EQ(actual, expected)                                                             \
    do {                                                                                       \
        testStats().checks++;                                                                  \
        auto actualValue_ = (actual);                                                          \
        auto expectedValue_ = (expected);                                                      \
        if (!(actualValue_ == expectedValue_)) {                                               \
            testStats().failures++;                                                            \
            std::cerr << "  FAIL " << __FILE__ << ":" << __LINE__ << "  " #actual " = "        \
                      << toText(actualValue_) << ", expected " << toText(expectedValue_) << "\n"; \
        }                                                                                      \
    } while (0)

// Each test file registers its test functions with this.
void runTest(const char* name, void (*test)());
