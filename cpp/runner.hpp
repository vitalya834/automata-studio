#pragma once

#include "fsm.hpp"

#include <chrono>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace fsm::runner {

using Milliseconds = std::chrono::milliseconds;

enum class Verdict { pass, fail, timeout, inconclusive, invalid };
enum class AdapterStatus { ok, timeout, error };
using Metadata = std::map<std::string, std::string>;

struct TestStep {
    std::string input;
    // Must be non-empty. nullopt represents no output (JSON null).
    std::vector<std::optional<std::string>> allowed_expected_outputs;
    Milliseconds timeout{1000};
    Metadata metadata;
};

struct TestCase {
    std::string id;
    std::string name;
    Metadata metadata;
    std::vector<TestStep> steps;
};

struct TestPlan {
    std::string schema_version{"1.0"};
    std::string id;
    std::string name;
    std::string model_id;
    Metadata metadata;
    std::vector<TestCase> cases;
};

struct AdapterResult {
    AdapterStatus status{AdapterStatus::ok};
    std::optional<std::string> output;
    std::string message;

    static AdapterResult success(std::optional<std::string> output = std::nullopt);
    static AdapterResult timed_out(std::string message = {});
    static AdapterResult failure(std::string message);
};

class SutAdapter {
public:
    virtual ~SutAdapter() = default;
    virtual AdapterResult reset(Milliseconds timeout) = 0;
    virtual AdapterResult send(const std::string& input, Milliseconds timeout) = 0;
    virtual void close() noexcept = 0;
};

class InMemoryMachineAdapter final : public SutAdapter {
public:
    explicit InMemoryMachineAdapter(const Machine& machine);
    AdapterResult reset(Milliseconds timeout) override;
    AdapterResult send(const std::string& input, Milliseconds timeout) override;
    void close() noexcept override;

    const std::string& current_state() const noexcept;

private:
    const Machine& machine_;
    std::string current_state_;
    bool closed_{false};
};

struct StepTrace {
    std::size_t index{0};
    std::string input;
    std::vector<std::optional<std::string>> allowed_expected_outputs;
    std::optional<std::string> actual_output;
    Verdict verdict{Verdict::invalid};
    Milliseconds elapsed{0};
    std::string message;
};

struct TestCaseReport {
    std::string id;
    std::string name;
    Verdict verdict{Verdict::invalid};
    Milliseconds elapsed{0};
    std::string message;
    std::vector<StepTrace> trace;
};

struct VerdictCounts {
    std::size_t passed{0};
    std::size_t failed{0};
    std::size_t timed_out{0};
    std::size_t inconclusive{0};
    std::size_t invalid{0};
};

struct TestPlanReport {
    std::string plan_id;
    std::string plan_name;
    Verdict verdict{Verdict::pass};
    Milliseconds elapsed{0};
    VerdictCounts counts;
    std::vector<TestCaseReport> cases;
};

TestPlan transition_cover_to_test_plan(
    const Machine& machine,
    const TransitionCoverResult& cover,
    Milliseconds step_timeout = Milliseconds{1000});

TestPlanReport run_test_plan(const TestPlan& plan, SutAdapter& adapter,
                             Milliseconds reset_timeout = Milliseconds{1000});
// C++ v1 is synchronous and has no cancellation token. Adapters should return
// AdapterStatus::timeout for deadline expiry; cancellation remains a TS-only feature.

std::string to_json(const TestPlan& plan);
std::string to_json(const TestPlanReport& report);
std::string to_string(Verdict verdict);

}  // namespace fsm::runner
