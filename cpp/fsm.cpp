#include "fsm.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

namespace fsm {
namespace {

std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::string json_escape(const std::string& value) {
    std::string result;
    for (const char character : value) {
        switch (character) {
            case '\\': result += "\\\\"; break;
            case '"': result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += character;
        }
    }
    return result;
}

}  // namespace

ParseResult parse_machine(const std::string& source) {
    ParseResult result;
    Machine machine;
    std::unordered_map<std::string, std::size_t> state_indexes;

    const auto add_state = [&](const std::string& id, int line, bool is_final = false) {
        const auto found = state_indexes.find(id);
        if (found != state_indexes.end()) {
            machine.states[found->second].is_final |= is_final;
            return;
        }
        state_indexes[id] = machine.states.size();
        machine.states.push_back({id, is_final, line});
    };

    const std::regex declaration(R"(^(machine|state|initial|final)\s+([^\s]+)\s*$)", std::regex::icase);
    const std::regex transition(R"(^([^\s]+)\s*--\s*([^/]+?)(?:\s*/\s*(.+?))?\s*-->\s*([^\s]+)\s*$)");
    std::istringstream stream(source);
    std::string raw_line;
    int line_number = 0;

    while (std::getline(stream, raw_line)) {
        ++line_number;
        const std::string line = trim(raw_line);
        if (line.empty() || line.starts_with('#') || line.starts_with("//")) continue;

        std::smatch match;
        if (std::regex_match(line, match, declaration)) {
            std::string keyword = match[1].str();
            std::transform(keyword.begin(), keyword.end(), keyword.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            const std::string value = match[2].str();
            if (keyword == "machine") machine.name = value;
            if (keyword == "state") add_state(value, line_number);
            if (keyword == "initial") {
                machine.initial_state = value;
                add_state(value, line_number);
            }
            if (keyword == "final") add_state(value, line_number, true);
            continue;
        }

        if (std::regex_match(line, match, transition)) {
            const std::string from = match[1].str();
            const std::string input = trim(match[2].str());
            const std::string output = trim(match[3].str());
            const std::string to = match[4].str();
            add_state(from, line_number);
            add_state(to, line_number);
            machine.transitions.push_back({from, to, input, output.empty() ? std::nullopt : std::optional(output), line_number});
            continue;
        }

        result.diagnostics.push_back({Severity::error, line_number, "Unrecognized line. Expected declaration or A --input--> B."});
    }

    if (machine.name.empty()) result.diagnostics.push_back({Severity::error, 1, "Add machine name: machine Name."});
    if (machine.initial_state.empty()) result.diagnostics.push_back({Severity::error, 1, "Add initial state: initial State."});
    if (!machine.name.empty() && !machine.initial_state.empty()) {
        auto validation = validate_machine(machine);
        result.diagnostics.insert(result.diagnostics.end(), validation.begin(), validation.end());
        result.machine = std::move(machine);
    }
    return result;
}

std::vector<Diagnostic> validate_machine(const Machine& machine) {
    std::vector<Diagnostic> diagnostics;
    std::unordered_map<std::string, const Transition*> seen;
    for (const auto& transition : machine.transitions) {
        const std::string key = transition.from + '\0' + transition.input;
        const auto found = seen.find(key);
        if (found != seen.end()) {
            const bool duplicate = found->second->to == transition.to && found->second->output == transition.output;
            diagnostics.push_back({duplicate ? Severity::warning : Severity::error, transition.source_line,
                duplicate ? "Duplicate transition." : "Nondeterministic transition for the same state and input."});
        } else {
            seen[key] = &transition;
        }
    }

    std::unordered_set<std::string> reachable{machine.initial_state};
    bool changed = true;
    while (changed) {
        changed = false;
        for (const auto& transition : machine.transitions) {
            if (reachable.contains(transition.from) && !reachable.contains(transition.to)) {
                reachable.insert(transition.to);
                changed = true;
            }
        }
    }
    for (const auto& state : machine.states) {
        if (!reachable.contains(state.id)) diagnostics.push_back({Severity::warning, state.source_line, "Unreachable state: " + state.id});
    }
    return diagnostics;
}

std::string to_json(const Machine& machine) {
    std::ostringstream json;
    json << "{\"name\":\"" << json_escape(machine.name) << "\",\"initialState\":\"" << json_escape(machine.initial_state) << "\",\"states\":[";
    for (std::size_t i = 0; i < machine.states.size(); ++i) {
        if (i) json << ',';
        const auto& state = machine.states[i];
        json << "{\"id\":\"" << json_escape(state.id) << "\",\"final\":" << (state.is_final ? "true" : "false") << ",\"sourceLine\":" << state.source_line << '}';
    }
    json << "],\"transitions\":[";
    for (std::size_t i = 0; i < machine.transitions.size(); ++i) {
        if (i) json << ',';
        const auto& transition = machine.transitions[i];
        json << "{\"from\":\"" << json_escape(transition.from) << "\",\"to\":\"" << json_escape(transition.to) << "\",\"input\":\"" << json_escape(transition.input) << '"';
        if (transition.output) json << ",\"output\":\"" << json_escape(*transition.output) << '"';
        json << ",\"sourceLine\":" << transition.source_line << '}';
    }
    json << "]}";
    return json.str();
}

}  // namespace fsm
