// test_protocol.cpp - command-line parsing and JSON escaping.
#include "check.h"
#include "json.h"
#include "protocol.h"

static void testParsesIdWordsAndOptions() {
    Command c;
    std::string error;
    CHECK(parseCommandLine("#17 flight create AI101 TURNAROUND 2 arrive=3", c, error));
    CHECK_EQ(c.id, std::string("17"));
    CHECK_EQ(c.words.size(), (size_t)5);
    CHECK_EQ(c.word(0) + " " + c.word(1) + " " + c.word(2) + " " + c.word(3) + " " + c.word(4),
             std::string("flight create AI101 TURNAROUND 2"));
    CHECK_EQ(c.option("arrive", ""), std::string("3"));
}

static void testRejectsMalformedLines() {
    Command c;
    std::string error;
    CHECK(!parseCommandLine("   ", c, error));
    CHECK(!parseCommandLine("#5", c, error));
    CHECK(!parseCommandLine("sched set q=", c, error));
}

static void testIntegerValidation() {
    CHECK_EQ(parseIntArg("7", "x", 0, 9), 7);
    bool threw = false;
    try { parseIntArg("12", "priority", 0, 9); } catch (const CommandError& e) { threw = e.code == "E_BAD_ARG"; }
    CHECK(threw);
    threw = false;
    try { parseIntArg("4a", "burst", 1, 50); } catch (const CommandError& e) { threw = e.code == "E_BAD_ARG"; }
    CHECK(threw);
    CHECK_EQ(parseIntList("7,0,1", "page", 0, 99), (std::vector<int>{7, 0, 1}));
}

static void testJsonWriter() {
    JsonWriter w;
    w.beginObject().field("a", 1).field("s", std::string("x\"y")).key("list").intArray({1, 2}).endObject();
    CHECK_EQ(w.str(), std::string("{\"a\":1,\"s\":\"x\\\"y\",\"list\":[1,2]}"));
}

void protocolTests() {
    runTest("protocol: id, words and options", testParsesIdWordsAndOptions);
    runTest("protocol: malformed lines are rejected", testRejectsMalformedLines);
    runTest("protocol: integer validation", testIntegerValidation);
    runTest("protocol: JSON writer escaping and nesting", testJsonWriter);
}
