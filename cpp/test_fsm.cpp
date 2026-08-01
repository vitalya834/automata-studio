#include "fsm.hpp"

#include <cassert>
#include <iostream>
#include <stdexcept>

namespace {

bool throws_cover(const fsm::Machine& machine) {
    const auto result = fsm::transition_cover(machine);
    return !result.diagnostics.empty() && result.diagnostics.front().severity == fsm::Severity::error;
}

}  // namespace

int main() {
    const auto valid = fsm::parse_machine(
        "machine Turnstile\n"
        "initial Locked\n"
        "Locked --coin / unlock--> Unlocked\n"
        "Unlocked --push / lock--> Locked\n");
    assert(valid.machine.has_value());
    assert(valid.machine->states.size() == 2);
    assert(valid.machine->transitions.size() == 2);
    assert(valid.diagnostics.empty());

    const auto analysis = fsm::analyze_machine(*valid.machine);
    assert(analysis.inputs == std::vector<std::string>({"coin", "push"}));
    assert(analysis.outputs == std::vector<std::string>({"unlock", "lock"}));
    assert(analysis.deterministic);
    assert(!analysis.complete);
    assert(analysis.reachable_states.size() == 2);
    assert(analysis.unreachable_states.empty());
    assert(analysis.transition_count == 2);

    const auto nondeterministic = fsm::parse_machine(
        "machine NFA\ninitial A\nA --x--> B\nA --x--> C\n");
    assert(nondeterministic.machine.has_value());
    assert(!fsm::analyze_machine(*nondeterministic.machine).deterministic);
    assert(throws_cover(*nondeterministic.machine));

    const auto unreachable = fsm::parse_machine(
        "machine Reachability\ninitial A\nstate Lost\nA --x--> A\n");
    assert(unreachable.diagnostics.size() == 1);
    assert(unreachable.diagnostics.front().severity == fsm::Severity::warning);
    assert(fsm::analyze_machine(*unreachable.machine).unreachable_states == std::vector<std::string>({"Lost"}));

    const auto legacy = fsm::parse_machine(
        "F 1\ns 4\ni 2\no 2\nn0 0\np 9\n"
        "0 0 1 1\n0 1 2 1\n1 0 0 0\n1 1 3 1\n2 0 2 1\n"
        "2 1 0 0\n3 0 2 1\n3 1 3 1\n3 1 2 1\n");
    assert(legacy.machine.has_value());
    assert(legacy.machine->name == "LegacyFSM");
    assert(legacy.machine->states.size() == 4);
    assert(legacy.machine->transitions.size() == 9);
    const auto legacy_analysis = fsm::analyze_machine(*legacy.machine);
    assert(legacy_analysis.inputs == std::vector<std::string>({"0", "1"}));
    assert(legacy_analysis.outputs == std::vector<std::string>({"0", "1"}));
    assert(!legacy_analysis.deterministic);
    assert(legacy_analysis.complete);

    const auto broken_legacy = fsm::parse_machine("F 1\ns 2\ni 1\no 1\nn0 0\np 2\n0 0 1 0\n");
    assert(!broken_legacy.diagnostics.empty());

    fsm::GeneratorOptions options;
    options.name = "Seeded";
    options.state_count = 8;
    options.input_count = 3;
    options.output_count = 2;
    options.seed = 834;
    const auto generated_a = fsm::generate_machine(options);
    const auto generated_b = fsm::generate_machine(options);
    assert(fsm::to_json(generated_a) == fsm::to_json(generated_b));
    options.seed = 835;
    assert(fsm::to_json(generated_a) != fsm::to_json(fsm::generate_machine(options)));
    const auto generated_analysis = fsm::analyze_machine(generated_a);
    assert(generated_analysis.deterministic);
    assert(generated_analysis.complete);
    assert(generated_analysis.reachable_states.size() == options.state_count);

    options.seed = 42;
    options.deterministic = false;
    options.complete = false;
    const auto generated_nd = fsm::generate_machine(options);
    const auto generated_nd_analysis = fsm::analyze_machine(generated_nd);
    assert(!generated_nd_analysis.deterministic);
    assert(!generated_nd_analysis.complete);
    assert(generated_nd_analysis.unreachable_states.empty());

    const auto cover_machine = fsm::parse_machine(
        "machine Cover\ninitial A\n"
        "A --x / ax--> B\nA --z / az--> A\nB --y / by--> C\nC --x / cx--> A\n");
    assert(cover_machine.machine.has_value());
    const auto cover = fsm::transition_cover(*cover_machine.machine);
    assert(cover.tests.size() == 4);
    assert(cover.diagnostics.empty());
    assert(cover.tests[2].input_trace == std::vector<std::string>({"x", "y"}));
    assert(cover.tests[2].output_trace == std::vector<std::optional<std::string>>({"ax", "by"}));
    assert(cover.tests[2].state_trace == std::vector<std::string>({"A", "B", "C"}));
    assert(cover.tests[2].target_transition.index == 2);

    std::cout << "C++ FSM tests passed\n";
}
