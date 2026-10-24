// baggage_ipc.h - the REAL child process and its two pipes (Assignment 3 pattern).
//
//   parent (engine)                      child (baggage handler)
//   requestPipe[1] --- "SCHED ..." --->  requestPipe[0]
//   resultPipe[0]  <-- "ORDER ..." ----  resultPipe[1]
//
// The child is created with fork() at engine start-up, BEFORE any thread
// exists (forking a multi-threaded process copies only the calling thread,
// which can leave locks held by vanished threads). It is stateless: it
// receives a batch of baggage positions, computes the disk-scheduling order
// with algo/disk.h, and writes the answer back. On shutdown the parent sends
// QUIT, closes its pipe ends, and reaps the child with waitpid().
//
// A binary semaphore (sem_t initialised to 1) guarantees that only one
// request/response exchange uses the pipes at a time.
#pragma once

#include <semaphore.h>
#include <sys/types.h>

#include <string>
#include <vector>

#include "algo/disk.h"

class BaggageHandlerProcess {
public:
    bool start(std::string& error);

    // One request/response round trip. Returns false on timeout, EOF or a bad reply.
    bool requestPlan(DiskAlgo algo, Direction dir, int head, int minCyl, int maxCyl,
                     const std::vector<int>& positions, DiskPlan& plan, std::string& error);

    // QUIT -> close -> read until EOF -> waitpid. Returns the child's exit code.
    int stop();

    // Non-blocking check: reaps the child if it has died (exit-status handling).
    void checkIfExited();

    pid_t childPid = -1;
    int requestWriteFd = -1;  // parent's end of the request pipe
    int resultReadFd = -1;    // parent's end of the result pipe
    std::string status = "NOT_STARTED";  // RUNNING, FAILED, EXITED
    std::string exitDescription;
    long messagesSent = 0;
    long messagesReceived = 0;
    std::string lastSent;
    std::string lastReceived;

private:
    sem_t channelLock;  // binary semaphore
    std::string readBuffer;
    bool readLine(std::string& line, int timeoutMs, std::string& error);
    void describeExit(int waitStatus);
};

// Entry point of the child process (never returns).
[[noreturn]] void baggageChildMain(int requestReadFd, int resultWriteFd);
