// baggage_buffer.h - bounded buffer (classical PRODUCER-CONSUMER problem).
//
// Producers: BAGGAGE worker threads put baggage requests into the buffer.
// Consumer:  the intake thread moves them into the storage queue.
// Synchronisation (textbook solution with POSIX semaphores):
//   sem_t emptySlots  counts free slots   (starts at capacity)
//   sem_t fullSlots   counts filled slots (starts at 0)
//   pthread_mutex_t   protects the slot array and indices
//   produce: sem_wait(empty) -> lock -> insert -> unlock -> sem_post(full)
//   consume: sem_wait(full)  -> lock -> remove -> unlock -> sem_post(empty)
// A producer that finds the buffer full genuinely blocks in sem_wait().
#pragma once

#include <pthread.h>
#include <semaphore.h>

#include <string>
#include <vector>

struct BagItem {
    int position;
    int ownerSpid;
    int task;
    int stampTick;
    int seq;
};

class BaggageBuffer {
public:
    static constexpr int kCapacity = 4;

    // Both return false (with errno text) on failure.
    bool init(std::string& error);
    void destroy();

    // Return false if the buffer is being shut down.
    bool produce(const BagItem& item);
    bool consume(BagItem& item);

    // Shutdown: wake every thread blocked in sem_wait so it can exit.
    void close(int producersToWake);

    int emptyCount();  // sem_getvalue(emptySlots)
    int fullCount();   // sem_getvalue(fullSlots)
    std::vector<BagItem> contents();

private:
    sem_t emptySlots;
    sem_t fullSlots;
    pthread_mutex_t lock;
    BagItem slots[kCapacity];
    int inIndex = 0;
    int outIndex = 0;
    int count = 0;
    bool closing = false;
    bool initialised = false;
};
