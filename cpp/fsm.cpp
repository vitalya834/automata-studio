#include "fsm.hpp"

#include <algorithm>
#include <cctype>
#include <deque>
#include <map>
#include <random>
#include <regex>
#include <sstream>
#include <stdexcept>
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

void unique_in_order(std::vector<std::string>& values) {
    std::unordered_set<std::string> seen;
    values.erase(std::remove_if(values.begin(), values.end(), [&](const std::string& value) {
        return !seen.insert(value).second;
    }), values.end());
}

bool looks_legacy_numeric(const std::string& source) {
    std::istringstream stream(source);
    std::string line;
    while (std::getline(stream, line)) {
        line = trim(line);
        if (line.empty() || line.starts_with('#') || line.starts_with("//")) continue;
        return std::regex_match(line, std::regex(R"(^F\s+\d+\s*$)", std::regex::icase));
    }
    return false;
}

void append_string_array(std::ostringstream& json, const std::vector<std::string>& values) {
    json << '[';
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i) json << ',';
        json << '"' << json_escape(values[i]) << '"';
    }
    json << ']';
}

}  // namespace

ParseResult parse_machine(const std::string& source) {
    if (looks_legacy_numeric(source)) return parse_legacy_numeric_machine(source);

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

ParseResult parse_legacy_numeric_machine(const std::string& source) {
    ParseResult result;
    struct NumberedLine { int number; std::string text; };
    std::vector<NumberedLine> lines;
    std::istringstream stream(source);
    std::string raw;
    int number = 0;
    while (std::getline(stream, raw)) {
        ++number;
        const auto line = trim(raw);
        if (!line.empty() && !line.starts_with('#') && !line.starts_with("//")) lines.push_back({number, line});
    }

    const std::vector<std::string> keys{"F", "s", "i", "o", "n0", "p"};
    std::vector<long long> values;
    for (std::size_t index = 0; index < keys.size(); ++index) {
        if (index >= lines.size()) {
            result.diagnostics.push_back({Severity::error, number + 1, "Missing legacy header: " + keys[index]});
            return result;
        }
        std::istringstream line(lines[index].text);
        std::string key;
        long long value = -1;
        std::string extra;
        if (!(line >> key >> value) || (line >> extra) || key != keys[index]) {
            result.diagnostics.push_back({Severity::error, lines[index].number, "Expected legacy header: " + keys[index] + " <integer>."});
            return result;
        }
        values.push_back(value);
    }

    if (values[0] != 1) result.diagnostics.push_back({Severity::error, lines[0].number, "Only legacy format F 1 is supported."});
    if (values[1] <= 0) result.diagnostics.push_back({Severity::error, lines[1].number, "State count must be positive."});
    if (values[2] <= 0) result.diagnostics.push_back({Severity::error, lines[2].number, "Input count must be positive."});
    if (values[3] <= 0) result.diagnostics.push_back({Severity::error, lines[3].number, "Output count must be positive."});
    if (values[5] < 0) result.diagnostics.push_back({Severity::error, lines[5].number, "Transition count cannot be negative."});
    if (values[1] > 0 && (values[4] < 0 || values[4] >= values[1])) {
        result.diagnostics.push_back({Severity::error, lines[4].number, "Initial state is outside the declared state range."});
    }
    if (!result.diagnostics.empty()) return result;

    Machine machine;
    machine.name = "LegacyFSM";
    machine.initial_state = std::to_string(values[4]);
    for (long long state = 0; state < values[1]; ++state) machine.states.push_back({std::to_string(state), false, lines[1].number});
    for (long long input = 0; input < values[2]; ++input) machine.input_alphabet.push_back(std::to_string(input));
    for (long long output = 0; output < values[3]; ++output) machine.output_alphabet.push_back(std::to_string(output));

    const auto declared_transitions = static_cast<std::size_t>(values[5]);
    for (std::size_t index = 6; index < lines.size(); ++index) {
        std::istringstream line(lines[index].text);
        long long from = -1, input = -1, to = -1, output = -1;
        std::string extra;
        if (!(line >> from >> input >> to >> output) || (line >> extra)) {
            result.diagnostics.push_back({Severity::error, lines[index].number, "Expected transition: <source> <input> <target> <output>."});
            continue;
        }
        if (from < 0 || from >= values[1] || to < 0 || to >= values[1] || input < 0 || input >= values[2] || output < 0 || output >= values[3]) {
            result.diagnostics.push_back({Severity::error, lines[index].number, "Transition value is outside a declared range."});
            continue;
        }
        machine.transitions.push_back({std::to_string(from), std::to_string(to), std::to_string(input), std::to_string(output), lines[index].number});
    }
    if (lines.size() < 6 || lines.size() - 6 != declared_transitions) {
        result.diagnostics.push_back({Severity::error, lines[5].number, "Declared transition count does not match the file."});
    }

    auto validation = validate_machine(machine);
    result.diagnostics.insert(result.diagnostics.end(), validation.begin(), validation.end());
    result.machine = std::move(machine);
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

    const auto analysis = analyze_machine(machine);
    for (const auto& state : analysis.unreachable_states) {
        const auto found = std::find_if(machine.states.begin(), machine.states.end(), [&](const State& item) { return item.id == state; });
        diagnostics.push_back({Severity::warning, found == machine.states.end() ? 0 : found->source_line, "Unreachable state: " + state});
    }
    return diagnostics;
}

MachineAnalysis analyze_machine(const Machine& machine) {
    MachineAnalysis analysis;
    analysis.transition_count = machine.transitions.size();
    analysis.inputs = machine.input_alphabet;
    analysis.outputs = machine.output_alphabet;
    std::map<std::pair<std::string, std::string>, std::size_t> pair_counts;
    for (const auto& transition : machine.transitions) {
        analysis.inputs.push_back(transition.input);
        if (transition.output) analysis.outputs.push_back(*transition.output);
        ++pair_counts[{transition.from, transition.input}];
    }
    unique_in_order(analysis.inputs);
    unique_in_order(analysis.outputs);
    analysis.deterministic = std::all_of(pair_counts.begin(), pair_counts.end(), [](const auto& item) { return item.second <= 1; });
    for (const auto& state : machine.states) {
        for (const auto& input : analysis.inputs) {
            if (!pair_counts.contains({state.id, input})) analysis.complete = false;
        }
    }

    std::unordered_set<std::string> reachable;
    if (!machine.initial_state.empty()) reachable.insert(machine.initial_state);
    std::deque<std::string> queue;
    if (!machine.initial_state.empty()) queue.push_back(machine.initial_state);
    while (!queue.empty()) {
        const auto from = queue.front();
        queue.pop_front();
        for (const auto& transition : machine.transitions) {
            if (transition.from == from && reachable.insert(transition.to).second) queue.push_back(transition.to);
        }
    }
    for (const auto& state : machine.states) {
        (reachable.contains(state.id) ? analysis.reachable_states : analysis.unreachable_states).push_back(state.id);
    }
    return analysis;
}

Machine generate_machine(const GeneratorOptions& options) {
    if (options.name.empty()) throw std::invalid_argument("name must not be empty");
    if (options.state_count > 1 && options.input_count == 0) throw std::invalid_argument("input_count must be positive to make multiple states reachable");
    if (!options.deterministic && options.state_count * options.input_count == 0) throw std::invalid_argument("a nondeterministic machine requires a state and an input");
    if (!options.deterministic && options.state_count < 2 && options.output_count < 2) throw std::invalid_argument("nondeterminism requires two target states or outputs");
    if (!options.complete && options.state_count * options.input_count == 0) throw std::invalid_argument("an incomplete machine requires a state and an input");
    if (!options.deterministic && !options.complete && options.state_count * options.input_count < 2) throw std::invalid_argument("nondeterministic and incomplete constraints require two state/input pairs");

    // FNV-1a + mulberry32 mirrors the browser generator for numeric seeds.
    std::uint32_t random_state = 2166136261u;
    for (const unsigned char character : std::to_string(options.seed)) {
        random_state ^= character;
        random_state *= 16777619u;
    }
    auto random = [&]() mutable {
        random_state += 0x6d2b79f5u;
        std::uint32_t value = random_state;
        value = (value ^ (value >> 15u)) * (value | 1u);
        value ^= value + ((value ^ (value >> 7u)) * (value | 61u));
        return static_cast<double>(value ^ (value >> 14u)) / 4294967296.0;
    };
    const auto pick = [&](std::size_t count) { return static_cast<std::size_t>(random() * static_cast<double>(count)); };

    Machine machine;
    machine.name = options.name;
    machine.initial_state = options.state_count ? "q0" : "";
    for (std::size_t state = 0; state < options.state_count; ++state) {
        machine.states.push_back({"q" + std::to_string(state), random() < 0.3, static_cast<int>(state + 1)});
    }
    for (std::size_t input = 0; input < options.input_count; ++input) machine.input_alphabet.push_back("i" + std::to_string(input));
    for (std::size_t output = 0; output < options.output_count; ++output) machine.output_alphabet.push_back("o" + std::to_string(output));

    std::vector<std::pair<std::size_t, std::size_t>> pairs;
    std::map<std::pair<std::size_t, std::size_t>, std::size_t> counts;
    for (std::size_t state = 0; state < options.state_count; ++state) {
        for (std::size_t input = 0; input < options.input_count; ++input) pairs.push_back({state, input});
    }
    const auto random_output = [&]() -> std::optional<std::string> {
        if (options.output_count == 0) return std::nullopt;
        return "o" + std::to_string(pick(options.output_count));
    };
    const auto add = [&](std::size_t from, std::size_t input, std::size_t to, std::optional<std::string> output = std::nullopt) {
        if (!output && options.output_count) output = random_output();
        machine.transitions.push_back({"q" + std::to_string(from), "q" + std::to_string(to), "i" + std::to_string(input), output, static_cast<int>(machine.transitions.size() + 1)});
        ++counts[{from, input}];
    };

    for (std::size_t state = 1; state < options.state_count; ++state) {
        const auto input = pick(options.input_count);
        add(state - 1, input, state);
    }

    if (options.complete) {
        for (const auto& pair : pairs) {
            if (!counts.contains(pair)) {
                const auto target = pick(options.state_count);
                add(pair.first, pair.second, target);
            }
        }
    } else {
        std::vector<std::pair<std::size_t, std::size_t>> missing;
        for (const auto& pair : pairs) if (!counts.contains(pair)) missing.push_back(pair);
        const auto reserved = missing[pick(missing.size())];
        for (const auto& pair : pairs) {
            if (counts.contains(pair) || pair == reserved) continue;
            if (random() < 0.45) {
                const auto target = pick(options.state_count);
                add(pair.first, pair.second, target);
            }
        }
    }

    if (!options.deterministic) {
        std::vector<std::pair<std::size_t, std::size_t>> occupied;
        for (const auto& pair : pairs) if (counts.contains(pair)) occupied.push_back(pair);
        std::pair<std::size_t, std::size_t> pair;
        if (occupied.empty()) {
            pair = pairs.front();
            add(pair.first, pair.second, 0);
        } else pair = occupied[pick(occupied.size())];
        const auto original = *std::find_if(machine.transitions.begin(), machine.transitions.end(), [&](const Transition& transition) {
            return transition.from == "q" + std::to_string(pair.first) && transition.input == "i" + std::to_string(pair.second);
        });
        if (options.state_count > 1) {
            std::vector<std::size_t> alternatives;
            for (std::size_t state = 0; state < options.state_count; ++state) if ("q" + std::to_string(state) != original.to) alternatives.push_back(state);
            add(pair.first, pair.second, alternatives[pick(alternatives.size())], original.output);
        } else {
            std::vector<std::string> alternatives;
            for (const auto& output : machine.output_alphabet) if (!original.output || output != *original.output) alternatives.push_back(output);
            add(pair.first, pair.second, 0, alternatives[pick(alternatives.size())]);
        }
    }
    return machine;
}

TransitionCoverResult transition_cover(const Machine& machine) {
    TransitionCoverResult result;
    const auto analysis = analyze_machine(machine);
    if (!analysis.deterministic) {
        result.diagnostics.push_back({Severity::error, 1, "Transition cover requires a deterministic FSM."});
        return result;
    }

    std::unordered_map<std::string, std::vector<std::size_t>> paths;
    std::deque<std::string> queue;
    paths[machine.initial_state] = {};
    queue.push_back(machine.initial_state);
    while (!queue.empty()) {
        const auto state = queue.front();
        queue.pop_front();
        for (const auto& transition : machine.transitions) {
            if (transition.from != state || paths.contains(transition.to)) continue;
            auto path = paths.at(state);
            path.push_back(static_cast<std::size_t>(&transition - machine.transitions.data()));
            paths.emplace(transition.to, std::move(path));
            queue.push_back(transition.to);
        }
    }

    for (std::size_t index = 0; index < machine.transitions.size(); ++index) {
        const auto& transition = machine.transitions[index];
        const auto found = paths.find(transition.from);
        if (found == paths.end()) {
            result.diagnostics.push_back({Severity::warning, transition.source_line, "Transition " + std::to_string(index) + " is unreachable from the initial state."});
            continue;
        }
        auto indices = found->second;
        indices.push_back(index);
        TransitionCoverCase test;
        test.target_transition = {index, transition.source_line};
        test.state_trace.push_back(machine.initial_state);
        for (const auto covered : indices) {
            const auto& edge = machine.transitions[covered];
            test.input_trace.push_back(edge.input);
            test.output_trace.push_back(edge.output);
            test.state_trace.push_back(edge.to);
            test.covered_transitions.push_back({covered, edge.source_line});
        }
        result.tests.push_back(std::move(test));
    }
    return result;
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
    json << ']';
    if (!machine.input_alphabet.empty() || !machine.output_alphabet.empty()) {
        json << ",\"inputs\":";
        append_string_array(json, machine.input_alphabet);
        json << ",\"outputs\":";
        append_string_array(json, machine.output_alphabet);
    }
    json << '}';
    return json.str();
}

std::string to_json(const MachineAnalysis& analysis) {
    std::ostringstream json;
    json << "{\"inputs\":"; append_string_array(json, analysis.inputs);
    json << ",\"outputs\":"; append_string_array(json, analysis.outputs);
    json << ",\"deterministic\":" << (analysis.deterministic ? "true" : "false")
         << ",\"complete\":" << (analysis.complete ? "true" : "false") << ",\"reachableStates\":";
    append_string_array(json, analysis.reachable_states);
    json << ",\"unreachableStates\":"; append_string_array(json, analysis.unreachable_states);
    json << ",\"transitionCount\":" << analysis.transition_count << '}';
    return json.str();
}

std::string to_json(const TransitionCoverResult& cover) {
    std::ostringstream json;
    json << "{\"tests\":[";
    for (std::size_t index = 0; index < cover.tests.size(); ++index) {
        if (index) json << ',';
        const auto& test = cover.tests[index];
        json << "{\"targetTransition\":{\"index\":" << test.target_transition.index
             << ",\"sourceLine\":" << test.target_transition.source_line << "},\"inputTrace\":";
        append_string_array(json, test.input_trace);
        json << ",\"outputTrace\":[";
        for (std::size_t output = 0; output < test.output_trace.size(); ++output) {
            if (output) json << ',';
            if (test.output_trace[output]) json << '"' << json_escape(*test.output_trace[output]) << '"';
            else json << "null";
        }
        json << "],\"stateTrace\":";
        append_string_array(json, test.state_trace);
        json << ",\"coveredTransitions\":[";
        for (std::size_t covered = 0; covered < test.covered_transitions.size(); ++covered) {
            if (covered) json << ',';
            json << "{\"index\":" << test.covered_transitions[covered].index
                 << ",\"sourceLine\":" << test.covered_transitions[covered].source_line << '}';
        }
        json << "]}";
    }
    json << "],\"diagnostics\":[";
    for (std::size_t index = 0; index < cover.diagnostics.size(); ++index) {
        if (index) json << ',';
        const auto& diagnostic = cover.diagnostics[index];
        json << "{\"severity\":\"" << (diagnostic.severity == Severity::error ? "error" : "warning")
             << "\",\"line\":" << diagnostic.line << ",\"message\":\"" << json_escape(diagnostic.message) << "\"}";
    }
    json << "]}";
    return json.str();
}

}  // namespace fsm
