// json.h - a very small JSON writer.
//
// The engine only ever WRITES JSON (responses, events and snapshots go to
// stdout as one JSON object per line). Commands arrive as plain text lines,
// so no JSON parser is needed in C++.
#pragma once

#include <string>
#include <vector>

std::string jsonEscape(const std::string& text);

class JsonWriter {
public:
    JsonWriter& beginObject();
    JsonWriter& endObject();
    JsonWriter& beginArray();
    JsonWriter& endArray();
    JsonWriter& key(const std::string& name);

    JsonWriter& value(const std::string& text);
    JsonWriter& value(const char* text);
    JsonWriter& value(int number);
    JsonWriter& value(long number);
    JsonWriter& value(double number);
    JsonWriter& value(bool flag);
    JsonWriter& null();
    JsonWriter& raw(const std::string& alreadyJson);  // insert pre-built JSON

    // Shorthand for key(name).value(v)
    template <typename T>
    JsonWriter& field(const std::string& name, const T& v) { key(name); return value(v); }

    JsonWriter& intArray(const std::vector<int>& numbers);

    const std::string& str() const { return text; }

private:
    void beforeValue();
    std::string text;
    std::vector<int> itemCounts;  // number of items written at each nesting level
    bool afterKey = false;
};
