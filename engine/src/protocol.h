// protocol.h - parsing of text command lines.
//
// A command line looks like:
//     #17 flight create AI101 TURNAROUND 2 arrive=0
// "#17" is an optional request id (the bridge uses it to match responses),
// plain words are positional arguments, and name=value words are options.
#pragma once

#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// Thrown by command handlers; turned into {"ok":false,"error":{code,msg}}.
class CommandError : public std::runtime_error {
public:
    CommandError(const std::string& code, const std::string& message)
        : std::runtime_error(message), code(code) {}
    std::string code;
};

struct Command {
    std::string id;                              // request id without '#', may be empty
    std::vector<std::string> words;              // positional words
    std::map<std::string, std::string> options;  // name=value pairs

    std::string word(size_t index) const;  // "" if missing
    bool hasOption(const std::string& name) const { return options.count(name) > 0; }
    std::string option(const std::string& name, const std::string& fallback) const;
};

// Returns false (with a message) for an empty or malformed line.
bool parseCommandLine(const std::string& line, Command& command, std::string& error);

// Strict integer parsing with range checking; throws CommandError(E_BAD_ARG).
int parseIntArg(const std::string& text, const std::string& what, int minValue, int maxValue);

// Parses "1,2,3" into numbers within the range; throws CommandError(E_BAD_ARG).
std::vector<int> parseIntList(const std::string& text, const std::string& what, int minValue, int maxValue);

std::string toUpper(std::string text);
