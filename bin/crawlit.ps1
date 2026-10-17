# crawlit — manage a local Crawlit install on Windows (installed by install.ps1)
param([string]$Command = 'help')

$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $PSScriptRoot
Set-Location $Dir

$Port = '3000'
$envFile = Join-Path $Dir '.env'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^CRAWLIT_PORT=' } | Select-Object -Last 1
  if ($line) { $Port = $line.Split('=')[1].Trim() }
}
$Base = "http://localhost:$Port"

function Invoke-Native([scriptblock]$Block) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $prev }
}
function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'Docker is not installed. Install Docker Desktop first: https://docs.docker.com/desktop/setup/install/windows-install/' -ForegroundColor Red
    exit 1
  }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & docker info *> $null
  $ErrorActionPreference = $prev
  if ($LASTEXITCODE -ne 0) { Write-Host 'Docker is not running. Start Docker Desktop first.' -ForegroundColor Red; exit 1 }
}
function Wait-Healthy {
  Write-Host -NoNewline "waiting for $Base"
  $deadline = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $deadline) {
    try { $null = Invoke-RestMethod "$Base/health" -TimeoutSec 3; Write-Host ''; Write-Host "Crawlit is up at $Base" -ForegroundColor Green; return } catch { }
    Write-Host -NoNewline '.'; Start-Sleep -Seconds 2
  }
  Write-Host ''; Write-Host 'Not healthy yet. Check: crawlit logs' -ForegroundColor Yellow
}

switch ($Command) {
  'start'   { Test-DockerReady; Invoke-Native { docker compose up -d }; Wait-Healthy }
  'stop'    { Test-DockerReady; Invoke-Native { docker compose stop } }
  'restart' { Test-DockerReady; Invoke-Native { docker compose restart app }; Wait-Healthy }
  'status'  {
    try { Invoke-RestMethod "$Base/health" -TimeoutSec 3 | ConvertTo-Json -Depth 4; Write-Host "Running at $Base (installed in $Dir)" }
    catch { Write-Host "Not running at $Base. Start it with: crawlit start"; exit 1 }
  }
  'logs'    { Test-DockerReady; Invoke-Native { docker compose logs -f --tail=100 app } }
  'update'  {
    Test-DockerReady
    $env:CRAWLIT_DIR = $Dir
    Set-Location $HOME
    Invoke-RestMethod https://raw.githubusercontent.com/arufian/Crawlit/main/install.ps1 | Invoke-Expression
  }
  'uninstall' {
    $answer = Read-Host "This stops Crawlit, deletes its cache, and removes $Dir. Continue? [y/N]"
    if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled.'; exit 0 }
    Invoke-Native { docker compose down -v --rmi local }
    $binDir = Join-Path $Dir 'bin'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
      [Environment]::SetEnvironmentVariable('Path', (($userPath -split ';') | Where-Object { $_ -and $_ -ne $binDir }) -join ';', 'User')
    }
    Set-Location $HOME
    Remove-Item $Dir -Recurse -Force
    Write-Host 'Crawlit removed.'
  }
  'open'    { Start-Process 'https://labs.arufian.dev/crawlit/' }
  default   {
    Write-Host @"
crawlit - manage your local Crawlit (installed in $Dir)

  crawlit start       start Crawlit and wait until it's ready
  crawlit stop        stop it (cache is kept)
  crawlit restart     restart the API
  crawlit status      health, version and search engine status
  crawlit logs        follow the server logs
  crawlit update      update to the latest version (keeps your .env)
  crawlit uninstall   stop and remove everything
  crawlit open        open the docs website

API: $Base    Settings: $Dir\.env
"@
  }
}
