#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace fsm {

enum class Severity { error, warning };

struct State {
    std::string id;
    bool is_final{false};
    int source_line{0};
};

struct Transition {
    std::string from;
    std::string to;
    std::string input;
    std::optional<std::string> output;
    int source_line{0};
};

struct Machine {
    std::string name;
    std::string initial_state;
    std::vector<State> states;
    std::vector<Transition> transitions;
    // Optional declared alphabets (legacy files and generated machines). Text
    // machines infer them from transitions when these vectors are empty.
    std::vector<std::string> input_alphabet;
    std::vector<std::string> output_alphabet;
};

struct Diagnostic {
    Severity severity;
    int line;
    std::string message;
};

struct ParseResult {
    std::optional<Machine> machine;
    std::vector<Diagnostic> diagnostics;
};

struct MachineAnalysis {
    std::vector<std::string> inputs;
    std::vector<std::string> outputs;
    bool deterministic{true};
    bool complete{true};
    std::vector<std::string> reachable_states;
    std::vector<std::string> unreachable_states;
    std::size_t transition_count{0};
};

struct GeneratorOptions {
    std::string name{"GeneratedFSM"};
    std::size_t state_count{4};
    std::size_t input_count{2};
    std::size_t output_count{2};
    bool deterministic{true};
    bool complete{true};
    std::uint32_t seed{0};
};

struct CoveredTransition {
    std::size_t index{0};
    int source_line{0};
};

struct TransitionCoverCase {
    CoveredTransition target_transition;
    std::vector<std::string> input_trace;
    std::vector<std::optional<std::string>> output_trace;
    std::vector<std::string> state_trace;
    std::vector<CoveredTransition> covered_transitions;
};

struct TransitionCoverResult {
    std::vector<TransitionCoverCase> tests;
    std::vector<Diagnostic> diagnostics;
};

ParseResult parse_machine(const std::string& source);
ParseResult parse_legacy_numeric_machine(const std::string& source);
std::vector<Diagnostic> validate_machine(const Machine& machine);
MachineAnalysis analyze_machine(const Machine& machine);
Machine generate_machine(const GeneratorOptions& options);
TransitionCoverResult transition_cover(const Machine& machine);

std::string to_json(const Machine& machine);
std::string to_json(const MachineAnalysis& analysis);
std::string to_json(const TransitionCoverResult& cover);

}  // namespace fsm
