param(
    [switch]$Unpacked
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactDirectory = Join-Path $projectRoot 'artifacts'
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryOutput = Join-Path $temporaryRoot ("automata-studio-builder-{0}" -f [Guid]::NewGuid().ToString('N'))

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

New-Item -ItemType Directory -Path $temporaryOutput -Force | Out-Null
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null

try {
    Push-Location $projectRoot
    try {
        Invoke-Checked 'npm' @('run', 'desktop:assets')
        Invoke-Checked 'npm' @('run', 'build:desktop:web')
        Invoke-Checked 'npm' @('run', 'cli:build')
        $builderArguments = @('electron-builder')
        if ($Unpacked) {
            $builderArguments += '--dir'
        } else {
            $builderArguments += @('--win', 'nsis', 'portable', '--publish', 'never')
        }
        $builderArguments += "--config.directories.output=$temporaryOutput"
        Invoke-Checked 'npx' $builderArguments
    } finally {
        Pop-Location
    }

    if ($Unpacked) {
        $unpackedSource = Join-Path $temporaryOutput 'win-unpacked'
        $unpackedTarget = Join-Path $artifactDirectory 'win-unpacked'
        if (Test-Path -LiteralPath $unpackedTarget) {
            $resolvedTarget = (Resolve-Path -LiteralPath $unpackedTarget).Path
            if (-not $resolvedTarget.StartsWith($artifactDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to replace a directory outside artifacts: $resolvedTarget"
            }
            Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
        }
        Copy-Item -LiteralPath $unpackedSource -Destination $unpackedTarget -Recurse
        Write-Output "Unpacked desktop application: $unpackedTarget"
    } else {
        Get-ChildItem -LiteralPath $temporaryOutput -File |
            Where-Object { $_.Extension -in '.exe', '.blockmap', '.yml' } |
            Copy-Item -Destination $artifactDirectory -Force
        Write-Output "Windows artifacts: $artifactDirectory"
        Get-ChildItem -LiteralPath $artifactDirectory -File |
            Where-Object { $_.Extension -in '.exe', '.blockmap', '.yml' } |
            Select-Object Name, Length
    }
} finally {
    if (Test-Path -LiteralPath $temporaryOutput) {
        $resolvedTemporaryOutput = (Resolve-Path -LiteralPath $temporaryOutput).Path
        if ($resolvedTemporaryOutput.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedTemporaryOutput -Recurse -Force
        }
    }
}
