#include "runner.hpp"

#include <cassert>
#include <iostream>
#include <stdexcept>

namespace {

class TimeoutAdapter final : public fsm::runner::SutAdapter {
public:
    fsm::runner::AdapterResult reset(fsm::runner::Milliseconds) override {
        return fsm::runner::AdapterResult::success();
    }
    fsm::runner::AdapterResult send(const std::string&, fsm::runner::Milliseconds) override {
        return fsm::runner::AdapterResult::timed_out("simulated timeout");
    }
    void close() noexcept override { closed = true; }
    bool closed{false};
};

class ResetFailureAdapter final : public fsm::runner::SutAdapter {
public:
    fsm::runner::AdapterResult reset(fsm::runner::Milliseconds) override {
        return fsm::runner::AdapterResult::failure("reset unavailable");
    }
    fsm::runner::AdapterResult send(const std::string&, fsm::runner::Milliseconds) override {
        assert(false && "send must not run after reset failure");
        return {};
    }
    void close() noexcept override { closed = true; }
    bool closed{false};
};

fsm::Machine turnstile() {
    return *fsm::parse_machine(
        "machine Turnstile\ninitial Locked\n"
        "Locked --coin / unlock--> Unlocked\n"
        "Unlocked --push / lock--> Locked\n").machine;
}

}  // namespace

int main() {
    using namespace fsm::runner;
    const auto machine = turnstile();
    const auto cover = fsm::transition_cover(machine);
    const auto plan = transition_cover_to_test_plan(machine, cover, Milliseconds{50});
    assert(plan.schema_version == "1.0");
    assert(plan.model_id == "Turnstile");
    assert(plan.cases.size() == 2);
    assert(plan.cases[1].steps.size() == 2);
    assert(plan.cases[0].steps[0].allowed_expected_outputs ==
           std::vector<std::optional<std::string>>({"unlock"}));

    InMemoryMachineAdapter passing_adapter(machine);
    const auto passing = run_test_plan(plan, passing_adapter);
    assert(passing.verdict == Verdict::pass);
    assert(passing.counts.passed == 2);
    assert(passing.cases[1].trace[1].actual_output == "lock");
    const auto plan_json = to_json(plan);
    assert(plan_json.find("\"schemaVersion\":\"1.0\"") != std::string::npos);
    assert(plan_json.find("\"modelId\":\"Turnstile\"") != std::string::npos);
    assert(plan_json.find("\"cases\":[") != std::string::npos);
    assert(plan_json.find("allowedExpectedOutputs") != std::string::npos);
    assert(plan_json.find("\"metadata\":{") != std::string::npos);
    assert(to_json(passing).find("\"verdict\":\"pass\"") != std::string::npos);

    TestPlan mismatch_plan{"1.0", "mismatch", "Mismatch", "Turnstile", {},
        {{"case", "Mismatch", {}, {
            {"coin", {std::optional<std::string>{"wrong"}}, Milliseconds{50}, {}}
        }}}};
    InMemoryMachineAdapter mismatch_adapter(machine);
    const auto mismatch = run_test_plan(mismatch_plan, mismatch_adapter);
    assert(mismatch.verdict == Verdict::fail);
    assert(mismatch.counts.failed == 1);
    assert(mismatch.cases[0].trace[0].actual_output == "unlock");

    TimeoutAdapter timeout_adapter;
    const auto timeout = run_test_plan(mismatch_plan, timeout_adapter);
    assert(timeout.verdict == Verdict::timeout);
    assert(timeout.counts.timed_out == 1);
    assert(timeout_adapter.closed);

    ResetFailureAdapter reset_adapter;
    const auto reset_failure = run_test_plan(mismatch_plan, reset_adapter);
    assert(reset_failure.verdict == Verdict::invalid);
    assert(reset_failure.cases[0].trace.empty());
    assert(reset_failure.cases[0].message == "reset unavailable");
    assert(reset_adapter.closed);

    TestPlan invalid_plan{"1.0", "invalid", "Invalid", "Turnstile", {},
        {{"case", "Invalid", {}, {{"coin", {}, Milliseconds{50}, {}}}}}};
    InMemoryMachineAdapter invalid_plan_adapter(machine);
    const auto invalid_report = run_test_plan(invalid_plan, invalid_plan_adapter);
    assert(invalid_report.verdict == Verdict::invalid);
    assert(invalid_report.counts.invalid == 1);
    assert(invalid_report.cases[0].message.find("allowed expected outputs") != std::string::npos);

    const auto nondeterministic = *fsm::parse_machine(
        "machine ND\ninitial A\nA --x / one--> B\nA --x / two--> C\n").machine;
    bool rejected = false;
    try {
        InMemoryMachineAdapter invalid(nondeterministic);
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    assert(rejected);

    std::cout << "C++ runner tests passed\n";
}
