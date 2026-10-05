param([ValidateSet('yahoo','demo','massive')][string]$Provider)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or later first.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if ($Provider) { $env:MARKET_PROVIDER = $Provider }
Write-Host 'Pulse will open at http://127.0.0.1:5173. Press Ctrl+C to stop.'
& npm.cmd run dev
