param([switch]$Test)

$ErrorActionPreference = 'Stop'
$compiler = 'C:\msys64\mingw64\bin\g++.exe'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'build-cpp'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "C++ compiler not found: $compiler"
}

# g++.exe needs the MinGW runtime DLLs from the same directory.
$env:PATH = (Split-Path -Parent $compiler) + ';' + $env:PATH

New-Item -ItemType Directory -Path $output -Force | Out-Null
Push-Location $root
$resultCode = 0

try {
    if ($Test) {
        & $compiler -std=c++20 -Wall -Wextra -pedantic `
            '.\cpp\fsm.cpp' '.\cpp\test_fsm.cpp' -I '.\cpp' `
            -static -static-libgcc -static-libstdc++ `
            -o '.\build-cpp\fsm-tests.exe'
        $resultCode = $LASTEXITCODE
        if ($resultCode -eq 0) {
            & '.\build-cpp\fsm-tests.exe'
            $resultCode = $LASTEXITCODE
        }
        if ($resultCode -eq 0) {
            & $compiler -std=c++20 -Wall -Wextra -pedantic `
                '.\cpp\fsm.cpp' '.\cpp\runner.cpp' '.\cpp\test_runner.cpp' -I '.\cpp' `
                -static -static-libgcc -static-libstdc++ `
                -o '.\build-cpp\runner-tests.exe'
            $resultCode = $LASTEXITCODE
        }
        if ($resultCode -eq 0) {
            & '.\build-cpp\runner-tests.exe'
            $resultCode = $LASTEXITCODE
        }
    } else {
        & $compiler -std=c++20 -Wall -Wextra -pedantic `
            '.\cpp\fsm.cpp' '.\cpp\main.cpp' -I '.\cpp' `
            -static -static-libgcc -static-libstdc++ `
            -o '.\build-cpp\fsm-cli.exe'
        $resultCode = $LASTEXITCODE
    }
} finally {
    Pop-Location
}

exit $resultCode
