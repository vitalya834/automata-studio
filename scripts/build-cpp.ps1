param([switch]$Test)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'build-cpp'

$compiler = $null
$compilerCandidates = @($env:CXX, 'C:\msys64\mingw64\bin\g++.exe')
foreach ($candidate in $compilerCandidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $compiler = (Resolve-Path -LiteralPath $candidate).Path
        break
    }
}
if (-not $compiler) {
    $command = Get-Command 'g++.exe' -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command 'g++' -ErrorAction SilentlyContinue }
    if ($command) { $compiler = $command.Source }
}
if (-not $compiler) {
    throw 'C++ compiler not found. Set CXX or install g++ in PATH.'
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
