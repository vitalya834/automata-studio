#pragma once

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

ParseResult parse_machine(const std::string& source);
std::vector<Diagnostic> validate_machine(const Machine& machine);
std::string to_json(const Machine& machine);

}  // namespace fsm
