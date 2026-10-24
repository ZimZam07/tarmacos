// protocol.cpp - command line tokenizing and argument validation.
#include "protocol.h"

#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <sstream>

std::string Command::word(size_t index) const { return index < words.size() ? words[index] : ""; }

std::string Command::option(const std::string& name, const std::string& fallback) const {
    auto it = options.find(name);
    return it == options.end() ? fallback : it->second;
}

std::string toUpper(std::string text) {
    for (char& c : text) c = (char)std::toupper((unsigned char)c);
    return text;
}

bool parseCommandLine(const std::string& line, Command& command, std::string& error) {
    command = Command();
    std::istringstream in(line);
    std::string token;
    bool first = true;
    while (in >> token) {
        if (first && token[0] == '#') {
            command.id = token.substr(1);
            first = false;
            continue;
        }
        first = false;
        size_t eq = token.find('=');
        if (eq == std::string::npos) {
            command.words.push_back(token);
        } else if (eq == 0 || eq == token.size() - 1) {
            error = "malformed option '" + token + "' (expected name=value)";
            return false;
        } else {
            command.options[token.substr(0, eq)] = token.substr(eq + 1);
        }
    }
    if (command.words.empty()) {
        error = "empty command";
        return false;
    }
    return true;
}

int parseIntArg(const std::string& text, const std::string& what, int minValue, int maxValue) {
    if (text.empty()) throw CommandError("E_BAD_ARG", what + " is missing");
    char* end = nullptr;
    errno = 0;
    long value = std::strtol(text.c_str(), &end, 10);
    if (errno != 0 || *end != '\0')
        throw CommandError("E_BAD_ARG", what + " must be a whole number, got '" + text + "'");
    if (value < minValue || value > maxValue)
        throw CommandError("E_BAD_ARG", what + " must be between " + std::to_string(minValue) + " and " +
                                            std::to_string(maxValue));
    return (int)value;
}

std::vector<int> parseIntList(const std::string& text, const std::string& what, int minValue, int maxValue) {
    std::vector<int> numbers;
    std::stringstream in(text);
    std::string item;
    while (std::getline(in, item, ',')) numbers.push_back(parseIntArg(item, what, minValue, maxValue));
    if (numbers.empty()) throw CommandError("E_BAD_ARG", what + " list is empty");
    return numbers;
}
