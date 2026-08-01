#include "runner.hpp"

#include <algorithm>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace fsm::runner {
namespace {

using Clock = std::chrono::steady_clock;

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

Milliseconds elapsed_since(const Clock::time_point start) {
    return std::chrono::duration_cast<Milliseconds>(Clock::now() - start);
}

bool accepts(const TestStep& step, const std::optional<std::string>& actual) {
    return std::find(step.allowed_expected_outputs.begin(),
                     step.allowed_expected_outputs.end(), actual) !=
           step.allowed_expected_outputs.end();
}

Verdict result_verdict(const AdapterResult& result, Milliseconds elapsed,
                       Milliseconds timeout) {
    if (result.status == AdapterStatus::timeout || elapsed > timeout) return Verdict::timeout;
    if (result.status == AdapterStatus::error) return Verdict::invalid;
    return Verdict::pass;
}

void count(VerdictCounts& counts, Verdict verdict) {
    switch (verdict) {
        case Verdict::pass: ++counts.passed; break;
        case Verdict::fail: ++counts.failed; break;
        case Verdict::timeout: ++counts.timed_out; break;
        case Verdict::inconclusive: ++counts.inconclusive; break;
        case Verdict::invalid: ++counts.invalid; break;
    }
}

Verdict combine(Verdict current, Verdict next) {
    const auto rank = [](Verdict value) {
        switch (value) {
            case Verdict::pass: return 0;
            case Verdict::inconclusive: return 1;
            case Verdict::fail: return 2;
            case Verdict::timeout: return 3;
            case Verdict::invalid: return 4;
        }
        return 4;
    };
    return rank(next) > rank(current) ? next : current;
}

void append_optional(std::ostringstream& json, const std::optional<std::string>& value) {
    if (value) json << '"' << json_escape(*value) << '"';
    else json << "null";
}

void append_expected(std::ostringstream& json,
                     const std::vector<std::optional<std::string>>& values) {
    json << '[';
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i) json << ',';
        append_optional(json, values[i]);
    }
    json << ']';
}

void append_metadata(std::ostringstream& json, const Metadata& metadata) {
    json << '{';
    std::size_t index = 0;
    for (const auto& [key, value] : metadata) {
        if (index++) json << ',';
        json << '"' << json_escape(key) << "\":\"" << json_escape(value) << '"';
    }
    json << '}';
}

std::optional<std::string> validate_plan(const TestPlan& plan) {
    if (plan.schema_version != "1.0") return "Only schemaVersion 1.0 is supported";
    if (plan.id.empty()) return "plan id must not be empty";
    if (plan.name.empty()) return "plan name must not be empty";
    if (plan.model_id.empty()) return "model id must not be empty";
    std::map<std::string, bool> ids;
    for (const auto& test : plan.cases) {
        if (test.id.empty()) return "case id must not be empty";
        if (!ids.emplace(test.id, true).second) return "case ids must be unique";
        if (test.name.empty()) return "case name must not be empty";
        if (test.steps.empty()) return "case steps must not be empty";
        for (const auto& step : test.steps) {
            if (step.input.empty()) return "step input must not be empty";
            if (step.allowed_expected_outputs.empty()) {
                return "allowed expected outputs must not be empty";
            }
            if (step.timeout.count() <= 0) return "step timeout must be positive";
        }
    }
    return std::nullopt;
}

}  // namespace

AdapterResult AdapterResult::success(std::optional<std::string> output) {
    return {AdapterStatus::ok, std::move(output), {}};
}

AdapterResult AdapterResult::timed_out(std::string message) {
    return {AdapterStatus::timeout, std::nullopt, std::move(message)};
}

AdapterResult AdapterResult::failure(std::string message) {
    return {AdapterStatus::error, std::nullopt, std::move(message)};
}

InMemoryMachineAdapter::InMemoryMachineAdapter(const Machine& machine) : machine_(machine) {
    if (!analyze_machine(machine).deterministic) {
        throw std::invalid_argument("InMemoryMachineAdapter requires a deterministic FSM");
    }
    if (machine.initial_state.empty() ||
        std::none_of(machine.states.begin(), machine.states.end(), [&](const State& state) {
            return state.id == machine.initial_state;
        })) {
        throw std::invalid_argument("InMemoryMachineAdapter requires an existing initial state");
    }
    current_state_ = machine.initial_state;
}

AdapterResult InMemoryMachineAdapter::reset(Milliseconds) {
    if (closed_) return AdapterResult::failure("adapter is closed");
    current_state_ = machine_.initial_state;
    return AdapterResult::success();
}

AdapterResult InMemoryMachineAdapter::send(const std::string& input, Milliseconds) {
    if (closed_) return AdapterResult::failure("adapter is closed");
    const auto transition = std::find_if(machine_.transitions.begin(), machine_.transitions.end(),
        [&](const Transition& edge) { return edge.from == current_state_ && edge.input == input; });
    if (transition == machine_.transitions.end()) {
        return AdapterResult::failure("no transition from state '" + current_state_ +
                                      "' for input '" + input + "'");
    }
    current_state_ = transition->to;
    return AdapterResult::success(transition->output);
}

void InMemoryMachineAdapter::close() noexcept { closed_ = true; }

const std::string& InMemoryMachineAdapter::current_state() const noexcept { return current_state_; }

TestPlan transition_cover_to_test_plan(const Machine& machine,
                                       const TransitionCoverResult& cover,
                                       Milliseconds step_timeout) {
    if (step_timeout.count() <= 0) throw std::invalid_argument("step timeout must be positive");
    if (std::any_of(cover.diagnostics.begin(), cover.diagnostics.end(),
                    [](const Diagnostic& item) { return item.severity == Severity::error; })) {
        throw std::invalid_argument("cannot convert a transition cover containing errors");
    }
    TestPlan plan;
    plan.id = machine.name + "-transition-cover";
    plan.name = machine.name + " transition cover";
    plan.model_id = machine.name;
    plan.metadata = {{"generator", "transition-cover"},
                     {"diagnosticCount", std::to_string(cover.diagnostics.size())}};
    for (std::size_t case_index = 0; case_index < cover.tests.size(); ++case_index) {
        const auto& source = cover.tests[case_index];
        if (source.input_trace.size() != source.output_trace.size()) {
            throw std::invalid_argument("transition cover input/output trace lengths differ");
        }
        if (source.input_trace.size() != source.covered_transitions.size()) {
            throw std::invalid_argument("transition cover step/transition lengths differ");
        }
        TestCase test;
        test.id = plan.id + "-tc-" + std::to_string(case_index + 1);
        test.name = "Cover transition " + std::to_string(source.target_transition.index);
        test.metadata = {{"targetTransition", std::to_string(source.target_transition.index)},
                         {"sourceLine", std::to_string(source.target_transition.source_line)}};
        for (std::size_t step = 0; step < source.input_trace.size(); ++step) {
            test.steps.push_back({
                source.input_trace[step], {source.output_trace[step]}, step_timeout,
                {{"transitionIndex", std::to_string(source.covered_transitions[step].index)}}});
        }
        plan.cases.push_back(std::move(test));
    }
    return plan;
}

TestPlanReport run_test_plan(const TestPlan& plan, SutAdapter& adapter,
                             Milliseconds reset_timeout) {
    if (reset_timeout.count() <= 0) throw std::invalid_argument("reset timeout must be positive");
    const auto plan_start = Clock::now();
    TestPlanReport report{plan.id, plan.name, Verdict::pass, Milliseconds{0}, {}, {}};

    if (const auto issue = validate_plan(plan)) {
        report.verdict = Verdict::invalid;
        report.counts.invalid = 1;
        report.cases.push_back({"", "Invalid test plan", Verdict::invalid,
                                Milliseconds{0}, *issue, {}});
        adapter.close();
        report.elapsed = elapsed_since(plan_start);
        return report;
    }

    try {
        for (const auto& test : plan.cases) {
            const auto case_start = Clock::now();
            TestCaseReport case_report{
                test.id, test.name, Verdict::invalid, Milliseconds{0}, {}, {}};
            const auto reset_start = Clock::now();
            AdapterResult reset_result;
            try {
                reset_result = adapter.reset(reset_timeout);
            } catch (const std::exception& error) {
                reset_result = AdapterResult::failure(error.what());
            } catch (...) {
                reset_result = AdapterResult::failure("adapter reset threw an unknown exception");
            }
            const auto reset_elapsed = elapsed_since(reset_start);
            case_report.verdict = result_verdict(reset_result, reset_elapsed, reset_timeout);
            if (case_report.verdict != Verdict::pass) {
                case_report.message = reset_result.message.empty()
                    ? (case_report.verdict == Verdict::timeout ? "reset timed out" : "reset failed")
                    : reset_result.message;
            } else {
                for (std::size_t index = 0; index < test.steps.size(); ++index) {
                    const auto& step = test.steps[index];
                    StepTrace trace;
                    trace.index = index;
                    trace.input = step.input;
                    trace.allowed_expected_outputs = step.allowed_expected_outputs;
                    const auto step_start = Clock::now();
                    AdapterResult actual;
                    try {
                        actual = adapter.send(step.input, step.timeout);
                    } catch (const std::exception& error) {
                        actual = AdapterResult::failure(error.what());
                    } catch (...) {
                        actual = AdapterResult::failure("adapter send threw an unknown exception");
                    }
                    trace.elapsed = elapsed_since(step_start);
                    trace.actual_output = actual.output;
                    trace.verdict = result_verdict(actual, trace.elapsed, step.timeout);
                    trace.message = actual.message;
                    if (trace.verdict == Verdict::pass && !accepts(step, actual.output)) {
                        trace.verdict = Verdict::fail;
                        trace.message = "actual output is not in the allowed set";
                    }
                    if (trace.verdict == Verdict::timeout && trace.message.empty()) {
                        trace.message = "step timed out";
                    }
                    case_report.trace.push_back(std::move(trace));
                    case_report.verdict = combine(case_report.verdict,
                                                  case_report.trace.back().verdict);
                    if (case_report.trace.back().verdict != Verdict::pass) {
                        case_report.message = case_report.trace.back().message;
                        break;
                    }
                }
            }
            case_report.elapsed = elapsed_since(case_start);
            count(report.counts, case_report.verdict);
            report.verdict = combine(report.verdict, case_report.verdict);
            report.cases.push_back(std::move(case_report));
        }
    } catch (const std::exception& error) {
        TestCaseReport failed{"runner", "Runner failure", Verdict::invalid, Milliseconds{0}, error.what(), {}};
        count(report.counts, failed.verdict);
        report.verdict = Verdict::invalid;
        report.cases.push_back(std::move(failed));
    }
    adapter.close();
    if (report.cases.empty()) report.verdict = Verdict::inconclusive;
    report.elapsed = elapsed_since(plan_start);
    return report;
}

std::string to_string(Verdict verdict) {
    switch (verdict) {
        case Verdict::pass: return "pass";
        case Verdict::fail: return "fail";
        case Verdict::timeout: return "timeout";
        case Verdict::inconclusive: return "inconclusive";
        case Verdict::invalid: return "invalid";
    }
    return "invalid";
}

std::string to_json(const TestPlan& plan) {
    std::ostringstream json;
    json << "{\"schemaVersion\":\"" << json_escape(plan.schema_version)
         << "\",\"id\":\"" << json_escape(plan.id) << "\",\"name\":\""
         << json_escape(plan.name) << "\",\"modelId\":\"" << json_escape(plan.model_id)
         << "\",\"metadata\":";
    append_metadata(json, plan.metadata);
    json << ",\"cases\":[";
    for (std::size_t t = 0; t < plan.cases.size(); ++t) {
        if (t) json << ',';
        const auto& test = plan.cases[t];
        json << "{\"id\":\"" << json_escape(test.id) << "\",\"name\":\""
             << json_escape(test.name) << "\",\"metadata\":";
        append_metadata(json, test.metadata);
        json << ",\"steps\":[";
        for (std::size_t s = 0; s < test.steps.size(); ++s) {
            if (s) json << ',';
            const auto& step = test.steps[s];
            json << "{\"input\":\"" << json_escape(step.input) << "\",\"allowedExpectedOutputs\":";
            append_expected(json, step.allowed_expected_outputs);
            json << ",\"timeoutMs\":" << step.timeout.count() << ",\"metadata\":";
            append_metadata(json, step.metadata);
            json << '}';
        }
        json << "]}";
    }
    json << "]}";
    return json.str();
}

std::string to_json(const TestPlanReport& report) {
    std::ostringstream json;
    json << "{\"planId\":\"" << json_escape(report.plan_id) << "\",\"planName\":\""
         << json_escape(report.plan_name) << "\",\"verdict\":\"" << to_string(report.verdict)
         << "\",\"elapsedMs\":" << report.elapsed.count() << ",\"counts\":{\"pass\":"
         << report.counts.passed << ",\"fail\":" << report.counts.failed
         << ",\"timeout\":" << report.counts.timed_out << ",\"inconclusive\":"
         << report.counts.inconclusive << ",\"invalid\":" << report.counts.invalid
         << "},\"cases\":[";
    for (std::size_t t = 0; t < report.cases.size(); ++t) {
        if (t) json << ',';
        const auto& test = report.cases[t];
        json << "{\"id\":\"" << json_escape(test.id) << "\",\"name\":\""
             << json_escape(test.name) << "\",\"verdict\":\"" << to_string(test.verdict)
             << "\",\"elapsedMs\":" << test.elapsed.count() << ",\"message\":\""
             << json_escape(test.message) << "\",\"trace\":[";
        for (std::size_t s = 0; s < test.trace.size(); ++s) {
            if (s) json << ',';
            const auto& step = test.trace[s];
            json << "{\"index\":" << step.index << ",\"input\":\"" << json_escape(step.input)
                 << "\",\"allowedExpectedOutputs\":";
            append_expected(json, step.allowed_expected_outputs);
            json << ",\"actualOutput\":";
            append_optional(json, step.actual_output);
            json << ",\"verdict\":\"" << to_string(step.verdict) << "\",\"elapsedMs\":"
                 << step.elapsed.count() << ",\"message\":\"" << json_escape(step.message) << "\"}";
        }
        json << "]}";
    }
    json << "]}";
    return json.str();
}

}  // namespace fsm::runner
