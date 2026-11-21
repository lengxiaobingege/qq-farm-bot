/**
 * 判断连接断开原因是否来自宿主机休眠 / 唤醒。
 *
 * 宿主机休眠时网络会被系统挂起，唤醒后应立即重连，
 * 无需套用普通的重试退避延迟。
 */
const HOST_SLEEP_PATTERNS: RegExp[] = [
  /host[_\s-]?sleep/i,
  /system[_\s-]?(suspend|sleep|resume|wake)/i,
  /(^|[_\s-])(sleep|suspend|resume|wake)([_\s-]|$)/i,
];

export function isHostSleepReason(reason: unknown): boolean {
  if (typeof reason !== 'string' || reason.length === 0)
    return false;
  return HOST_SLEEP_PATTERNS.some(pattern => pattern.test(reason));
}
