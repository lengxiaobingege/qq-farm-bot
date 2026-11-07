<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NTimePicker } from 'naive-ui/es/time-picker'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BagSeedPriorityItem from '@/components/settings/BagSeedPriorityItem.vue'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import {
  fertilizerLandTypeOptions,
  isAccountConnected,
  loadAccountSettings,
  localStrategySettings,
  syncLocalStrategySettings,
} from '@/components/settings/settings-local-state'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'

const { showAlert } = useSettingsAlert()

const accountStore = useAccountStore()
const { accounts, currentAccountId } = storeToRefs(accountStore)
const { loading: settingsLoading, loadedAccountId } = storeToRefs(useSettingStore())
const { status: runtimeStatus } = storeToRefs(useStatusStore())

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

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
const strategySaving = ref(false)
let strategyLoadRevision = 0
let seedOptionsRequestRevision = 0
let bagSeedsRequestRevision = 0
let seedOptionsRequestAccountId = ''
let seedOptionsLoadedAccountId = ''
let bagSeedsRequestAccountId = ''
let bagSeedsLoadedAccountId = ''
let bagSortRequestRevision = 0
let previewRequestRevision = 0

// 游戏本地配置的种子名称（seedId -> name），与后端 getBagSeeds 的名称来源（Plant.json）同源。
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

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

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

function normalizeVisibleBagSeedOrder(priority: number[] = localStrategySettings.value.bagSeedPriority) {
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
  const existing = [...new Set((localStrategySettings.value.bagSeedPriority || [])
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
  const next = { ...localStrategySettings.value.bagSeedLandTypes }
  // 按固定顺序收敛；不勾或勾满都等价于不限制，直接去掉该 seedId。
  const normalized = fertilizerLandTypeOptions
    .map(option => option.value)
    .filter(value => types.includes(value))
  if (normalized.length === 0 || normalized.length === fertilizerLandTypeOptions.length)
    delete next[String(seedId)]
  else
    next[String(seedId)] = normalized
  localStrategySettings.value.bagSeedLandTypes = next
}

// 设置页只列背包里现有的种子，缺货种子的限制仍保留，这里显式列出以免出现看不见的规则。
const orphanRestrictedSeeds = computed(() => {
  // 背包列表未加载时无法判断谁真的缺货，此时不显示，避免误清除已有限制。
  if (bagSeeds.value.length === 0)
    return []
  const visible = new Set(visibleBagSeedIds.value)
  return Object.entries(localStrategySettings.value.bagSeedLandTypes)
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
    || seedOptionsRequestAccountId === accountId
    || seedOptionsLoadedAccountId === accountId
  ) {
    return
  }
  const requestRevision = ++seedOptionsRequestRevision
  seedOptionsRequestAccountId = accountId
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
    if (seedOptionsRequestAccountId === accountId)
      seedOptionsRequestAccountId = ''
  }
}

async function fetchBagSeeds(accountId = currentAccountId.value) {
  if (
    !accountId
    || !isAccountConnected(accountId)
    || bagSeedsRequestAccountId === accountId
    || bagSeedsLoadedAccountId === accountId
  ) {
    return
  }
  const requestRevision = ++bagSeedsRequestRevision
  bagSeedsRequestAccountId = accountId
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
    if (bagSeedsRequestAccountId === accountId)
      bagSeedsRequestAccountId = ''
  }
}

function materializeVisibleBagSeedOrder() {
  return normalizeVisibleBagSeedOrder()
}

function saveVisibleBagSeedOrder(visibleOrder: number[]) {
  bagSortRequestRevision++
  localStrategySettings.value.bagSeedPriority = mergeVisibleBagSeedOrder(visibleOrder)
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
    const preferredSeedId = Number(localStrategySettings.value.preferredSeedId || 0)
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
        if (requestRevision !== bagSortRequestRevision || accountId !== currentAccountId.value || localStrategySettings.value.bagSeedFallbackStrategy !== strategyAtRequest)
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

  if (requestRevision !== bagSortRequestRevision || accountId !== currentAccountId.value || localStrategySettings.value.bagSeedFallbackStrategy !== strategyAtRequest)
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
  if (accountId === currentAccountId.value && localStrategySettings.value.bagSeedFallbackStrategy === strategy)
    await sortBagSeedsByFallbackStrategy(strategy, accountId)
}

async function handlePreferredSeedChange() {
  const accountId = currentAccountId.value
  if (!accountId || localStrategySettings.value.plantingStrategy !== 'bag_priority' || localStrategySettings.value.bagSeedFallbackStrategy !== 'preferred')
    return
  await ensureBagSeedsForUserSort(accountId)
  if (accountId === currentAccountId.value && localStrategySettings.value.bagSeedFallbackStrategy === 'preferred')
    await sortBagSeedsByFallbackStrategy('preferred', accountId)
}

async function resetBagSeedPriority() {
  const accountId = currentAccountId.value
  const strategy = localStrategySettings.value.bagSeedFallbackStrategy
  if (!accountId)
    return
  await ensureBagSeedsForUserSort(accountId)
  if (accountId === currentAccountId.value && localStrategySettings.value.bagSeedFallbackStrategy === strategy)
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

watch(() => [localStrategySettings.value.plantingStrategy, currentAccountId.value] as const, ([strategy, accountId], previous) => {
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
  localStrategySettings.value.plantingStrategy,
  localStrategySettings.value.bagSeedFallbackStrategy,
  localStrategySettings.value.preferredSeedId,
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

async function loadStrategyData(accountId = currentAccountId.value) {
  if (!accountId)
    return
  const requestRevision = ++strategyLoadRevision
  const loaded = await loadAccountSettings(accountId)
  if (!loaded || requestRevision !== strategyLoadRevision || accountId !== currentAccountId.value)
    return
  if (isAccountConnected(accountId))
    await fetchSeedOptions(accountId)
}

async function saveStrategySettings() {
  const accountId = currentAccountId.value
  if (!accountId)
    return
  strategySaving.value = true
  try {
    const payload = JSON.parse(JSON.stringify(localStrategySettings.value))
    if (payload.plantingStrategy === 'bag_priority') {
      bagSortRequestRevision++
      payload.bagSeedPriority = mergeVisibleBagSeedOrder(normalizeVisibleBagSeedOrder(payload.bagSeedPriority))
    }
    const res = await useSettingStore().saveSettings(accountId, payload)
    if (accountId !== currentAccountId.value)
      return
    if (res.ok) {
      syncLocalStrategySettings()
      showAlert('策略设置已保存', 'primary')
    }
    else {
      const message = res.unconfirmed && res.saved
        ? `策略已保存，但运行进程尚未确认应用：${res.error || '请稍后重试或重启账号'}`
        : `保存失败: ${res.error}`
      showAlert(message, res.unconfirmed && res.saved ? 'primary' : 'danger')
    }
  }
  finally {
    if (accountId === currentAccountId.value)
      strategySaving.value = false
  }
}

watch(currentAccountId, (accountId) => {
  strategySaving.value = false
  draggingBagSeedId.value = null
  bagSeeds.value = []
  bagSeedsError.value = null
  seedOptions.value = []
  seedOptionsRequestAccountId = ''
  seedOptionsLoadedAccountId = ''
  bagSeedsRequestAccountId = ''
  bagSeedsLoadedAccountId = ''
  strategyPreviewLabel.value = null
  if (accountId)
    loadStrategyData(accountId)
})

watch(() => [
  runtimeStatus.value?.accountId,
  runtimeStatus.value?.connection?.connected,
  currentAccountId.value,
] as const, ([statusAccountId, connected, accountId]) => {
  if (!connected || !accountId || String(statusAccountId || '') !== String(accountId))
    return
  fetchSeedOptions(accountId)
  if (localStrategySettings.value.plantingStrategy === 'bag_priority')
    fetchBagSeeds(accountId)
})

onMounted(() => {
  if (currentAccountId.value)
    loadStrategyData(currentAccountId.value)
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
        <div class="i-fas-cog text-lg" />
        策略设置
        <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
    </div>

    <div v-if="settingsLoading" class="py-4 text-center text-gray-500">
      <span class="i-carbon-circle-dash mx-auto mb-2 inline-block animate-spin text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!currentAccountId || loadedAccountId !== currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings mx-auto mb-2 text-3xl text-gray-400" />
      <p>{{ currentAccountId ? '账号设置加载失败，请切换账号或刷新页面重试' : '请先选择账号' }}</p>
    </div>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseSelect
          v-model="localStrategySettings.plantingStrategy"
          label="种植策略"
          :options="plantingStrategyOptions"
        />
        <BaseSelect
          v-if="localStrategySettings.plantingStrategy === 'preferred'"
          v-model="localStrategySettings.preferredSeedId"
          label="优先种植种子"
          :options="preferredSeedOptions"
        />
        <BaseSelect
          v-else-if="localStrategySettings.plantingStrategy === 'bag_priority' && localStrategySettings.bagSeedFallbackStrategy === 'preferred'"
          v-model="localStrategySettings.preferredSeedId"
          label="优先种植种子"
          :options="preferredSeedOptions"
          @change="handlePreferredSeedChange"
        />
        <div v-else class="flex flex-col gap-1.5">
          <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
            {{ localStrategySettings.plantingStrategy === 'bag_priority' ? '第二优先策略预览' : '策略选种预览' }}
          </label>
          <div
            class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
          >
            <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
            <span class="shrink-0 text-lg text-gray-400">▼</span>
          </div>
        </div>
      </div>

      <div v-if="localStrategySettings.plantingStrategy === 'bag_priority'" class="space-y-3">
        <BaseSelect
          v-model="localStrategySettings.bagSeedFallbackStrategy"
          label="第二优先策略"
          :options="BAG_FALLBACK_STRATEGY_OPTIONS"
          @change="handleBagFallbackStrategyChange"
        />
        <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/40">
          <BaseSwitch
            v-model="localStrategySettings.bagSeedMultiLandReservationEnabled"
            label="为高优先级多格种子预留土地"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            开启后可能暂时留空部分土地，直到明确排在前面的多格种子凑齐连续布局。默认关闭。
          </p>
        </div>
        <div class="border border-amber-200 rounded-lg bg-amber-50/70 p-3 space-y-3 dark:border-amber-800/50 dark:bg-amber-900/20">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-sm text-amber-900 font-semibold dark:text-amber-200">
                背包种子优先顺序
              </div>
              <p class="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                先按下方顺序消耗背包中的 1x1 / 2x2 种子；背包种子不足时，再按“第二优先策略”补种。切换第二优先策略或重置时会据此重新排序。
              </p>
              <p class="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                配了土地限制的种子会先占用它能种的地块，再由不限制的种子使用剩余空地。
              </p>
            </div>
            <NButton
              size="tiny"
              type="warning"
              secondary
              @click="resetBagSeedPriority"
            >
              重置顺序
            </NButton>
          </div>
          <div v-if="bagSeedsLoading" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
            加载中...
          </div>
          <div v-else-if="bagSeedsError" class="py-4 text-center text-sm text-red-600 dark:text-red-400">
            {{ bagSeedsError }}
          </div>
          <div v-else-if="bagSeeds.length === 0" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
            背包中暂无 1x1 / 2x2 种子
          </div>
          <div v-else class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <BagSeedPriorityItem
              v-for="(seed, index) in sortedBagSeeds"
              :key="seed.seedId"
              :seed="seed"
              :index="index"
              :land-types="localStrategySettings.bagSeedLandTypes[String(seed.seedId)]"
              :land-type-options="fertilizerLandTypeOptions"
              :dragging="draggingBagSeedId === seed.seedId"
              :can-move-up="index > 0"
              :can-move-down="index < sortedBagSeeds.length - 1"
              @move-up="moveBagSeedUp(seed.seedId)"
              @move-down="moveBagSeedDown(seed.seedId)"
              @update:land-types="setBagSeedLandTypes(seed.seedId, $event)"
              @drag-start="startBagSeedDrag(seed.seedId, $event)"
              @drag-end="endBagSeedDrag"
              @drag-over="dragOverBagSeed(seed.seedId, $event)"
              @drop="dropBagSeed(seed.seedId, $event)"
            />
          </div>
          <div v-if="orphanRestrictedSeeds.length > 0" class="border-t border-amber-200 pt-2 dark:border-amber-800/50">
            <div class="text-xs text-amber-800 dark:text-amber-300">
              未持有但已配限制
            </div>
            <p class="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              这些种子当前不在背包中，限制已保留，重新入库后仍生效。
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="item in orphanRestrictedSeeds"
                :key="item.seedId"
                class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              >
                {{ item.name }} · {{ item.scope }}
                <button
                  type="button"
                  class="i-carbon-close text-amber-600 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
                  :title="`清除 ${item.name} 的土地限制`"
                  :aria-label="`清除 ${item.name} 的土地限制`"
                  @click="setBagSeedLandTypes(item.seedId, [])"
                />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <BaseInput
          v-model.number="localStrategySettings.intervals.farmMin"
          label="农场巡查最小 (秒)"
          type="number"
          min="1"
        />
        <BaseInput
          v-model.number="localStrategySettings.intervals.farmMax"
          label="农场巡查最大 (秒)"
          type="number"
          min="1"
        />
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-2">
        <BaseInput
          v-model.number="localStrategySettings.intervals.friendMin"
          label="好友任务最小 (秒)"
          type="number"
          min="1"
        />
        <BaseInput
          v-model.number="localStrategySettings.intervals.friendMax"
          label="好友任务最大 (秒)"
          type="number"
          min="1"
        />
      </div>

      <div class="flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
        <BaseSwitch
          v-model="localStrategySettings.friendQuietHours.enabled"
          label="启用静默时段"
        />
        <div class="flex items-center gap-2">
          <NTimePicker
            v-model:formatted-value="localStrategySettings.friendQuietHours.start"
            class="w-28"
            format="HH:mm"
            value-format="HH:mm"
            :clearable="false"
            :disabled="!localStrategySettings.friendQuietHours.enabled"
            size="small"
          />
          <span class="text-xs text-gray-500">-</span>
          <NTimePicker
            v-model:formatted-value="localStrategySettings.friendQuietHours.end"
            class="w-28"
            format="HH:mm"
            value-format="HH:mm"
            :clearable="false"
            :disabled="!localStrategySettings.friendQuietHours.enabled"
            size="small"
          />
        </div>
        <BaseSwitch
          v-model="localStrategySettings.friendQuietHours.continueFarm"
          label="静默时继续农场巡查"
          :disabled="!localStrategySettings.friendQuietHours.enabled"
        />
      </div>

      <div class="border-t pt-3 space-y-3 dark:border-gray-700">
        <h4 class="text-sm text-gray-700 font-medium dark:text-gray-300">
          种植与偷菜延迟设置
        </h4>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BaseSwitch
            v-model="localStrategySettings.plantOrderRandom"
            label="种植顺序随机"
          />
          <BaseInput
            v-model.number="localStrategySettings.plantDelaySeconds"
            label="种植延迟 (秒)"
            type="number"
            min="0"
            max="60"
          />
          <BaseInput
            v-model.number="localStrategySettings.stealDelaySeconds"
            label="偷菜延迟 (秒)"
            type="number"
            min="0"
            max="300"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="strategySaving"
          @click="saveStrategySettings"
        >
          保存策略设置
        </BaseButton>
      </div>
    </div>
  </div>
</template>
