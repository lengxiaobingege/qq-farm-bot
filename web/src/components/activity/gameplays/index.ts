import type { ActivityGameplayModule, ResolvedActivityGameplay } from './types'
import type { ActivityDirectoryItemDto, ActivityGameplayKey } from '@/stores/activity-center'
import { petGameplay } from './pet'
import { stellarGameplay } from './stellar'

const gameplayModules: Record<ActivityGameplayKey, ActivityGameplayModule> = {
  pet: petGameplay,
  milk: { key: 'milk', defaultTab: 'milk', tabs: ['milk'] },
  happy: { key: 'happy', defaultTab: 'happy', tabs: ['happy'] },
  stellar: stellarGameplay,
}

function inferGameplayKey(activity: ActivityDirectoryItemDto): ActivityGameplayKey | null {
  if (activity.detailTarget === 'happy')
    return activity.detailTarget
  if (activity.gameplayKey)
    return activity.gameplayKey
  if (activity.detailTarget === 'pet' || activity.activityIds.some(id => ['2026090100', '2026090101', '2026090102', '2026090103'].includes(id)))
    return 'pet'
  if (activity.detailTarget)
    return 'stellar'

  const activityIds = new Set(activity.activityIds.map(id => id.trim()))
  if (['2026072700', '2026072701'].some(id => activityIds.has(id)))
    return 'stellar'

  const name = activity.name.trim()
  if (/千星|星砂|星宿|节令/.test(name))
    return 'stellar'
  return null
}

export function resolveActivityGameplay(activity: ActivityDirectoryItemDto): ResolvedActivityGameplay | null {
  const gameplayKey = inferGameplayKey(activity)
  if (!gameplayKey)
    return null
  const module = gameplayModules[gameplayKey]
  if (!module)
    return null
  const entryTab = activity.detailTarget && module.tabs.includes(activity.detailTarget)
    ? activity.detailTarget
    : activity.gameplayTargets.find(tab => module.tabs.includes(tab)) || module.defaultTab
  return { module, entryTab, activity }
}

export function activityHasGameplay(activity: ActivityDirectoryItemDto) {
  return resolveActivityGameplay(activity) !== null
}
