#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PID_FILE="$SCRIPT_DIR/app_dev.pid"
LOCK_DIR="$SCRIPT_DIR/.start.lock"

cd "$SCRIPT_DIR"

# start.sh 在设置 EDGE_PORT 时会起 socat 做转发，它已 setsid 脱离进程组，
# 只 kill node 的进程组清不掉。这里统一收尾，避免停服后转发端口仍被占着。
stop_forwarder() {
    pkill -f '^socat TCP-LISTEN:' 2>/dev/null || true
}

# 不在 pid 文件里的实例（例如手工 node core/client.js）也要停掉，否则 stop.sh
# 报“已停止”但端口仍被占着，watchdog 还会把它当外部进程跳过。
stop_stray_instances() {
    local proc_dir pid cwd argv0 argv1
    for proc_dir in /proc/[0-9]*; do
        pid="${proc_dir#/proc/}"
        [[ "$pid" == "$$" ]] && continue
        kill -0 "$pid" 2>/dev/null || continue
        # 取 NUL 分隔的 argv[0]/argv[1] 精确判断，不能用整条命令行的子串：
        # 否则任何命令行里带 “core/client.js” 的 shell/脚本都会被误杀。
        argv0=""
        argv1=""
        {
            IFS= read -r -d '' argv0
            IFS= read -r -d '' argv1
        } < "$proc_dir/cmdline" 2>/dev/null || continue
        [[ "${argv0##*/}" == "node" ]] || continue
        [[ "$argv1" == *"core/client.js"* || "$argv1" == *"core/dist/"* ]] || continue
        cwd="$(readlink -f "$proc_dir/cwd" 2>/dev/null || true)"
        [[ "$cwd" == "$SCRIPT_DIR" ]] || continue
        echo "Stopping stray instance PID $pid."
        kill -TERM "$pid" 2>/dev/null || true
        for _ in {1..20}; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.3
        done
        kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
    done
}

cleanup_runtime() {
    stop_stray_instances
    stop_forwarder
}

# 停掉看门狗那一刻，它可能正卡在 start.sh 里。那个 start.sh 是独立子进程，
# 会继续把服务拉起来，等它结束后再清一遍，否则会出现“stop 完服务又活了”。
wait_start_lock() {
    local i holder
    [[ -d "$LOCK_DIR" ]] || return 0
    echo "Waiting for in-flight start.sh to finish..."
    for i in {1..120}; do
        [[ -d "$LOCK_DIR" ]] || return 0
        sleep 0.5
    done
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
        echo "start.sh (PID $holder) still running after 60s; terminating it." >&2
        kill -TERM "$holder" 2>/dev/null || true
        sleep 1
    fi
    rm -rf -- "$LOCK_DIR"
}

# 必须先停看门狗：否则它会在主进程退出后把服务重新拉起来。
if [[ -f "$SCRIPT_DIR/watchdog.sh" ]]; then
    bash "$SCRIPT_DIR/watchdog.sh" stop || true
fi

wait_start_lock

if [[ ! -f "$PID_FILE" ]]; then
    cleanup_runtime
    echo "qq-farm-bot is not running."
    exit 0
fi

app_pid="$(tr -d '[:space:]' < "$PID_FILE")"
if [[ ! "$app_pid" =~ ^[0-9]+$ ]]; then
    echo "Invalid PID file; removing it." >&2
    rm -f -- "$PID_FILE"
    cleanup_runtime
    exit 1
fi

if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "qq-farm-bot is not running; removing stale PID file."
    rm -f -- "$PID_FILE"
    cleanup_runtime
    exit 0
fi

process_dir=""
if [[ -e "/proc/$app_pid/cwd" ]]; then
    process_dir="$(readlink -f "/proc/$app_pid/cwd" 2>/dev/null || true)"
    if [[ -n "$process_dir" && "$process_dir" != "$SCRIPT_DIR" ]]; then
        echo "Refusing to stop PID $app_pid: working directory is $process_dir." >&2
        exit 1
    fi
fi

command_line=""
if [[ -r "/proc/$app_pid/cmdline" ]]; then
    command_line="$(tr '\0' ' ' < "/proc/$app_pid/cmdline" 2>/dev/null || true)"
fi
if [[ "$command_line" != *"core/client.js"* && "$command_line" != *"core/dist"* ]]; then
    echo "Refusing to stop PID $app_pid: it is not a qq-farm-bot process." >&2
    exit 1
fi

process_group="$(ps -o pgid= -p "$app_pid" 2>/dev/null | tr -d '[:space:]' || true)"
if [[ "$process_group" == "$app_pid" ]]; then
    kill -TERM -- "-$app_pid" 2>/dev/null || true
else
    kill -TERM "$app_pid" 2>/dev/null || true
fi

for _ in {1..30}; do
    if ! kill -0 "$app_pid" 2>/dev/null; then
        rm -f -- "$PID_FILE"
        cleanup_runtime
        echo "Stopped qq-farm-bot."
        exit 0
    fi
    sleep 0.5
done

echo "Graceful shutdown timed out; forcing qq-farm-bot to stop." >&2
if [[ "$process_group" == "$app_pid" ]]; then
    kill -KILL -- "-$app_pid" 2>/dev/null || true
else
    kill -KILL "$app_pid" 2>/dev/null || true
fi

rm -f -- "$PID_FILE"
cleanup_runtime
echo "Stopped qq-farm-bot."
