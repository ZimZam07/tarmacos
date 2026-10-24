// main.cpp - TarmacOS engine entry point.
//
// Start-up order matters:
//   1. ignore SIGPIPE (a dead child must not kill the engine on write()),
//   2. fork the baggage-handler child process while we are still single-threaded,
//   3. only then create the simulation threads,
//   4. read commands from stdin until EOF or "quit".
#include <unistd.h>

#include <csignal>
#include <iostream>
#include <string>

#include "json.h"
#include "simulation.h"

static void respond(Output& out, const std::string& id, bool ok, const std::string& resultJson,
                    const std::string& code = "", const std::string& message = "") {
    JsonWriter w;
    w.beginObject().field("type", "resp").field("id", id).field("ok", ok);
    if (ok) w.key("result").raw(resultJson);
    else w.key("error").beginObject().field("code", code).field("msg", message).endObject();
    out.writeLine(w.endObject().str());
}

int main() {
    std::signal(SIGPIPE, SIG_IGN);
    Output output;

    BaggageHandlerProcess child;
    std::string error;
    if (!child.start(error)) {
        output.writeLine(JsonWriter().beginObject().field("type", "fatal").field("msg", error).endObject().str());
        return 1;
    }

    Simulation sim(output, child);
    try {
        sim.start();
    } catch (const CommandError& e) {
        output.writeLine(JsonWriter().beginObject().field("type", "fatal").field("msg", e.what()).endObject().str());
        child.stop();
        return 1;
    }
    output.writeLine(JsonWriter().beginObject().field("type", "ready").field("engine_pid", (int)getpid())
                         .field("child_pid", (int)child.childPid).endObject().str());

    std::string line;
    while (std::getline(std::cin, line)) {
        Command command;
        std::string parseError;
        if (!parseCommandLine(line, command, parseError)) {
            if (line.find_first_not_of(" \t\r") == std::string::npos) continue;  // ignore blank lines
            respond(output, command.id, false, "", "E_PARSE", parseError);
            continue;
        }
        try {
            respond(output, command.id, true, sim.handleCommand(command));
        } catch (const CommandError& e) {
            respond(output, command.id, false, "", e.code, e.what());
        } catch (const std::exception& e) {
            respond(output, command.id, false, "", "E_INTERNAL", e.what());
        }
        if (sim.quitRequested()) break;
    }

    // Clean shutdown: join every thread, then stop and reap the child process.
    sim.shutdown();
    child.stop();
    output.writeLine(JsonWriter().beginObject().field("type", "exit").field("child", child.exitDescription)
                         .endObject().str());
    return 0;
}
