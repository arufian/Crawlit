# Crawlit installer for Windows — https://github.com/arufian/Crawlit
#
#   irm https://raw.githubusercontent.com/arufian/Crawlit/main/install.ps1 | iex
#
# Environment (set before running, e.g. $env:CRAWLIT_PORT = "3001"):
#   CRAWLIT_DIR    install location             (default: $HOME\.crawlit)
#   CRAWLIT_PORT   host port for the API        (default: 3000)
#   CRAWLIT_REF    git branch or tag to install (default: main)
#   CRAWLIT_SKILL  "1" to also install the crawlit-skill pack into Claude Code / Codex
#
# Re-running updates an existing install. Works in Windows PowerShell 5.1 and PowerShell 7.

function Install-Crawlit {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1

  $Repo = 'arufian/Crawlit'
  $Dir = if ($env:CRAWLIT_DIR) { $env:CRAWLIT_DIR } else { Join-Path $HOME '.crawlit' }
  $Port = if ($env:CRAWLIT_PORT) { $env:CRAWLIT_PORT } else { '3000' }
  $Ref = if ($env:CRAWLIT_REF) { $env:CRAWLIT_REF } else { 'main' }

  function Step($msg) { Write-Host "==> $msg" -ForegroundColor White }
  function Ok($msg) { Write-Host "    + $msg" -ForegroundColor Green }
  function Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }
  function Fail($msg) { Write-Host ""; Write-Host "Error: $msg" -ForegroundColor Red; Write-Host ""; throw "Crawlit install failed" }
  function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

  # Run a native command quietly and return whether it succeeded. Native stderr must not turn into
  # terminating errors under ErrorActionPreference=Stop on Windows PowerShell 5.1.
  function Test-Native([scriptblock]$Block) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $Block *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false } finally { $ErrorActionPreference = $prev }
  }
  function Invoke-Native([scriptblock]$Block, [string]$What) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $Block } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { Fail "$What failed (exit code $LASTEXITCODE). See the output above." }
  }
  function Test-Healthy { try { $null = Invoke-RestMethod "http://localhost:$Port/health" -TimeoutSec 3; return $true } catch { return $false } }
  function Test-PortBusy([int]$p) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { return $c.ConnectAsync('127.0.0.1', $p).Wait(500) } catch { return $false } finally { $c.Dispose() }
  }

  Write-Host ""; Write-Host "Crawlit installer" -ForegroundColor White; Write-Host ""

  # ── 1. Docker ────────────────────────────────────────────────────────
  Step 'Checking Docker'
  if (-not (Have 'docker')) {
    Write-Host ""
    Write-Host "Crawlit needs Docker. Please install Docker Desktop first, then run this installer again." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Download:  https://docs.docker.com/desktop/setup/install/windows-install/"
    Write-Host "  Or:        winget install -e --id Docker.DockerDesktop"
    Write-Host ""
    Write-Host "After installing, open Docker Desktop once so it finishes setting up (it may ask to enable WSL 2)."
    Write-Host ""
    throw "Docker is not installed"
  }
  if (-not (Test-Native { docker info })) {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) {
      Warn "Docker Desktop isn't running - starting it"
      Start-Process $desktop
      $deadline = (Get-Date).AddMinutes(3)
      while ((Get-Date) -lt $deadline -and -not (Test-Native { docker info })) { Start-Sleep -Seconds 3 }
      if (-not (Test-Native { docker info })) { Fail "Docker Desktop didn't start within 3 minutes. Open it manually, then re-run this installer." }
    } else {
      Fail "Docker is installed but not running. Start Docker Desktop, then re-run this installer."
    }
  }
  if (-not (Test-Native { docker compose version })) { Fail "Docker Compose is missing. Update Docker Desktop: https://docs.docker.com/desktop/" }
  Ok 'Docker and Docker Compose are ready'

  # ── 2. Source ────────────────────────────────────────────────────────
  Step "Getting Crawlit ($Ref) into $Dir"
  $isGit = Test-Path (Join-Path $Dir '.git')
  if ($isGit -and (Have 'git')) {
    Invoke-Native { git -C $Dir fetch --quiet --depth 1 origin $Ref } 'git fetch'
    Invoke-Native { git -C $Dir checkout --quiet -B $Ref FETCH_HEAD } 'git checkout'
    Ok 'Updated existing install'
  } elseif ((Test-Path $Dir) -and -not (Test-Path (Join-Path $Dir 'docker-compose.yml'))) {
    Fail "$Dir exists but isn't a Crawlit install. Remove it or set `$env:CRAWLIT_DIR to another folder."
  } else {
    $keepEnv = $null
    $envFile = Join-Path $Dir '.env'
    if (Test-Path $envFile) { $keepEnv = Get-Content $envFile -Raw }
    # Windows can't delete the folder we're standing in (e.g. when run via 'crawlit update')
    Set-Location $HOME
    if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
    if (Have 'git') {
      # Keep LF endings: shell scripts in the repo are also used inside Linux containers
      Invoke-Native { git -c core.autocrlf=false clone --quiet --depth 1 --branch $Ref "https://github.com/$Repo.git" $Dir } 'git clone'
    } else {
      $tmp = Join-Path ([IO.Path]::GetTempPath()) ("crawlit-" + [guid]::NewGuid())
      New-Item -ItemType Directory $tmp | Out-Null
      $zip = Join-Path $tmp 'crawlit.zip'
      Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip -UseBasicParsing
      Expand-Archive $zip -DestinationPath $tmp
      $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
      Move-Item $inner.FullName $Dir
      Remove-Item $tmp -Recurse -Force
    }
    if ($keepEnv) { Set-Content $envFile $keepEnv -NoNewline -Encoding ascii }
    Ok 'Downloaded'
  }

  # ── 3. Config ────────────────────────────────────────────────────────
  Step 'Configuring'
  $envFile = Join-Path $Dir '.env'
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $Dir '.env.example') $envFile
    Ok "Created $envFile (all settings optional)"
  } else {
    Ok "Kept your existing $envFile"
  }
  $lines = @(Get-Content $envFile)
  if ($env:CRAWLIT_PORT) {
    $lines = @($lines | Where-Object { $_ -notmatch '^CRAWLIT_PORT=' }) + "CRAWLIT_PORT=$Port"
    Set-Content $envFile $lines -Encoding ascii
    Ok "API port set to $Port"
  } else {
    $existing = $lines | Where-Object { $_ -match '^CRAWLIT_PORT=' } | Select-Object -Last 1
    if ($existing) { $Port = $existing.Split('=')[1].Trim() }
  }

  # ── 4. `crawlit` command ─────────────────────────────────────────────
  Step 'Installing the crawlit command'
  $binDir = Join-Path $Dir 'bin'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ";$binDir").TrimStart(';'), 'User')
    $env:Path = "$env:Path;$binDir"
    Ok "Added $binDir to your PATH (open a new terminal to use 'crawlit')"
  } else {
    Ok "$binDir is already on your PATH"
  }

  # ── 5. Start ─────────────────────────────────────────────────────────
  Step 'Building and starting Crawlit (first run takes 2-5 minutes)'
  Push-Location $Dir
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $running = (& docker compose ps -q app 2>$null)
    $ErrorActionPreference = $prev
    if (-not $running -and (Test-PortBusy ([int]$Port))) {
      if (Test-Healthy) { Fail "Another Crawlit is already running on port $Port. Stop it, or install on another port: `$env:CRAWLIT_PORT = '3001'" }
      Fail "Port $Port is already in use. Install on another port: `$env:CRAWLIT_PORT = '3001'; irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex"
    }
    Invoke-Native { docker compose up -d --build } 'docker compose up'
  } finally { Pop-Location }

  Write-Host -NoNewline '    waiting for the API'
  $deadline = (Get-Date).AddMinutes(4)
  $up = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-Healthy) { $up = $true; break }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
  }
  Write-Host ''
  if (-not $up) { Fail "Crawlit didn't become healthy in 4 minutes. Check: crawlit logs" }
  Ok "Crawlit is up at http://localhost:$Port"

  Step 'Test scrape'
  try {
    $r = Invoke-RestMethod -Method Post "http://localhost:$Port/v1/scrape" -ContentType 'application/json' -Body '{"url":"https://example.com"}' -TimeoutSec 60
    Ok "https://example.com -> `"$($r.data.metadata.title)`""
  } catch {
    Warn 'Test scrape returned nothing (no internet from Docker?). Try: crawlit status'
  }

  # ── 6. Agents ────────────────────────────────────────────────────────
  $skillDone = $false
  if ($env:CRAWLIT_SKILL -eq '1') {
    Step 'Installing the crawlit-skill pack'
    if (Have 'claude') {
      $null = Test-Native { claude plugin marketplace add arufian/crawlit-skill }
      if (Test-Native { claude plugin install crawlit@crawlit-skills }) { Ok 'Claude Code'; $skillDone = $true } else { Warn 'Claude Code: install failed, run the commands below manually' }
    }
    if (Have 'codex') {
      $null = Test-Native { codex plugin marketplace add arufian/crawlit-skill }
      if (Test-Native { codex plugin add crawlit@crawlit-skills }) { Ok 'Codex'; $skillDone = $true } else { Warn 'Codex: install failed, run the commands below manually' }
    }
    if (-not $skillDone) { Warn 'No Claude Code or Codex CLI found' }
  }

  # ── Summary ──────────────────────────────────────────────────────────
  $base = "http://localhost:$Port"
  Write-Host ''
  Write-Host "Done. Crawlit is installed in $Dir" -ForegroundColor Green
  Write-Host ''
  Write-Host "  API:    $base"
  Write-Host "  Try:    Invoke-RestMethod -Method Post $base/v1/search -ContentType 'application/json' -Body '{`"query`":`"hello world`",`"limit`":3}'"
  Write-Host '  Manage: crawlit start | stop | status | logs | update | uninstall   (in a new terminal)'
  if (-not $skillDone) {
    Write-Host ''
    Write-Host '  Let your AI agent use it:'
    Write-Host '    Claude Code: claude plugin marketplace add arufian/crawlit-skill; claude plugin install crawlit@crawlit-skills'
    Write-Host '    Codex:       codex plugin marketplace add arufian/crawlit-skill; codex plugin add crawlit@crawlit-skills'
  }
  if ($Port -ne '3000') { Write-Host ''; Write-Host "  Using port ${Port}: set CRAWLIT_BASE_URL=$base for the agent skill." }
  Write-Host ''
  Write-Host '  Docs: https://labs.arufian.dev/crawlit/'
  Write-Host ''
}

Install-Crawlit
