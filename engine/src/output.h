// output.h - writes one JSON object per line to stdout.
// Several threads emit output (main thread, clock thread), so each line is
// written under its own mutex; this is the innermost lock in the engine.
#pragma once

#include <pthread.h>

#include <string>

class Output {
public:
    Output();
    ~Output();
    void writeLine(const std::string& json);

private:
    pthread_mutex_t lock;
};
