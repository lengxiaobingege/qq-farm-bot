import type { Ref } from 'vue'
import type { SettingsState } from '@/stores/setting'
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import {
  fertilizerLandTypeOptions,
  isAccountConnected,
} from '@/components/settings/settings-local-state'
import { useStatusStore } from '@/stores/status'

/**
 * 策略表单逻辑（种植策略 / 背包种子优先级 / 巡查间隔 / 静默时段 / 延迟）。
 * 从原 StrategyTab 抽出，供「自动化设置」统一表单复用。
 * model 由外部以 Ref 传入，保存与加载由外层容器统一负责。
 */
export type StrategyFormModel = Pick<
  SettingsState,
  | 'plantingStrategy'
  | 'preferredSeedId'
  | 'bagSeedPriority'
  | 'bagSeedMultiLandReservationEnabled'
  | 'bagSeedLandTypes'
  | 'bagSeedFallbackStrategy'
  | 'stealDelaySeconds'
  | 'plantOrderRandom'
  | 'plantDelaySeconds'
  | 'intervals'
  | 'friendQuietHours'
>

export interface UseStrategyFormOptions {
  model: Ref<StrategyFormModel>
  currentAccountId: Ref<string>
}

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

export function useStrategyForm({ model, currentAccountId }: UseStrategyFormOptions) {
  interface SeedOptionItem {
    seedId: number
    name: string
    requiredLevel: number
    price: number
    locked?: boolean
    soldOut?: boolean
  }

  const seedOptions = ref<SeedOptionItem[]>([])
  const seedOptionsRevision = ref(0)
  let seedOptionsRequestRevision = 0
  let seedOptionsLoadedAccountId = ''
  let bagSeedsRequestRevision = 0
  let bagSeedsLoadedAccountId = ''
  let bagSortRequestRevision = 0
  let previewRequestRevision = 0

  // 游戏本地配置的种子名称（seedId -> name），与后端 getBagSeeds 名称同源。
  const plantNameBySeedId = ref(new Map<number, string>())
  let plantConfigLoaded = false

  async function ensurePlantConfigLoaded() {
    if (plantConfigLoaded)
      return
    plantConfigLoaded = true
    try {
      const res = await api.get('/game-config/Plant.json', { skipErrorToast: true } as any)
      const plants = Array.isArray(res?.data) ? res.data : []
      plantNameBySeedId.value = new Map(
        plants
          .map((plant: any): [number, string] => [Number(plant?.seed_id) || 0, String(plant?.name || '').trim()])
          .filter(([seedId, name]) => seedId > 0 && !!name),
      )
    }
    catch {
      // 静态配置加载失败时保持按种子 ID 显示
    }
  }

  const plantingStrategyOptions = [
    { label: '优先种植种子', value: 'preferred' },
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
    { label: '背包种子优先', value: 'bag_priority' },
  ]

  const BAG_FALLBACK_STRATEGY_OPTIONS = [
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
    { label: '优先种植种子', value: 'preferred' },
  ]

  interface BagSeedItem {
    seedId: number
    name: string
    count: number
    requiredLevel: number
    plantSize: number
    image?: string
  }

  const bagSeeds = ref<BagSeedItem[]>([])
  const bagSeedsLoading = ref(false)
  const bagSeedsError = ref<string | null>(null)
  const draggingBagSeedId = ref<number | null>(null)

  const visibleBagSeedIds = computed(() => bagSeeds.value.map(seed => seed.seedId))

  function normalizeVisibleBagSeedOrder(priority: number[] = model.value.bagSeedPriority) {
    const visibleIds = visibleBagSeedIds.value
    const visibleSet = new Set(visibleIds)
    const normalized: number[] = []
    for (const seedId of priority || []) {
      const id = Number(seedId)
      if (visibleSet.has(id) && !normalized.includes(id))
        normalized.push(id)
    }
    for (const seedId of visibleIds) {
      if (!normalized.includes(seedId))
        normalized.push(seedId)
    }
    return normalized
  }

  function mergeVisibleBagSeedOrder(visibleOrder: number[]) {
    const visibleIds = visibleBagSeedIds.value
    const visibleSet = new Set(visibleIds)
    const normalizedVisible = normalizeVisibleBagSeedOrder(visibleOrder)
    const existing = [...new Set((model.value.bagSeedPriority || [])
      .map(Number)
      .filter(id => Number.isFinite(id) && id > 0))]
    const merged: number[] = []
    let visibleIndex = 0

    for (const seedId of existing) {
      if (visibleSet.has(seedId)) {
        const replacement = normalizedVisible[visibleIndex++]
        if (replacement !== undefined && !merged.includes(replacement))
          merged.push(replacement)
      }
      else if (!merged.includes(seedId)) {
        // 暂时缺货的种子保留原有优先级位置，重新入库后仍按原顺序执行。
        merged.push(seedId)
      }
    }
    while (visibleIndex < normalizedVisible.length) {
      const seedId = normalizedVisible[visibleIndex++]!
      if (!merged.includes(seedId))
        merged.push(seedId)
    }
    return merged
  }

  const sortedBagSeeds = computed(() => {
    const itemMap = new Map(bagSeeds.value.map(seed => [seed.seedId, seed]))
    return normalizeVisibleBagSeedOrder()
      .map(seedId => itemMap.get(seedId))
      .filter((seed): seed is BagSeedItem => !!seed)
  })

  function setBagSeedLandTypes(seedId: number, types: string[]) {
    const next = { ...model.value.bagSeedLandTypes }
    // 按固定顺序收敛；不勾或勾满都等价于不限制，直接去掉该 seedId。
    const normalized = fertilizerLandTypeOptions
      .map(option => option.value)
      .filter(value => types.includes(value))
    if (normalized.length === 0 || normalized.length === fertilizerLandTypeOptions.length)
      delete next[String(seedId)]
    else
      next[String(seedId)] = normalized
    model.value.bagSeedLandTypes = next
  }

  const orphanRestrictedSeeds = computed(() => {
    if (bagSeeds.value.length === 0)
      return []
    const visible = new Set(visibleBagSeedIds.value)
    return Object.entries(model.value.bagSeedLandTypes)
      .map(([seedId, types]) => ({ seedId: Number(seedId), types: types || [] }))
      .filter(item => item.seedId > 0 && item.types.length > 0 && !visible.has(item.seedId))
      .sort((a, b) => a.seedId - b.seedId)
      .map((item) => {
        const labels = fertilizerLandTypeOptions
          .filter(option => item.types.includes(option.value))
          .map(option => option.label)
        return {
          seedId: item.seedId,
          name: plantNameBySeedId.value.get(item.seedId) || `种子 #${item.seedId}`,
          scope: `仅种 ${labels.join('、')}`,
        }
      })
  })

  async function fetchSeedOptions(accountId: string) {
    if (
      !accountId
      || !isAccountConnected(accountId)
      || seedOptionsRequestRevision || seedOptionsLoadedAccountId === accountId
    ) {
      return
    }
    const requestRevision = ++seedOptionsRequestRevision
    try {
      const { data } = await api.get('/api/seeds', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (requestRevision !== seedOptionsRequestRevision || accountId !== currentAccountId.value)
        return
      seedOptions.value = data?.ok ? (data.data || []) : []
      seedOptionsRevision.value++
      if (accountId === currentAccountId.value)
        seedOptionsLoadedAccountId = accountId
    }
    catch {
      if (requestRevision === seedOptionsRequestRevision && accountId === currentAccountId.value) {
        seedOptions.value = []
        seedOptionsRevision.value++
        seedOptionsLoadedAccountId = accountId
      }
    }
    finally {
      if (seedOptionsRequestRevision === requestRevision)
        seedOptionsRequestRevision = 0
    }
  }

  async function fetchBagSeeds(accountId = currentAccountId.value) {
    if (
      !accountId
      || !isAccountConnected(accountId)
      || bagSeedsRequestRevision || bagSeedsLoadedAccountId === accountId
    ) {
      return
    }
    const requestRevision = ++bagSeedsRequestRevision
    bagSeedsLoading.value = true
    bagSeedsError.value = null
    ensurePlantConfigLoaded()
    try {
      const res = await api.get('/api/bag/seeds', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (requestRevision !== bagSeedsRequestRevision || accountId !== currentAccountId.value)
        return
      if (res.data.ok) {
        bagSeeds.value = (res.data.data || []).filter((seed: BagSeedItem) => seed.plantSize >= 1)
      }
      else {
        bagSeeds.value = []
        bagSeedsError.value = getApiErrorMessage(res.data, '加载失败')
        bagSeedsLoadedAccountId = accountId
      }
      if (accountId === currentAccountId.value)
        bagSeedsLoadedAccountId = accountId
    }
    catch (e: any) {
      e.message = getApiErrorMessage(e, '加载失败')
      if (requestRevision === bagSeedsRequestRevision && accountId === currentAccountId.value) {
        bagSeedsError.value = e.message || '加载失败'
        bagSeedsLoadedAccountId = accountId
      }
    }
    finally {
      if (requestRevision === bagSeedsRequestRevision && accountId === currentAccountId.value)
        bagSeedsLoading.value = false
      if (bagSeedsRequestRevision === requestRevision)
        bagSeedsRequestRevision = 0
    }
  }

  function materializeVisibleBagSeedOrder() {
    return normalizeVisibleBagSeedOrder()
  }

  function saveVisibleBagSeedOrder(visibleOrder: number[]) {
    bagSortRequestRevision++
    model.value.bagSeedPriority = mergeVisibleBagSeedOrder(visibleOrder)
  }

  function compareBagSeedsByLevel(a: BagSeedItem, b: BagSeedItem) {
    if (a.requiredLevel !== b.requiredLevel)
      return b.requiredLevel - a.requiredLevel
    return a.seedId - b.seedId
  }

  async function sortBagSeedsByFallbackStrategy(strategy: string, accountId = currentAccountId.value) {
    if (!accountId || accountId !== currentAccountId.value)
      return
    const requestRevision = ++bagSortRequestRevision
    const strategyAtRequest = strategy
    const items = [...bagSeeds.value]
    const ordered = [...items].sort(compareBagSeedsByLevel)

    if (strategyAtRequest === 'preferred') {
      const preferredSeedId = Number(model.value.preferredSeedId || 0)
      ordered.sort((a, b) => {
        const aPreferred = a.seedId === preferredSeedId ? 0 : 1
        const bPreferred = b.seedId === preferredSeedId ? 0 : 1
        return aPreferred - bPreferred || compareBagSeedsByLevel(a, b)
      })
    }
    else if (strategyAtRequest !== 'level') {
      const sortBy = analyticsSortByMap[strategyAtRequest]
      if (sortBy) {
        try {
          const { data } = await api.get('/api/analytics', {
            params: { sort: sortBy },
            headers: { 'x-account-id': accountId },
          })
          if (requestRevision !== bagSortRequestRevision || accountId !== currentAccountId.value || model.value.bagSeedFallbackStrategy !== strategyAtRequest)
            return
          const rankMap = new Map<number, number>()
          const rankings: any[] = data?.ok ? (data.data || []) : []
          rankings.forEach((item, index) => rankMap.set(Number(item.seedId), index))
          ordered.sort((a, b) => {
            const aRank = rankMap.get(a.seedId) ?? Number.MAX_SAFE_INTEGER
            const bRank = rankMap.get(b.seedId) ?? Number.MAX_SAFE_INTEGER
            return aRank - bRank || compareBagSeedsByLevel(a, b)
          })
        }
        catch {
          // 排名请求失败时保留稳定的等级/ID顺序。
        }
      }
    }

    if (requestRevision !== bagSortRequestRevision || accountId !== currentAccountId.value || model.value.bagSeedFallbackStrategy !== strategyAtRequest)
      return
    saveVisibleBagSeedOrder(ordered.map(seed => seed.seedId))
  }

  async function ensureBagSeedsForUserSort(accountId: string) {
    if (bagSeedsLoading.value || bagSeeds.value.length === 0)
      await fetchBagSeeds(accountId)
  }

  async function handleBagFallbackStrategyChange(value: string | number) {
    const accountId = currentAccountId.value
    const strategy = String(value)
    if (!accountId)
      return
    await ensureBagSeedsForUserSort(accountId)
    if (accountId === currentAccountId.value && model.value.bagSeedFallbackStrategy === strategy)
      await sortBagSeedsByFallbackStrategy(strategy, accountId)
  }

  async function handlePreferredSeedChange() {
    const accountId = currentAccountId.value
    if (!accountId || model.value.plantingStrategy !== 'bag_priority' || model.value.bagSeedFallbackStrategy !== 'preferred')
      return
    await ensureBagSeedsForUserSort(accountId)
    if (accountId === currentAccountId.value && model.value.bagSeedFallbackStrategy === 'preferred')
      await sortBagSeedsByFallbackStrategy('preferred', accountId)
  }

  async function resetBagSeedPriority() {
    const accountId = currentAccountId.value
    const strategy = model.value.bagSeedFallbackStrategy
    if (!accountId)
      return
    await ensureBagSeedsForUserSort(accountId)
    if (accountId === currentAccountId.value && model.value.bagSeedFallbackStrategy === strategy)
      await sortBagSeedsByFallbackStrategy(strategy, accountId)
  }

  function moveBagSeed(seedId: number, direction: -1 | 1) {
    const nextOrder = materializeVisibleBagSeedOrder()
    const index = nextOrder.indexOf(seedId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= nextOrder.length)
      return

    const temp = nextOrder[index]!
    nextOrder[index] = nextOrder[targetIndex]!
    nextOrder[targetIndex] = temp
    saveVisibleBagSeedOrder(nextOrder)
  }

  function moveBagSeedUp(seedId: number) {
    moveBagSeed(seedId, -1)
  }

  function moveBagSeedDown(seedId: number) {
    moveBagSeed(seedId, 1)
  }

  function startBagSeedDrag(seedId: number, event: DragEvent) {
    materializeVisibleBagSeedOrder()
    draggingBagSeedId.value = seedId
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(seedId))
    }
  }

  function endBagSeedDrag() {
    draggingBagSeedId.value = null
  }

  function dragOverBagSeed(_seedId: number, event: DragEvent) {
    if (draggingBagSeedId.value === null)
      return
    event.preventDefault()
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = 'move'
  }

  function dropBagSeed(seedId: number, event: DragEvent) {
    event.preventDefault()
    const sourceSeedId = draggingBagSeedId.value ?? Number(event.dataTransfer?.getData('text/plain') || '')
    if (!sourceSeedId || sourceSeedId === seedId) {
      endBagSeedDrag()
      return
    }

    const nextOrder = materializeVisibleBagSeedOrder()
    const sourceIndex = nextOrder.indexOf(sourceSeedId)
    const targetIndex = nextOrder.indexOf(seedId)
    if (sourceIndex < 0 || targetIndex < 0) {
      endBagSeedDrag()
      return
    }

    const [source] = nextOrder.splice(sourceIndex, 1)
    const newTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextOrder.splice(newTargetIndex, 0, source!)
    saveVisibleBagSeedOrder(nextOrder)
    endBagSeedDrag()
  }

  watch(() => [model.value.plantingStrategy, currentAccountId.value] as const, ([strategy, accountId], previous) => {
    if (
      strategy === 'bag_priority'
      && accountId
      && isAccountConnected(accountId)
      && (previous?.[0] !== strategy || previous?.[1] !== accountId)
    ) {
      fetchBagSeeds(accountId)
    }
  }, { immediate: true })

  const preferredSeedOptions = computed(() => {
    const options: { label: string, value: number, disabled?: boolean }[] = [{ label: '自动选择', value: 0, disabled: false }]
    options.push(...seedOptions.value.map(seed => ({
      label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
      value: seed.seedId,
      disabled: seed.locked || seed.soldOut,
    })))
    return options
  })

  const strategyPreviewLabel = ref<string | null>(null)

  watch(() => [
    model.value.plantingStrategy,
    model.value.bagSeedFallbackStrategy,
    model.value.preferredSeedId,
    seedOptionsRevision.value,
    currentAccountId.value,
  ] as const, async ([plantingStrategy, fallbackStrategy, preferredSeedId, , accountId]) => {
    const currentSeeds = seedOptions.value
    const requestRevision = ++previewRequestRevision
    let strategy = plantingStrategy
    if (strategy === 'preferred') {
      strategyPreviewLabel.value = null
      return
    }
    if (strategy === 'bag_priority') {
      strategy = fallbackStrategy || 'level'
      if (strategy === 'preferred') {
        const seed = preferredSeedId > 0 ? currentSeeds.find(item => item.seedId === preferredSeedId) : undefined
        strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : '未选择优先种子'
        return
      }
    }
    if (currentSeeds.length === 0) {
      strategyPreviewLabel.value = null
      return
    }
    const available = currentSeeds.filter(seed => !seed.locked && !seed.soldOut)
    if (available.length === 0) {
      strategyPreviewLabel.value = '暂无可用种子'
      return
    }
    if (strategy === 'level') {
      const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel || a.seedId - b.seedId)[0]
      strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
      return
    }
    const sortBy = analyticsSortByMap[strategy]
    if (!sortBy)
      return

    try {
      const { data } = await api.get('/api/analytics', {
        params: { sort: sortBy },
        headers: accountId ? { 'x-account-id': accountId } : undefined,
      })
      if (requestRevision !== previewRequestRevision || accountId !== currentAccountId.value)
        return
      const rankings: any[] = data?.ok ? (data.data || []) : []
      const availableIds = new Set(available.map(seed => seed.seedId))
      const match = rankings.find(item => availableIds.has(Number(item.seedId)))
      const seed = match ? available.find(item => item.seedId === Number(match.seedId)) : undefined
      strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : '暂无匹配种子'
    }
    catch {
      if (requestRevision === previewRequestRevision && accountId === currentAccountId.value)
        strategyPreviewLabel.value = null
    }
  }, { immediate: true })

  // 账号切换时清空种子相关数据，避免展示上一个账号的缓存。
  watch(currentAccountId, (accountId) => {
    seedOptions.value = []
    seedOptionsRevision.value++
    seedOptionsLoadedAccountId = ''
    seedOptionsRequestRevision = 0
    bagSeeds.value = []
    bagSeedsError.value = null
    bagSeedsLoadedAccountId = ''
    bagSeedsRequestRevision = 0
    strategyPreviewLabel.value = null
    if (accountId && isAccountConnected(accountId))
      fetchSeedOptions(accountId)
  })

  // 账号连接恢复后（例如重登），重新拉取种子与背包。
  const statusStore = useStatusStore()
  watch(() => [
    statusStore.status?.accountId,
    statusStore.status?.connection?.connected,
    currentAccountId.value,
  ] as const, ([statusAccountId, connected, accountId]) => {
    if (!connected || !accountId || String(statusAccountId || '') !== String(accountId))
      return
    fetchSeedOptions(accountId)
    if (model.value.plantingStrategy === 'bag_priority')
      fetchBagSeeds(accountId)
  })

  onMounted(() => {
    const accountId = currentAccountId.value
    if (accountId && isAccountConnected(accountId))
      fetchSeedOptions(accountId)
  })

  // 保存前规整背包种子优先级：仅 bag_priority 策略需要按可见种子收敛顺序。
  function normalizeForSave(payload: StrategyFormModel) {
    if (payload.plantingStrategy === 'bag_priority') {
      bagSortRequestRevision++
      payload.bagSeedPriority = mergeVisibleBagSeedOrder(normalizeVisibleBagSeedOrder(payload.bagSeedPriority))
    }
    return payload
  }

  return {
    plantingStrategyOptions,
    bagFallbackStrategyOptions: BAG_FALLBACK_STRATEGY_OPTIONS,
    preferredSeedOptions,
    strategyPreviewLabel,
    sortedBagSeeds,
    bagSeedsLoading,
    bagSeedsError,
    bagSeeds,
    orphanRestrictedSeeds,
    draggingBagSeedId,
    setBagSeedLandTypes,
    handleBagFallbackStrategyChange,
    handlePreferredSeedChange,
    resetBagSeedPriority,
    moveBagSeedUp,
    moveBagSeedDown,
    startBagSeedDrag,
    endBagSeedDrag,
    dragOverBagSeed,
    dropBagSeed,
    normalizeForSave,
  }
}
