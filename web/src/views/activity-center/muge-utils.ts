import type { MugeTier } from '@/stores/muge'

/** 档位/任务的状态色调，供各玩法卡片共用。 */
export type Tone = 'done' | 'ready' | 'idle' | 'locked'

/** 档位门槛动辄上亿，按万/亿缩写；当前数值仍显示完整数字。 */
export function compact(value: number) {
  const trim = (n: number) => String(Number(n.toFixed(1)))
  if (value >= 1e8)
    return `${trim(value / 1e8)} 亿`
  if (value >= 1e4)
    return `${trim(value / 1e4)} 万`
  return value.toLocaleString('zh-CN')
}

export function tierTone(status: number): { tone: Tone, text: string } {
  return status === 3 ? { tone: 'done', text: '已领取' } : status === 2 ? { tone: 'ready', text: '可领取' } : { tone: 'idle', text: '未达成' }
}

export function taskTone(task: { status: number, progress: number, target: number }): { tone: Tone, text: string } {
  if (task.status === 3)
    return { tone: 'done', text: '已领取' }
  if (task.status === 2)
    return { tone: 'ready', text: '可领取' }
  if (task.status === 4)
    return { tone: 'locked', text: '未解锁' }
  return { tone: 'idle', text: `${task.progress} / ${task.target}` }
}

export function claimable(tiers: MugeTier[] = []) {
  return tiers.filter(tier => tier.status === 2).length
}

/** 计算下档进度：已达标取 100%，否则按相邻两档门槛线性插值。 */
export function progressTo(value: number, tiers: MugeTier[], unit: string) {
  const next = tiers.find(tier => tier.status === 1 && tier.threshold > value)
  if (!next)
    return { percent: 100, text: '全部档位已达成' }
  const previous = [...tiers].reverse().find(tier => tier.threshold <= value)?.threshold || 0
  const span = next.threshold - previous
  return {
    percent: span > 0 ? Math.min(100, Math.max(0, (value - previous) / span * 100)) : 0,
    text: `距 ${compact(next.threshold)}${unit} 还差 ${compact(next.threshold - value)}`,
  }
}
