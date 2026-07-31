#include "fsm.hpp"

#include <fstream>
#include <iostream>
#include <iterator>

int main(int argc, char** argv) {
    std::string source;
    if (argc > 1) {
        std::ifstream file(argv[1], std::ios::binary);
        if (!file) {
            std::cerr << "Cannot open file: " << argv[1] << '\n';
            return 2;
        }
        source.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    } else {
        source.assign(std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>());
    }

    const auto result = fsm::parse_machine(source);
    for (const auto& diagnostic : result.diagnostics) {
        std::cerr << (diagnostic.severity == fsm::Severity::error ? "error" : "warning")
                  << ':' << diagnostic.line << ": " << diagnostic.message << '\n';
    }
    if (!result.machine) return 1;
    std::cout << fsm::to_json(*result.machine) << '\n';
    return 0;
}
