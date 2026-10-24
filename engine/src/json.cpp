// json.cpp - JsonWriter implementation.
#include "json.h"

#include <cstdio>

std::string jsonEscape(const std::string& text) {
    std::string out;
    for (unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char)c;
                }
        }
    }
    return out;
}

// Writes the comma that separates items, unless a key was just written.
void JsonWriter::beforeValue() {
    if (afterKey) {
        afterKey = false;
        return;
    }
    if (!itemCounts.empty()) {
        if (itemCounts.back() > 0) text += ',';
        itemCounts.back()++;
    }
}

JsonWriter& JsonWriter::beginObject() { beforeValue(); text += '{'; itemCounts.push_back(0); return *this; }
JsonWriter& JsonWriter::endObject() { text += '}'; itemCounts.pop_back(); return *this; }
JsonWriter& JsonWriter::beginArray() { beforeValue(); text += '['; itemCounts.push_back(0); return *this; }
JsonWriter& JsonWriter::endArray() { text += ']'; itemCounts.pop_back(); return *this; }

JsonWriter& JsonWriter::key(const std::string& name) {
    beforeValue();
    text += '"' + jsonEscape(name) + "\":";
    afterKey = true;
    return *this;
}

JsonWriter& JsonWriter::value(const std::string& s) { beforeValue(); text += '"' + jsonEscape(s) + '"'; return *this; }
JsonWriter& JsonWriter::value(const char* s) { return value(std::string(s)); }
JsonWriter& JsonWriter::value(int n) { beforeValue(); text += std::to_string(n); return *this; }
JsonWriter& JsonWriter::value(long n) { beforeValue(); text += std::to_string(n); return *this; }
JsonWriter& JsonWriter::value(bool b) { beforeValue(); text += b ? "true" : "false"; return *this; }
JsonWriter& JsonWriter::null() { beforeValue(); text += "null"; return *this; }
JsonWriter& JsonWriter::raw(const std::string& j) { beforeValue(); text += j; return *this; }

JsonWriter& JsonWriter::value(double d) {
    beforeValue();
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.2f", d);  // two decimals are enough for averages
    text += buf;
    return *this;
}

JsonWriter& JsonWriter::intArray(const std::vector<int>& numbers) {
    beginArray();
    for (int n : numbers) value(n);
    return endArray();
}
