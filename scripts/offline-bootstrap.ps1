# KRON Offline Bootstrap Script (Windows PowerShell 5.1)
# Usage: .\scripts\offline-bootstrap.ps1
# From: C:\Projects\Kron\

$ErrorActionPreference = "Stop"
# Robust even when invoked as `.\scripts\offline-bootstrap.ps1` or via absolute path
$ProjectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  KRON — Offline Hackathon Bootstrap" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

function Step($label, $script) {
    Write-Host ""
    Write-Host "[$label] $script" -ForegroundColor Yellow
    Write-Host ("-" * 74)
}

# 1. Install dependencies
Step "1" "Installing dependencies"
Set-Location $ProjectRoot
pnpm install

# 2. Database
Step "2" "Bootstrapping database"
pnpm --filter @kron/api prisma:migrate
pnpm --filter @kron/api prisma:seed

# 3. Docker localnet
Step "3" "Starting Algorand localnet (Docker)"
docker compose --profile localnet up -d

Write-Host "Waiting for algod to be healthy (this takes ~60s)..." -ForegroundColor Yellow
$maxWait = 120
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:4001/v2/status" -Headers @{ "X-Algo-API-Token" = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } -ErrorAction Stop
        if ($r.last_round) { break }
    } catch {
        # not ready yet
    }
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host "  ... ${waited}s" -NoNewline
    Write-Host ""
}
if ($waited -ge $maxWait) {
    Write-Host "WARNING: algod did not become healthy within ${maxWait}s. Continue anyway." -ForegroundColor Red
} else {
    Write-Host "algod is healthy." -ForegroundColor Green
}

# 4. Compile TEAL if needed
Step "4" "Compiling KRON TEAL (optional)"
try {
    pnpm --filter @kron/x402 compile:teal
} catch {
    Write-Host "TEAL compile skipped or failed (runtime compile will be attempted)." -ForegroundColor DarkYellow
}

# 5. Fund wallets
Step "5" "Funding agent wallets"
pnpm --filter @kron/api bootstrap:chain

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Bootstrap complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. API + Gateway:      pnpm --filter @kron/api dev" -ForegroundColor White
Write-Host "  2. Resource Server:    pnpm --filter @kron/resource-server dev" -ForegroundColor White
Write-Host "  3. Dashboard:          pnpm --filter @kron/dashboard dev" -ForegroundColor White
Write-Host ""
Write-Host "Open http://localhost:5173 (credentials: data/demo-credentials.txt)" -ForegroundColor Cyan
Write-Host ""
