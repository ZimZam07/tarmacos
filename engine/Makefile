# TarmacOS engine - build with:  make        (engine binary)
#                                make test   (unit tests)
#                                make golden (engine scenario tests, needs python3)
CXX      := g++
CXXFLAGS := -std=c++17 -Wall -Wextra -Werror -O2 -pthread -Isrc
LDFLAGS  := -pthread
BUILD    := build

ALGO_SRC   := src/algo/scheduling.cpp src/algo/banker.cpp src/algo/detection.cpp \
              src/algo/paging.cpp src/algo/disk.cpp
COMMON_SRC := src/json.cpp src/protocol.cpp
ENGINE_SRC := src/main.cpp src/output.cpp src/flight.cpp src/resources.cpp src/deadlock.cpp src/memory.cpp \
              src/storage.cpp src/baggage_buffer.cpp src/baggage_ipc.cpp src/simulation.cpp \
              src/workers.cpp src/resolve.cpp src/snapshot.cpp src/commands.cpp src/scenarios.cpp
TEST_SRC   := $(wildcard tests/unit/*.cpp)

ENGINE_OBJ := $(patsubst %.cpp,$(BUILD)/%.o,$(ENGINE_SRC) $(ALGO_SRC) $(COMMON_SRC))
TEST_OBJ   := $(patsubst %.cpp,$(BUILD)/%.o,$(TEST_SRC) $(ALGO_SRC) $(COMMON_SRC))

.PHONY: all test golden clean

all: $(BUILD)/tarmac_engine

$(BUILD)/tarmac_engine: $(ENGINE_OBJ)
	$(CXX) $(LDFLAGS) -o $@ $^

$(BUILD)/unit_tests: $(TEST_OBJ)
	$(CXX) $(LDFLAGS) -o $@ $^

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

test: $(BUILD)/unit_tests
	./$(BUILD)/unit_tests

golden: all
	python3 tests/golden/run_golden.py

clean:
	rm -rf $(BUILD)

-include $(ENGINE_OBJ:.o=.d) $(TEST_OBJ:.o=.d)
