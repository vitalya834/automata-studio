#include "fsm.hpp"

#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>

namespace {

void usage() {
    std::cerr
        << "Usage:\n"
        << "  fsm-cli [parse] [file]              Parse file (or stdin) to JSON\n"
        << "  fsm-cli analyze <file>              Analyze a machine\n"
        << "  fsm-cli cover <file>                Build transition-cover tests\n"
        << "  fsm-cli generate [options]          Generate a machine\n"
        << "Generate options: --name N --states N --inputs N --outputs N --seed N\n"
        << "                  --nondeterministic --incomplete\n";
}

std::string read_source(const std::string& path) {
    if (path.empty() || path == "-") return {std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>()};
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("Cannot open file: " + path);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

bool report_diagnostics(const fsm::ParseResult& result) {
    bool has_errors = false;
    for (const auto& diagnostic : result.diagnostics) {
        has_errors |= diagnostic.severity == fsm::Severity::error;
        std::cerr << (diagnostic.severity == fsm::Severity::error ? "error" : "warning")
                  << ':' << diagnostic.line << ": " << diagnostic.message << '\n';
    }
    return has_errors;
}

std::size_t parse_size(const std::string& option, const std::string& value) {
    std::size_t consumed = 0;
    const auto number = std::stoull(value, &consumed);
    if (consumed != value.size()) throw std::invalid_argument("Invalid value for " + option + ": " + value);
    return static_cast<std::size_t>(number);
}

}  // namespace

int main(int argc, char** argv) {
    try {
        std::string command = argc > 1 ? argv[1] : "parse";
        if (command == "--help" || command == "-h" || command == "help") {
            usage();
            return 0;
        }

        if (command == "generate") {
            fsm::GeneratorOptions options;
            for (int index = 2; index < argc; ++index) {
                const std::string option = argv[index];
                const auto value = [&]() -> std::string {
                    if (index + 1 >= argc) throw std::invalid_argument("Missing value for " + option);
                    return argv[++index];
                };
                if (option == "--name") options.name = value();
                else if (option == "--states" || option == "--state-count") options.state_count = parse_size(option, value());
                else if (option == "--inputs" || option == "--input-count") options.input_count = parse_size(option, value());
                else if (option == "--outputs" || option == "--output-count") options.output_count = parse_size(option, value());
                else if (option == "--seed") options.seed = static_cast<std::uint32_t>(parse_size(option, value()));
                else if (option == "--nondeterministic") options.deterministic = false;
                else if (option == "--deterministic") options.deterministic = true;
                else if (option == "--incomplete") options.complete = false;
                else if (option == "--complete") options.complete = true;
                else throw std::invalid_argument("Unknown option: " + option);
            }
            std::cout << fsm::to_json(fsm::generate_machine(options)) << '\n';
            return 0;
        }

        std::string path;
        if (command == "parse" || command == "analyze" || command == "cover") {
            if (argc > 2) path = argv[2];
            if ((command == "analyze" || command == "cover") && path.empty()) throw std::invalid_argument(command + " requires a file");
        } else {
            // Backward compatibility: `fsm-cli machine.fsm` is parse mode.
            path = command;
            command = "parse";
        }

        const auto parsed = fsm::parse_machine(read_source(path));
        const bool has_errors = report_diagnostics(parsed);
        if (!parsed.machine || (has_errors && command == "parse")) return 1;
        if (command == "parse") std::cout << fsm::to_json(*parsed.machine) << '\n';
        else if (command == "analyze") std::cout << fsm::to_json(fsm::analyze_machine(*parsed.machine)) << '\n';
        else {
            const auto cover = fsm::transition_cover(*parsed.machine);
            std::cout << fsm::to_json(cover) << '\n';
            for (const auto& diagnostic : cover.diagnostics) {
                std::cerr << (diagnostic.severity == fsm::Severity::error ? "error" : "warning")
                          << ':' << diagnostic.line << ": " << diagnostic.message << '\n';
                if (diagnostic.severity == fsm::Severity::error) return 2;
            }
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "error: " << error.what() << '\n';
        return 2;
    }
}
