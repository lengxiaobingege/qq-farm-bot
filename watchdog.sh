#!/usr/bin/env bash
# 看门狗：主进程掉线 / 端口失联时自动拉起，连续失败 3 次停手并推送告警。
#
# 设计取向：宁可不动，也不重复启动。
#   - pid 文件指向的进程必须 cwd 与命令行都对得上，才认为是我们的主进程
#   - 主进程不在但 3007 被本项目进程占着（pid 文件丢了）→ 只补写 pid，不重启
#   - 3007 被别人家的进程占着 → 一律不动，只记录，避免双实例重复购买
#   - 只有 3007 真空闲才调 start.sh；连续失败 3 次推一条告警后停手
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

APP_PID_FILE="$SCRIPT_DIR/app_dev.pid"
WD_PID_FILE="$SCRIPT_DIR/watchdog.pid"
WD_LOG="$SCRIPT_DIR/watchdog.log"
WD_BEAT="$SCRIPT_DIR/watchdog.beat"

INTERVAL="${WATCHDOG_INTERVAL:-60}"
MAX_FAILS=3
HEALTH_FAIL_LIMIT=3
APP_PORT="$(grep -E '^PORT=' "$SCRIPT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r')"
APP_PORT="${APP_PORT:-3007}"

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$WD_LOG"
}

# 与 start.sh 同一套判定：进程存在、工作目录是项目根、命令行为本项目入口。
is_our_process() {
    local pid="${1:-}"
    local process_dir=""
    local command_line=""

    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
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

is_watchdog_process() {
    local pid="${1:-}"
    local command_line=""

    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ "$command_line" == *"watchdog.sh"* && "$command_line" == *"run"* ]]
}

read_app_pid() {
    [[ -f "$APP_PID_FILE" ]] || return 1
    tr -d '[:space:]' < "$APP_PID_FILE"
}

read_wd_pid() {
    [[ -f "$WD_PID_FILE" ]] || return 0
    tr -d '[:space:]' < "$WD_PID_FILE" 2>/dev/null || true
}

# pid 文件丢失时兜底：只清理工作目录是本项目的看门狗循环，不碰别的项目。
kill_stray_watchdogs() {
    local pid cwd
    for pid in $(pgrep -f "watchdog.sh run" 2>/dev/null || true); do
        [[ "$pid" == "$$" ]] && continue
        is_watchdog_process "$pid" || continue
        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
        [[ "$cwd" == "$SCRIPT_DIR" ]] || continue
        kill -TERM "$pid" 2>/dev/null || true
    done
}

# 取监听指定端口的进程 pid（取不到返回空）
port_pid() {
    ss -ltnp 2>/dev/null | awk -v pat=":$1\$" '$4 ~ pat {print; exit}' \
        | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

http_ok() {
    curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$1/" >/dev/null 2>&1
}

front_hash() {
    local body
    body="$(curl -fsS --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null)" || return 1
    printf '%s' "$body" | md5sum | cut -d' ' -f1
}

# 3000 有响应不代表它转到了主端口：手工起的 PORT=3000 实例会把 3000 占住，
# 外部访问到的是另一个进程。内容指纹不同就提示一次，不自动动手。
check_forward_target() {
    local h_edge h_main
    h_edge="$(front_hash 3000 2>/dev/null || true)"
    h_main="$(front_hash "$APP_PORT" 2>/dev/null || true)"
    if [[ -n "$h_edge" && -n "$h_main" && "$h_edge" != "$h_main" ]]; then
        if [[ "$last_forward_warn" != "mismatch" ]]; then
            log "警告：3000 返回内容与 ${APP_PORT} 不一致，3000 可能被其它实例占用"
            last_forward_warn="mismatch"
        fi
    else
        last_forward_warn=""
    fi
}

ensure_forwarder() {
    [[ "$APP_PORT" == "3000" ]] && return 0
    command -v socat >/dev/null 2>&1 || return 0
    if http_ok 3000; then
        check_forward_target
        return 0
    fi
    log "3000 转发不可用，重建转发器（3000 -> ${APP_PORT}）"
    pkill -f '^socat TCP-LISTEN:3000' 2>/dev/null || true
    sleep 1
    setsid socat "TCP-LISTEN:3000,fork,reuseaddr,backlog=128" "TCP:127.0.0.1:${APP_PORT}" \
        >/dev/null 2>&1 &
    sleep 1
    http_ok 3000 && log "转发器重建成功" || log "转发器重建后仍不可用"
}

kill_app() {
    local pid
    pid="$(read_app_pid 2>/dev/null || true)"
    if is_our_process "$pid"; then
        local pgid
        pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
        if [[ "$pgid" == "$pid" ]]; then
            kill -TERM -- "-$pid" 2>/dev/null || true
        else
            kill -TERM "$pid" 2>/dev/null || true
        fi
        local i
        for i in {1..20}; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.5
        done
        if kill -0 "$pid" 2>/dev/null; then
            log "进程 ${pid} 未响应 TERM，强制结束"
            if [[ "$pgid" == "$pid" ]]; then
                kill -KILL -- "-$pid" 2>/dev/null || true
            else
                kill -KILL "$pid" 2>/dev/null || true
            fi
        fi
    fi
    rm -f -- "$APP_PID_FILE"
    pkill -f '^socat TCP-LISTEN:3000' 2>/dev/null || true
}

# 拉起主服务；start.sh 自己会做构建检查与 3000 转发
start_app() {
    QQ_FARM_NO_WATCHDOG=1 timeout 600 bash "$SCRIPT_DIR/start.sh" >> "$WD_LOG" 2>&1
}

# 启动后确认：进程还是我们的，且主端口能出 HTTP
verify_app() {
    local pid="$1"
    is_our_process "$pid" || return 1
    local i
    for i in {1..15}; do
        http_ok "$APP_PORT" && return 0
        sleep 1
    done
    return 1
}

notify_failure() {
    local reason="$1"
    log "发送失败告警：${reason}"
    timeout 45 node - "$reason" <<'NODE' >> "$WD_LOG" 2>&1 || true
const path = require('path');
const base = process.cwd();
let store, push, notify;
try {
  store = require(path.join(base, 'core/dist/models/store'));
  push = require(path.join(base, 'core/dist/services/push'));
  notify = require(path.join(base, 'core/dist/runtime/event-notify'));
} catch (e) {
  console.error('加载推送模块失败: ' + e.message);
  process.exit(1);
}
const reason = String(process.argv[2] || 'unknown');
const svc = notify.createEventNotifyService({
  store,
  sendPushooMessage: push.sendPushooMessage,
  log: () => {},
});
const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
svc.sendConfiguredPush({
  title: '农场助手：自动重启失败',
  content: [
    '自动重启连续失败 3 次，看门狗已停止自动拉起。',
    '时间：' + now,
    '原因：' + reason,
    '请手动运行 bash start.sh，并查看 watchdog.log。',
  ].join('\n'),
  logLabel: '守护告警',
}).then(() => process.exit(0)).catch(() => process.exit(1));
NODE
}

rotate_log() {
    local size
    size="$(stat -c %s "$WD_LOG" 2>/dev/null || echo 0)"
    if (( size > 1048576 )); then
        tail -n 2000 "$WD_LOG" > "$WD_LOG.tmp" 2>/dev/null && mv "$WD_LOG.tmp" "$WD_LOG"
    fi
}

run_loop() {
    # 单实例：不用 flock。bash 打开锁 fd 后，start.sh / socat / sleep 都会继承它，
    # 主循环退出后锁仍被子进程持有，反而让看门狗再也起不来。
    local running_pid
    running_pid="$(read_wd_pid)"
    if [[ "$running_pid" != "$$" ]] && is_watchdog_process "$running_pid"; then
        echo "watchdog is already running."
        exit 0
    fi

    printf '%s\n' "$$" > "$WD_PID_FILE"
    trap 'rm -f "$WD_PID_FILE"; log "看门狗退出"; exit 0' TERM INT
    log "看门狗启动，间隔 ${INTERVAL}s，主端口 ${APP_PORT}，日志上限 1MB"

    local fails=0 health_fails=0 last_state="" last_heartbeat=0
    local now state pid listener

    while true; do
        state=""
        pid="$(read_app_pid 2>/dev/null || true)"

        if is_our_process "$pid"; then
            if http_ok "$APP_PORT"; then
                health_fails=0
                state="running(${pid})"
                ensure_forwarder
            else
                health_fails=$((health_fails + 1))
                state="unhealthy(${pid},${health_fails})"
                if (( health_fails >= HEALTH_FAIL_LIMIT )); then
                    log "进程 ${pid} 连续 ${health_fails} 次健康检查失败，重启"
                    kill_app
                    if start_app; then
                        if verify_app "$(read_app_pid 2>/dev/null || true)"; then
                            fails=0
                            health_fails=0
                            state="restarted($(read_app_pid 2>/dev/null || true))"
                            log "重启成功，pid $(read_app_pid 2>/dev/null || true)"
                        else
                            fails=$((fails + 1))
                            state="restart-unhealthy(${fails})"
                            log "重启后健康检查未通过（第 ${fails}/${MAX_FAILS} 次）"
                        fi
                    else
                        fails=$((fails + 1))
                        state="restart-failed(${fails})"
                        log "重启失败（第 ${fails}/${MAX_FAILS} 次）"
                    fi
                fi
            fi
        else
            listener="$(port_pid "$APP_PORT")"
            if [[ -n "$listener" ]] && is_our_process "$listener"; then
                # pid 文件丢了但进程还在：补写，不重启
                printf '%s\n' "$listener" > "$APP_PID_FILE"
                state="adopted(${listener})"
                log "发现本项目遗留进程 ${listener}，已补写 pid 文件"
            elif [[ -n "$listener" ]]; then
                # 端口被别的进程占着：绝不抢占，避免双实例
                state="foreign(${listener})"
            else
                if [[ -n "$(port_pid 3000)" ]]; then
                    pkill -f '^socat TCP-LISTEN:3000' 2>/dev/null || true
                fi
                log "主进程不在，尝试拉起"
                if start_app; then
                    if verify_app "$(read_app_pid 2>/dev/null || true)"; then
                        fails=0
                        state="started($(read_app_pid 2>/dev/null || true))"
                        log "拉起成功，pid $(read_app_pid 2>/dev/null || true)"
                    else
                        fails=$((fails + 1))
                        state="start-unhealthy(${fails})"
                        log "拉起后健康检查未通过（第 ${fails}/${MAX_FAILS} 次）"
                    fi
                else
                    fails=$((fails + 1))
                    state="start-failed(${fails})"
                    log "拉起失败（第 ${fails}/${MAX_FAILS} 次）"
                fi
            fi
        fi

        if (( fails >= MAX_FAILS )); then
            log "连续失败 ${fails} 次，停止自动拉起，等待人工处理"
            notify_failure "主进程连续 ${fails} 次拉起或健康检查失败"
            exit 1
        fi

        if [[ "$state" != "$last_state" ]]; then
            log "状态：${state}"
            last_state="$state"
        fi

        now="$(date +%s)"
        if (( now - last_heartbeat >= 3600 )); then
            log "心跳：${state}"
            last_heartbeat="$now"
        fi

        rotate_log
        printf '%s\n' "$(date +%s)" > "$WD_BEAT" 2>/dev/null || true
        sleep "$INTERVAL"
    done
}

start_daemon() {
    local pid
    pid="$(read_wd_pid)"
    if is_watchdog_process "$pid"; then
        echo "watchdog is already running with PID $pid."
        return 0
    fi
    rm -f -- "$WD_PID_FILE"
    kill_stray_watchdogs
    sleep 1

    setsid nohup bash "$SCRIPT_DIR/watchdog.sh" run </dev/null >> "$WD_LOG" 2>&1 &
    sleep 1
    pid="$(read_wd_pid)"
    if is_watchdog_process "$pid"; then
        echo "watchdog started with PID $pid."
        echo "Logs: $WD_LOG"
        return 0
    fi
    echo "watchdog failed to start; see $WD_LOG" >&2
    return 1
}

stop_daemon() {
    local pid
    pid="$(read_wd_pid)"
    if is_watchdog_process "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
        local i
        for i in {1..20}; do
            is_watchdog_process "$pid" || break
            sleep 0.3
        done
        if is_watchdog_process "$pid"; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
        rm -f -- "$WD_PID_FILE"
        echo "watchdog stopped."
        return 0
    fi
    rm -f -- "$WD_PID_FILE"
    kill_stray_watchdogs
    echo "watchdog is not running."
}

status_daemon() {
    local pid beat age
    pid="$(read_wd_pid)"
    if is_watchdog_process "$pid"; then
        echo "watchdog is running with PID $pid."
        beat="$(tr -d '[:space:]' < "$WD_BEAT" 2>/dev/null || true)"
        if [[ "$beat" =~ ^[0-9]+$ ]]; then
            age=$(( $(date +%s) - beat ))
            echo "last check: ${age}s ago"
        else
            echo "last check: (尚未完成首轮)"
        fi
        echo "--- recent log ---"
        tail -n 8 "$WD_LOG" 2>/dev/null || true
        return 0
    fi
    echo "watchdog is not running."
    return 1
}

case "${1:-run}" in
    start) start_daemon ;;
    stop) stop_daemon ;;
    restart) stop_daemon; start_daemon ;;
    status) status_daemon ;;
    run) run_loop ;;
    *)
        echo "Usage: bash watchdog.sh [start|stop|restart|status|run]" >&2
        exit 2
        ;;
esac
