#!/usr/bin/env bash
# Crawlit installer — https://github.com/arufian/Crawlit
#
#   curl -fsSL https://raw.githubusercontent.com/arufian/Crawlit/main/install.sh | bash
#
# Options (pass after `bash -s --` when piping):
#   --with-skill   also install the crawlit-skill pack into Claude Code / Codex if found
#   --no-start     download and configure only, don't build or start
#
# Environment:
#   CRAWLIT_DIR    install location            (default: ~/.crawlit)
#   CRAWLIT_PORT   host port for the API       (default: 3000)
#   CRAWLIT_REF    git branch or tag to install (default: main)
#
# Re-running the installer updates an existing install. Works with macOS bash 3.2.

# Everything lives in main() so a partially downloaded script never runs
main() {
  set -euo pipefail

  REPO="arufian/Crawlit"
  DIR="${CRAWLIT_DIR:-$HOME/.crawlit}"
  PORT="${CRAWLIT_PORT:-3000}"
  REF="${CRAWLIT_REF:-main}"
  WITH_SKILL=0
  START=1
  for arg in "$@"; do
    case "$arg" in
      --with-skill) WITH_SKILL=1 ;;
      --no-start) START=0 ;;
      -h|--help) sed -n '2,16p' "$0" 2>/dev/null || true; return 0 ;;
      *) fail "Unknown option: $arg (try --with-skill or --no-start)" ;;
    esac
  done

  printf '\n%sCrawlit installer%s\n\n' "$BOLD" "$RESET"

  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      fail "On Windows, use the PowerShell installer:  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex   (or run this script inside WSL)" ;;
  esac

  check_docker
  fetch_source
  configure
  install_cli
  if [ "$START" -eq 1 ]; then
    start_crawlit
    smoke_test
  fi
  agent_setup
  summary
}

# ── output helpers ─────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi
step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '\n%sError:%s %s\n\n' "$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── 1. Docker ──────────────────────────────────────────────────────────
docker_help() {
  cat >&2 <<EOF

${BOLD}Crawlit needs Docker. Please install Docker first, then run this installer again.${RESET}

  macOS:    Docker Desktop  https://docs.docker.com/desktop/setup/install/mac-install/
            (or OrbStack    https://orbstack.dev — lighter, also works)
  Windows:  Docker Desktop  https://docs.docker.com/desktop/setup/install/windows-install/
            then use the PowerShell installer instead of this one:
            irm https://raw.githubusercontent.com/arufian/Crawlit/main/install.ps1 | iex
  Linux:    Docker Engine   https://docs.docker.com/engine/install/
            quick way:      curl -fsSL https://get.docker.com | sh

After installing, open Docker once so it finishes setting up.
EOF
  exit 1
}

check_docker() {
  step "Checking Docker"
  have docker || { printf '    %s✗%s Docker is not installed.\n' "$RED" "$RESET" >&2; docker_help; }

  if ! docker info >/dev/null 2>&1; then
    # Permission problem on Linux is a different fix than "not running"
    if docker info 2>&1 | grep -qi "permission denied"; then
      fail "Docker is installed but your user can't use it. Run: sudo usermod -aG docker \$USER, then log out and back in."
    fi
    if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
      warn "Docker Desktop isn't running — starting it"
      open -a Docker
      local i
      for i in $(seq 1 90); do
        docker info >/dev/null 2>&1 && break
        sleep 2
      done
      docker info >/dev/null 2>&1 || fail "Docker Desktop didn't start within 3 minutes. Open it manually, then re-run this installer."
    else
      fail "Docker is installed but not running. Start Docker (Docker Desktop, OrbStack, or 'sudo systemctl start docker'), then re-run this installer."
    fi
  fi

  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif have docker-compose; then
    COMPOSE="docker-compose"
  else
    fail "Docker Compose is missing. Install the Compose plugin: https://docs.docker.com/compose/install/"
  fi
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo ready), $COMPOSE"
}

# ── 2. Source ──────────────────────────────────────────────────────────
fetch_source() {
  step "Getting Crawlit ($REF) into $DIR"
  if [ -d "$DIR/.git" ] && have git; then
    git -C "$DIR" fetch --quiet --depth 1 origin "$REF"
    git -C "$DIR" checkout --quiet -B "$REF" FETCH_HEAD
    ok "Updated existing install to $(git -C "$DIR" rev-parse --short HEAD)"
  elif [ -e "$DIR" ] && [ ! -f "$DIR/docker-compose.yml" ]; then
    fail "$DIR exists but isn't a Crawlit install. Remove it or set CRAWLIT_DIR to another folder."
  elif have git; then
    if [ -d "$DIR" ]; then
      # Tarball install from an earlier run: replace it with a git checkout, keeping .env
      local keep_env=""
      [ -f "$DIR/.env" ] && keep_env="$(cat "$DIR/.env")"
      rm -rf "$DIR"
      git clone --quiet --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$DIR"
      [ -n "$keep_env" ] && printf '%s\n' "$keep_env" > "$DIR/.env"
    else
      git clone --quiet --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$DIR"
    fi
    ok "Downloaded $(git -C "$DIR" rev-parse --short HEAD)"
  else
    have curl || fail "Need git or curl to download Crawlit."
    mkdir -p "$DIR"
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$DIR" --strip-components=1
    ok "Downloaded $REF (tarball; install git for faster updates)"
  fi
}

# ── 3. Config ──────────────────────────────────────────────────────────
set_env() {
  # set_env KEY VALUE — add or replace a line in .env (portable sed, no -i differences)
  local key="$1" value="$2" file="$DIR/.env" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp"
  else
    { cat "$file" 2>/dev/null; printf '%s=%s\n' "$key" "$value"; } > "$tmp"
  fi
  mv "$tmp" "$file"
}

configure() {
  step "Configuring"
  if [ ! -f "$DIR/.env" ]; then
    cp "$DIR/.env.example" "$DIR/.env"
    ok "Created $DIR/.env (all settings optional)"
  else
    ok "Kept your existing $DIR/.env"
  fi
  # Only write the port when the user chose one, so .env stays clean by default
  if [ -n "${CRAWLIT_PORT:-}" ]; then
    set_env CRAWLIT_PORT "$PORT"
    ok "API port set to $PORT"
  elif grep -q '^CRAWLIT_PORT=' "$DIR/.env"; then
    PORT="$(grep '^CRAWLIT_PORT=' "$DIR/.env" | tail -1 | cut -d= -f2)"
  fi
}

# ── 4. `crawlit` command ───────────────────────────────────────────────
install_cli() {
  step "Installing the crawlit command"
  chmod +x "$DIR/bin/crawlit"
  local bindir=""
  for d in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
    case ":$PATH:" in *":$d:"*) [ -d "$d" ] && [ -w "$d" ] && { bindir="$d"; break; } ;; esac
  done
  if [ -z "$bindir" ]; then
    bindir="$HOME/.local/bin"
    mkdir -p "$bindir"
    PATH_HINT=1
  fi
  ln -sf "$DIR/bin/crawlit" "$bindir/crawlit"
  CLI_PATH="$bindir/crawlit"
  ok "$CLI_PATH"
}

# ── 5. Start ───────────────────────────────────────────────────────────
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

start_crawlit() {
  step "Building and starting Crawlit (first run takes 2–5 minutes)"
  local running
  running="$(cd "$DIR" && $COMPOSE ps -q app 2>/dev/null || true)"
  if [ -z "$running" ] && port_busy "$PORT"; then
    if curl -sf -m 3 "http://localhost:$PORT/health" 2>/dev/null | grep -q '"status":"ok"'; then
      fail "Another Crawlit is already running on port $PORT (not this install). Stop it, or install on another port: CRAWLIT_PORT=3001"
    fi
    fail "Port $PORT is already in use. Install on another port, e.g.: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | CRAWLIT_PORT=3001 bash"
  fi

  (cd "$DIR" && $COMPOSE up -d --build) || fail "docker compose failed — see the output above. Logs: crawlit logs"

  printf '    waiting for the API'
  local i
  for i in $(seq 1 120); do
    if curl -sf -m 3 "http://localhost:$PORT/health" >/dev/null 2>&1; then
      printf '\n'
      ok "Crawlit is up at http://localhost:$PORT"
      return 0
    fi
    printf '.'
    sleep 2
  done
  printf '\n'
  fail "Crawlit didn't become healthy in 4 minutes. Check: crawlit logs"
}

smoke_test() {
  step "Test scrape"
  local title
  title="$(curl -sf -m 60 -X POST "http://localhost:$PORT/v1/scrape" \
    -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' \
    | sed -n 's/.*"title":"\([^"]*\)".*/\1/p' || true)"
  if [ -n "$title" ]; then
    ok "https://example.com → \"$title\""
  else
    warn "Test scrape returned nothing (no internet from Docker?). Try: crawlit status"
  fi
}

# ── 6. Agents ──────────────────────────────────────────────────────────
agent_setup() {
  [ "$WITH_SKILL" -eq 1 ] || return 0
  step "Installing the crawlit-skill pack"
  local done_any=0
  if have claude; then
    claude plugin marketplace add arufian/crawlit-skill >/dev/null 2>&1 || true
    if claude plugin install crawlit@crawlit-skills >/dev/null 2>&1; then ok "Claude Code"; done_any=1; else warn "Claude Code: install failed, run the commands below manually"; fi
  fi
  if have codex; then
    codex plugin marketplace add arufian/crawlit-skill >/dev/null 2>&1 || true
    if codex plugin add crawlit@crawlit-skills >/dev/null 2>&1; then ok "Codex"; done_any=1; else warn "Codex: install failed, run the commands below manually"; fi
  fi
  [ "$done_any" -eq 1 ] || warn "No Claude Code or Codex CLI found"
  SKILL_DONE=$done_any
}

summary() {
  local base="http://localhost:$PORT"
  printf '\n%sDone.%s Crawlit is installed in %s\n\n' "$GREEN$BOLD" "$RESET" "$DIR"
  if [ "$START" -eq 1 ]; then
    printf '  API:    %s\n' "$base"
    printf '  Try:    curl -X POST %s/v1/search -H '"'"'Content-Type: application/json'"'"' -d '"'"'{"query":"hello world","limit":3}'"'"'\n' "$base"
  fi
  printf '  Manage: crawlit start | stop | status | logs | update | uninstall\n'
  if [ "${PATH_HINT:-0}" -eq 1 ]; then
    printf '\n  %sAdd this to your shell profile so the crawlit command is found:%s\n' "$YELLOW" "$RESET"
    printf '    export PATH="$HOME/.local/bin:$PATH"\n'
  fi
  if [ "${SKILL_DONE:-0}" -ne 1 ]; then
    printf '\n  Let your AI agent use it:\n'
    printf '    %sClaude Code:%s claude plugin marketplace add arufian/crawlit-skill && claude plugin install crawlit@crawlit-skills\n' "$DIM" "$RESET"
    printf '    %sCodex:%s       codex plugin marketplace add arufian/crawlit-skill && codex plugin add crawlit@crawlit-skills\n' "$DIM" "$RESET"
  fi
  [ "$PORT" = "3000" ] || printf '\n  Using port %s: set CRAWLIT_BASE_URL=%s for the agent skill.\n' "$PORT" "$base"
  printf '\n  Docs: https://labs.arufian.dev/crawlit/\n\n'
}

main "$@"
