#include "fsm.hpp"

#include <cassert>
#include <iostream>

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

    const auto invalid = fsm::parse_machine(
        "machine NFA\n"
        "initial A\n"
        "A --x--> B\n"
        "A --x--> C\n");
    assert(invalid.machine.has_value());
    assert(!invalid.diagnostics.empty());

    const auto unreachable = fsm::parse_machine(
        "machine Reachability\n"
        "initial A\n"
        "state Lost\n"
        "A --x--> A\n");
    assert(unreachable.diagnostics.size() == 1);
    assert(unreachable.diagnostics.front().severity == fsm::Severity::warning);

    std::cout << "C++ FSM tests passed\n";
}
