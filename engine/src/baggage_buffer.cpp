// baggage_buffer.cpp - semaphore-based bounded buffer.
#include "baggage_buffer.h"

#include <cerrno>
#include <cstring>

bool BaggageBuffer::init(std::string& error) {
    inIndex = outIndex = count = 0;
    closing = false;
    if (sem_init(&emptySlots, 0, kCapacity) != 0 || sem_init(&fullSlots, 0, 0) != 0 ||
        pthread_mutex_init(&lock, nullptr) != 0) {
        error = std::string("bounded buffer init failed: ") + std::strerror(errno);
        return false;
    }
    initialised = true;
    return true;
}

void BaggageBuffer::destroy() {
    if (!initialised) return;
    sem_destroy(&emptySlots);
    sem_destroy(&fullSlots);
    pthread_mutex_destroy(&lock);
    initialised = false;
}

// sem_wait can be interrupted by a signal (EINTR); retry in that case.
static void waitOn(sem_t* sem) {
    while (sem_wait(sem) != 0 && errno == EINTR) {
    }
}

bool BaggageBuffer::produce(const BagItem& item) {
    waitOn(&emptySlots);  // blocks while all slots are full
    pthread_mutex_lock(&lock);
    if (closing) {
        pthread_mutex_unlock(&lock);
        return false;
    }
    slots[inIndex] = item;
    inIndex = (inIndex + 1) % kCapacity;
    count++;
    pthread_mutex_unlock(&lock);
    sem_post(&fullSlots);  // one more item for the consumer
    return true;
}

bool BaggageBuffer::consume(BagItem& item) {
    waitOn(&fullSlots);  // blocks while the buffer is empty
    pthread_mutex_lock(&lock);
    if (closing) {
        pthread_mutex_unlock(&lock);
        return false;
    }
    item = slots[outIndex];
    outIndex = (outIndex + 1) % kCapacity;
    count--;
    pthread_mutex_unlock(&lock);
    sem_post(&emptySlots);  // one more free slot for producers
    return true;
}

void BaggageBuffer::close(int producersToWake) {
    pthread_mutex_lock(&lock);
    closing = true;
    pthread_mutex_unlock(&lock);
    sem_post(&fullSlots);  // wake the consumer
    for (int i = 0; i < producersToWake; i++) sem_post(&emptySlots);
}

int BaggageBuffer::emptyCount() {
    int value = 0;
    sem_getvalue(&emptySlots, &value);
    return value;
}

int BaggageBuffer::fullCount() {
    int value = 0;
    sem_getvalue(&fullSlots, &value);
    return value;
}

std::vector<BagItem> BaggageBuffer::contents() {
    std::vector<BagItem> items;
    pthread_mutex_lock(&lock);
    for (int i = 0; i < count; i++) items.push_back(slots[(outIndex + i) % kCapacity]);
    pthread_mutex_unlock(&lock);
    return items;
}
