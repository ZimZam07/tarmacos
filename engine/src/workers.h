// workers.h - ground-service worker threads (POSIX pthreads).
//
// When a flight reaches its SERVICES step, its thread starts one pthread per
// ground service (pthread_create with a pointer to a ServiceTask as the
// argument). The flight then waits BLOCKED until all services are done, and
// its thread collects each worker's result with pthread_join (the worker
// returns a heap-allocated ServiceResult through pthread_exit).
//   REFUEL  : requests a fuel truck, works for 3 ticks, releases the truck.
//   BAGGAGE : produces 3 baggage requests into the bounded buffer (sem_t),
//             then waits until the baggage cart has served all of them.
#pragma once

#include <pthread.h>

class Simulation;
struct Flight;

enum class ServiceKind { REFUEL, BAGGAGE };
enum class TaskState { NEW, WAITING_GRANT, WORKING, WAITING_BAGS, FINISHING, DONE };

const char* serviceKindName(ServiceKind kind);
const char* taskStateName(TaskState state);

struct ServiceResult {
    int waitTicks;      // ticks spent waiting for a resource or for the cart
    int workTicks;
    int bagsDelivered;
};

struct ServiceTask {
    int taskId = 0;
    int ownerSpid = 0;
    ServiceKind kind = ServiceKind::REFUEL;
    TaskState state = TaskState::NEW;
    int workLeft = 3;        // REFUEL work ticks
    int bagsTotal = 3;
    int bagsServed = 0;
    int gatePosition = 0;    // belt position used for baggage requests
    int startTick = 0;
    int waitTicks = 0;
    int workTicks = 0;

    Simulation* sim = nullptr;
    pthread_t thread{};
    pthread_cond_t wakeup;   // signalled when the task gets a turn in a tick
    bool hasTurn = false;
    bool joined = false;
    bool producingBags = false;   // currently inside the bounded-buffer code
    bool blockedOnFullBuffer = false;
    long tid = 0;
};

// Thread entry points (the void* argument is a Simulation*, Flight* or ServiceTask*).
void* clockThreadMain(void* simulation);
void* intakeThreadMain(void* simulation);
void* serviceThreadMain(void* task);

struct FlightThreadArgs {
    Simulation* sim;
    Flight* flight;
};
void* flightThreadMain(void* flightThreadArgs);
