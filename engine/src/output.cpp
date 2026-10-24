// output.cpp - line-buffered JSON output.
#include "output.h"

#include <cstdio>

Output::Output() { pthread_mutex_init(&lock, nullptr); }
Output::~Output() { pthread_mutex_destroy(&lock); }

void Output::writeLine(const std::string& json) {
    pthread_mutex_lock(&lock);
    std::fwrite(json.data(), 1, json.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);  // the bridge reads line by line, so flush every line
    pthread_mutex_unlock(&lock);
}
