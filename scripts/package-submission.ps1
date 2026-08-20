# KRON Submission Package Builder (Windows PowerShell 5.1)
# Usage: .\scripts\package-submission.ps1
#
# Produces a clean, judge-ready zip that:
#   - EXCLUDES all .env files (real secrets must never ship)
#   - EXCLUDES node_modules / dist / data / .git (judge rebuilds from source)
#   - INCLUDES the docs, TEAL source, prisma schema and package manifests
#
# Output: kron-submission-<date>.zip in the repo root.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $ProjectRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$zipPath = Join-Path $ProjectRoot "kron-submission-$stamp.zip"

$excludes = @(
    ".env", ".env.*", "!*.env.example",
    "node_modules", "dist", "build", "coverage",
    "data", "tmp", ".git", ".pnpm-store", ".github",
    "*.log", "kron-submission-*.zip"
)

$files = Get-ChildItem -Recurse -File -Path $ProjectRoot | Where-Object {
    $rel = $_.FullName.Substring($ProjectRoot.Length + 1)
    $keep = $true
    foreach ($ex in $excludes) {
        $negated = $ex.StartsWith("!")
        $pat = if ($negated) { $ex.Substring(1) } else { $ex }
        if ($negated) {
            if ($rel -like $pat) { $keep = $true }
        } elseif ($rel -eq $pat -or $rel -like "$pat\*" -or $rel -like $pat) {
            if (-not $negated) { $keep = $false }
        }
    }
    $keep
}

# Normalize separators for the zip entries
$entryList = $files | ForEach-Object {
    $rel = $_.FullName.Substring($ProjectRoot.Length + 1).Replace("\", "/")
    "$rel=$($_.FullName)"
}

Write-Host "Building submission package with $($files.Count) files..." -ForegroundColor Yellow

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item $zipPath }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
    foreach ($entry in $entryList) {
        $name, $full = $entry.Split("=", 2)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $name) | Out-Null
    }
} finally {
    $zip.Dispose()
}

Write-Host ""
Write-Host "Submission package ready:" -ForegroundColor Green
Write-Host "  $zipPath" -ForegroundColor White
Write-Host ""
Write-Host "Next: unzip on a clean machine and run .\scripts\offline-bootstrap.ps1" -ForegroundColor Cyan