#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PID_FILE="$SCRIPT_DIR/app_dev.pid"
LOG_FILE="$SCRIPT_DIR/app_dev.log"
INSTALL_STAMP="$SCRIPT_DIR/node_modules/.qq-farm-install-stamp"
WEB_OUTPUT="$SCRIPT_DIR/web/dist/index.html"
CORE_OUTPUT="$SCRIPT_DIR/core/client.js"
CORE_RUNTIME_OUTPUT="$SCRIPT_DIR/core/dist/runtime/runtime-engine.js"
FORCE_BUILD=0

cd "$SCRIPT_DIR"

die() {
    echo "start.sh: $*" >&2
    exit 1
}

# 看门狗幂等启动；被看门狗自己调用时用 QQ_FARM_NO_WATCHDOG=1 跳过，避免递归。
start_watchdog_if_needed() {
    [[ "${QQ_FARM_NO_WATCHDOG:-0}" == "1" ]] && return 0
    [[ -f "$SCRIPT_DIR/watchdog.sh" ]] || return 0
    bash "$SCRIPT_DIR/watchdog.sh" start || true
}

usage() {
    echo "Usage: bash start.sh [--rebuild]"
    echo "  --rebuild  Force a full Web and Core rebuild before starting."
}

run_pnpm() {
    if command -v corepack >/dev/null 2>&1; then
        corepack pnpm "$@"
    elif command -v pnpm >/dev/null 2>&1; then
        pnpm "$@"
    else
        die "pnpm or corepack is required."
    fi
}

has_newer_input() {
    local output="$1"
    shift
    local input=""

    [[ -e "$output" ]] || return 0
    for input in "$@"; do
        [[ -e "$input" ]] || continue
        if find "$input" -type f -newer "$output" -print -quit 2>/dev/null | grep -q .; then
            return 0
        fi
    done
    return 1
}

is_our_process() {
    local pid="$1"
    local process_dir=""
    local command_line=""

    kill -0 "$pid" 2>/dev/null || return 1

    if [[ -e "/proc/$pid/cwd" ]]; then
        process_dir="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
        [[ -z "$process_dir" || "$process_dir" == "$SCRIPT_DIR" ]] || return 1
    fi

    if [[ -r "/proc/$pid/cmdline" ]]; then
        command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    fi
    [[ "$command_line" == *"core/client.js"* || "$command_line" == *"core/dist"* ]]
}

# 看门狗与手动 start.sh 可能同时触发，两个实例会重复购买。
# 用目录锁串行化：node/socat 不会继承它，进程被 SIGKILL 后按 pid 判活清理。
LOCK_DIR="$SCRIPT_DIR/.start.lock"
acquire_start_lock() {
    local holder=""
    local attempt=0

    for attempt in 1 2; do
        if mkdir "$LOCK_DIR" 2>/dev/null; then
            printf '%s\n' "$$" > "$LOCK_DIR/pid"
            trap 'rm -rf "$LOCK_DIR"' EXIT
            return 0
        fi
        holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
        if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
            echo "start.sh is already running (PID $holder); refusing to start a second instance." >&2
            return 1
        fi
        rm -rf "$LOCK_DIR"
    done
    echo "failed to acquire $LOCK_DIR" >&2
    return 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rebuild|--force-build)
            FORCE_BUILD=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            die "unknown option: $1"
            ;;
    esac
    shift
done

if [[ -f "$PID_FILE" ]]; then
    existing_pid="$(tr -d '[:space:]' < "$PID_FILE")"
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && is_our_process "$existing_pid"; then
        echo "qq-farm-bot is already running with PID $existing_pid."
        start_watchdog_if_needed
        exit 0
    fi
    rm -f -- "$PID_FILE"
fi

command -v node >/dev/null 2>&1 || die "node is required."

acquire_start_lock || exit 1

dependency_inputs=(
    "$SCRIPT_DIR/package.json"
    "$SCRIPT_DIR/pnpm-lock.yaml"
    "$SCRIPT_DIR/pnpm-workspace.yaml"
    "$SCRIPT_DIR/core/package.json"
    "$SCRIPT_DIR/web/package.json"
)

if [[ ! -d "$SCRIPT_DIR/core/node_modules" \
    || ! -d "$SCRIPT_DIR/web/node_modules" \
    || ! -f "$INSTALL_STAMP" ]] \
    || has_newer_input "$INSTALL_STAMP" "${dependency_inputs[@]}"; then
    echo "Installing workspace dependencies..."
    run_pnpm install --frozen-lockfile
    touch "$INSTALL_STAMP"
fi

web_inputs=(
    "$SCRIPT_DIR/web/src"
    "$SCRIPT_DIR/web/public"
    "$SCRIPT_DIR/web/index.html"
    "$SCRIPT_DIR/web/package.json"
    "$SCRIPT_DIR/web/tsconfig.json"
    "$SCRIPT_DIR/web/tsconfig.app.json"
    "$SCRIPT_DIR/web/tsconfig.node.json"
    "$SCRIPT_DIR/web/uno.config.ts"
    "$SCRIPT_DIR/web/vite.config.ts"
    "$SCRIPT_DIR/core/package.json"
    "$SCRIPT_DIR/package.json"
    "$SCRIPT_DIR/pnpm-lock.yaml"
    "$SCRIPT_DIR/pnpm-workspace.yaml"
)

core_inputs=(
    "$SCRIPT_DIR/core/src"
    "$SCRIPT_DIR/core/client.ts"
    "$SCRIPT_DIR/core/package.json"
    "$SCRIPT_DIR/core/tsconfig.json"
    "$SCRIPT_DIR/core/tsconfig.client.json"
    "$SCRIPT_DIR/package.json"
    "$SCRIPT_DIR/pnpm-lock.yaml"
    "$SCRIPT_DIR/pnpm-workspace.yaml"
)

build_web=0
build_core=0

if [[ "$FORCE_BUILD" -eq 1 ]] || has_newer_input "$WEB_OUTPUT" "${web_inputs[@]}"; then
    build_web=1
fi
if [[ "$FORCE_BUILD" -eq 1 \
    || ! -f "$CORE_RUNTIME_OUTPUT" ]] \
    || has_newer_input "$CORE_OUTPUT" "${core_inputs[@]}"; then
    build_core=1
fi

if [[ "$build_web" -eq 1 ]]; then
    echo "Building Web..."
    run_pnpm -C "$SCRIPT_DIR/web" run build
else
    echo "Web build is up to date; skipping."
fi

if [[ "$build_core" -eq 1 ]]; then
    echo "Building Core..."
    run_pnpm -C "$SCRIPT_DIR/core" run build:ts
else
    echo "Core build is up to date; skipping."
fi

if [[ ! -f "$CORE_OUTPUT" ]]; then
    die "Build completed but core/client.js was not generated."
fi

# 保留上一轮日志：自动重启后仍能查崩溃/断线现场，而不是被新日志直接盖掉
if [[ -s "$LOG_FILE" ]]; then
    mv -f "$LOG_FILE" "${LOG_FILE}.prev"
fi
: > "$LOG_FILE"
# 显式放行前台终端守卫：标准启动虽经 nohup setsid 脱离终端（stdin 非 TTY），
# 这里再带一次标记，确保某些 setsid/stdin 行为异常的宿主环境也不会误伤正规实例。
if command -v setsid >/dev/null 2>&1; then
    nohup setsid env QQ_FARM_ALLOW_TTY=1 node "$SCRIPT_DIR/core/client.js" >> "$LOG_FILE" 2>&1 &
else
    nohup env QQ_FARM_ALLOW_TTY=1 node "$SCRIPT_DIR/core/client.js" >> "$LOG_FILE" 2>&1 &
fi

app_pid="$!"
printf '%s\n' "$app_pid" > "$PID_FILE"

sleep 1
if ! is_our_process "$app_pid"; then
    echo "qq-farm-bot failed to start. Last log output:" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    rm -f -- "$PID_FILE"
    exit 1
fi

echo "Started qq-farm-bot with PID $app_pid."
echo "Logs: $LOG_FILE"

# 端口转发默认关闭：公网入口请用 Cloudflare Tunnel / Nginx / Caddy 直接回源到主端口。
# 确实需要固定外部端口时显式传入，例如：EDGE_PORT=8080 ./start.sh
app_port="$(grep -E '^PORT=' "$SCRIPT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r')"
app_port="${app_port:-3007}"
edge_port="${EDGE_PORT:-}"
if [[ -n "$edge_port" && "$edge_port" != "$app_port" ]] && command -v socat >/dev/null 2>&1; then
    pkill -f "^socat TCP-LISTEN:${edge_port}" 2>/dev/null || true
    setsid socat "TCP-LISTEN:${edge_port},fork,reuseaddr,backlog=128" "TCP:127.0.0.1:${app_port}" \
        >/dev/null 2>&1 &
    echo "Edge forward: ${edge_port} -> ${app_port}"
fi

start_watchdog_if_needed
