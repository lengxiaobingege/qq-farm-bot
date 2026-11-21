<script setup lang="ts">
import { computed, ref } from 'vue'
import EntityCard from '@/components/EntityCard.vue'

/**
 * 一块地的卡片。结构固定为：编号与土地类型 / 作物 / 名称 / 时间或主状态 / 进度 / 状态图标，
 * 每张卡片高度一致；操作统一在外层“选择土地”后批量进行，卡片本身不放按钮。
 * 与牧场动物卡共用 EntityCard 公共骨架，土地专属配色/等级/性状/选择态在此覆盖。
 */
const props = withDefaults(defineProps<{
  land: any
  selectable?: boolean
  selected?: boolean
  selectionDisabled?: boolean
  selectionLabel?: string
  /** 非选择模式下点击卡片触发 open（查看土地详情）。 */
  openable?: boolean
}>(), {
  selectable: false,
  selected: false,
  selectionDisabled: false,
  selectionLabel: '',
  openable: false,
})

const emit = defineEmits<{
  select: [land: any]
  open: [land: any]
}>()

const land = computed(() => props.land || {})

const SOILS: Record<number, { short: string, name: string }> = {
  0: { short: '普通', name: '普通土地' },
  1: { short: '普通', name: '普通土地' },
  2: { short: '红土', name: '红土地' },
  3: { short: '黑土', name: '黑土地' },
  4: { short: '金土', name: '金土地' },
  5: { short: '紫金', name: '紫金土地' },
  6: { short: '蓝晶', name: '蓝晶土地' },
}
const level = computed(() => {
  const lv = Number(land.value.level) || 0
  return SOILS[lv] ? lv : 0
})
const soil = computed(() => SOILS[level.value]!)

const status = computed(() => String(land.value.status || ''))
const isLocked = computed(() => status.value === 'locked' || land.value.unlocked === false)
const isEmpty = computed(() => !isLocked.value && (status.value === 'empty' || !String(land.value.plantName || '').trim()))
const plantSize = computed(() => Math.max(1, Number(land.value.plantSize) || 1))
// 合种副地：作物与状态都来自主地，只做弱化展示并指向主地。
const isFollower = computed(() => !!land.value.occupiedByMaster && Number(land.value.masterLandId) > 0 && Number(land.value.masterLandId) !== Number(land.value.id))
const isJointMaster = computed(() => plantSize.value > 1 && !isFollower.value && !isEmpty.value && !isLocked.value)

/** 时间行：生长中显示倒计时，其余显示主状态。 */
const stateTag = computed(() => {
  if (isLocked.value)
    return { kind: 'muted', icon: 'i-carbon-locked', text: '未解锁' }
  if (isEmpty.value)
    return { kind: 'muted', icon: 'i-carbon-add-alt', text: '空地' }
  if (isFollower.value)
    return { kind: 'muted', icon: 'i-carbon-link', text: `#${land.value.masterLandId}合种` }
  if (status.value === 'harvestable')
    return { kind: 'ripe', icon: 'i-carbon-wheat', text: '可收获' }
  if (status.value === 'stealable')
    return { kind: 'steal', icon: 'i-carbon-touch-1', text: '可偷' }
  if (status.value === 'harvested')
    return { kind: 'muted', icon: 'i-carbon-wheat', text: '已成熟' }
  if (status.value === 'dead')
    return { kind: 'dead', icon: 'i-carbon-misuse-outline', text: '已枯萎' }
  return null
})

function formatTime(sec: number) {
  const value = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = value % 60
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 已生长的比例：越接近成熟越满。 */
const growPercent = computed(() => {
  const total = Number(land.value.totalGrowTime) || 0
  const remain = Number(land.value.matureInSec) || 0
  if (total <= 0 || remain <= 0)
    return status.value === 'harvestable' || status.value === 'stealable' ? 100 : 0
  return Math.min(100, Math.max(3, (1 - remain / total) * 100))
})

const seasonText = computed(() => {
  const total = Number(land.value.totalSeason) || 0
  return total > 1 ? `${Math.max(1, Number(land.value.currentSeason) || 1)}/${total}季` : ''
})

function safeImage(url: string) {
  return url && url.startsWith('http://') ? url.replace('http://', 'https://') : url
}

// ---- 状态图标：需处理（实心）与加成/效果（描边）分两组 ----
const needs = computed(() => {
  if (isFollower.value || isLocked.value || isEmpty.value)
    return []
  return [
    land.value.needWater && { key: 'water', icon: 'i-carbon-rain-drop', title: '缺水' },
    land.value.needWeed && { key: 'weed', icon: 'i-carbon-clean', title: '杂草' },
    land.value.needBug && { key: 'bug', icon: 'i-carbon-debug', title: '虫害' },
  ].filter(Boolean) as Array<{ key: string, icon: string, title: string }>
})

const failedMutantIcons = ref(new Set<string>())

const traits = computed(() => {
  if (isFollower.value || isLocked.value || isEmpty.value)
    return []
  const list: Array<{ key: string, kind: string, icon?: string, image?: string, title: string }> = []
  const resonance = Math.max(0, Number(land.value.purpleCrystalResonanceExpBonus) || 0) / 100
  if (resonance > 0)
    list.push({ key: 'resonance', kind: 'resonance', icon: 'i-carbon-flash-filled', title: `紫晶共鸣：变异作物经验 +${resonance}%` })
  const effects = Array.isArray(land.value.mutantEffects) && land.value.mutantEffects.length
    ? land.value.mutantEffects
    : (Array.isArray(land.value.mutantConfigIds) ? land.value.mutantConfigIds.map((id: any) => ({ id, name: `变异 #${id}` })) : [])
  for (const effect of effects) {
    const id = Number(effect?.id) || 0
    const name = String(effect?.name || effect?.effect_name || '').trim()
    if (!name)
      continue
    const desc = String(effect?.description || effect?.desc || '').trim()
    const collections = id === 18 && Array.isArray(effect.collections) ? effect.collections : []
    for (const collection of collections) {
      const key = `m${id}:${collection.seriesId}:${collection.itemId}`
      list.push({
        key,
        kind: 'mutant',
        image: failedMutantIcons.value.has(key) ? '' : safeImage(String(collection.image || '')),
        icon: 'i-carbon-trophy',
        title: `藏品变异 · ${collection.name}`,
      })
    }
    if (collections.length)
      continue
    const key = `m${id}${name}`
    list.push({
      key,
      kind: 'mutant',
      // 官方配置的藏品图标仍指向奶茶；没有具体藏品时显示通用藏品标记。
      image: id > 0 && id !== 18 && !failedMutantIcons.value.has(key) ? `/game-config/seed_images_named/mutant/${id}.png` : '',
      icon: id === 18 ? 'i-carbon-trophy' : 'i-carbon-star',
      title: desc ? `变异 · ${name}：${desc}` : `变异 · ${name}`,
    })
  }
  const seen = new Set<string>()
  for (const effect of Array.isArray(land.value.interactionEffects) ? land.value.interactionEffects : []) {
    const itemId = String(effect?.itemId || '')
    if (!effect?.confirmed || !itemId || seen.has(itemId))
      continue
    seen.add(itemId)
    list.push({ key: `i${itemId}`, kind: 'effect', icon: 'i-carbon-checkmark-outline', title: `${effect.itemName || `道具${itemId}`}：已生效` })
  }
  const left = land.value.leftInorcFertTimes
  if (left != null && !Number.isNaN(Number(left)) && status.value === 'growing')
    list.push({ key: 'organic', kind: Number(left) > 0 ? 'organic' : 'organic-off', icon: 'i-carbon-chemistry', title: Number(left) > 0 ? `还可施有机肥 ${left} 次` : '已无法再施有机肥' })
  return list
})

// 状态行宽度有限：最多 4 个图标，超出合并为 “+N”。需处理的问题排在最前，永远可见。
const MAX_TAGS = 4
const allTags = computed(() => [
  ...needs.value.map(item => ({ ...item, group: 'need' as const, kind: item.key, image: '' })),
  ...traits.value.map(item => ({ ...item, group: 'trait' as const })),
])
const visibleTags = computed(() => allTags.value.length > MAX_TAGS ? allTags.value.slice(0, MAX_TAGS - 1) : allTags.value)
const hiddenTags = computed(() => allTags.value.slice(visibleTags.value.length))
const hiddenTitle = computed(() => hiddenTags.value.map(item => item.title).join('\n'))
const allTitle = computed(() => allTags.value.map(item => item.title).join('\n'))

function markMutantFailed(key: string) {
  failedMutantIcons.value = new Set(failedMutantIcons.value).add(key)
}

const interactive = computed(() => props.selectable || props.openable)

function activate() {
  if (props.selectable) {
    if (!props.selectionDisabled)
      emit('select', props.land)
    return
  }
  if (props.openable)
    emit('open', props.land)
}

const ariaLabel = computed(() => {
  const parts = [`第 ${land.value.id} 块地`, soil.value.name]
  if (!isEmpty.value && !isLocked.value)
    parts.push(String(land.value.plantName || ''))
  if (stateTag.value)
    parts.push(stateTag.value.text)
  else if (Number(land.value.matureInSec) > 0)
    parts.push(`${formatTime(land.value.matureInSec)} 后成熟`)
  if (needs.value.length)
    parts.push(needs.value.map(item => item.title).join('、'))
  if (props.selectable && props.selectionDisabled && props.selectionLabel)
    parts.push(props.selectionLabel)
  return parts.filter(Boolean).join('，')
})
</script>

<template>
  <EntityCard
    class="plot"
    :class="[
      `plot--lv${level}`,
      stateTag ? `plot--${stateTag.kind}` : '',
      {
        'plot--locked': isLocked,
        'plot--follower': isFollower,
      },
    ]"
    :interactive="interactive"
    :selectable="selectable"
    :selected="selected"
    :disabled="selectionDisabled"
    :aria-label="ariaLabel"
    :title-text="selectable && selectionDisabled ? (selectionLabel || '这块地当前不能选择') : undefined"
    @activate="activate"
  >
    <template #top>
      <span class="plot__no">#{{ land.id }}</span>
      <span class="plot__soil" :title="soil.name">{{ soil.short }}</span>
      <span v-if="isJointMaster" class="plot__joint" :title="`合种作物，占用 ${plantSize}×${plantSize} 块地`">
        <span class="i-carbon-grid" aria-hidden="true" />{{ plantSize }}×{{ plantSize }}
      </span>
      <span v-if="selectable" class="plot__check" aria-hidden="true">
        <span v-if="selected" class="i-carbon-checkmark" />
        <span v-else-if="selectionDisabled" class="i-carbon-subtract" />
      </span>
    </template>

    <template #media>
      <span v-if="isLocked" class="plot__placeholder i-carbon-locked" />
      <span v-else-if="isEmpty" class="plot__placeholder i-carbon-sprout" />
      <img v-else-if="land.seedImage" :src="safeImage(land.seedImage)" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span v-else class="plot__placeholder i-carbon-sprout" />
    </template>

    <template #name>
      <span :title="land.plantName">{{ isLocked ? '—' : isEmpty ? '待种植' : land.plantName }}</span>
    </template>

    <template #state>
      <span v-if="stateTag" class="plot__state" :class="`is-${stateTag.kind}`"><span :class="stateTag.icon" aria-hidden="true" />{{ stateTag.text }}</span>
      <span v-else-if="Number(land.matureInSec) > 0" class="plot__countdown"><span class="i-carbon-time" aria-hidden="true" />{{ formatTime(land.matureInSec) }}</span>
      <span v-else class="plot__state is-muted">{{ land.phaseName || '生长中' }}</span>
      <span v-if="seasonText && !isFollower && !isLocked && !isEmpty" class="plot__season">{{ seasonText }}</span>
    </template>

    <template #progress>
      <div class="plot__bar" aria-hidden="true">
        <i :style="{ width: `${isFollower || isEmpty || isLocked ? 0 : growPercent}%` }" />
      </div>
    </template>

    <template #footer>
      <div class="plot__tags" :title="allTitle || undefined">
        <template v-for="(item, index) in visibleTags" :key="item.key">
          <i v-if="index > 0 && item.group === 'trait' && visibleTags[index - 1]?.group === 'need'" class="plot__sep" />
          <span v-if="item.group === 'need'" class="plot__need" :class="`is-${item.kind}`" :title="item.title"><span :class="item.icon" /></span>
          <span v-else class="plot__trait" :class="`is-${item.kind}`" :title="item.title">
            <img v-if="item.image" :src="item.image" alt="" @error="markMutantFailed(item.key)">
            <span v-else :class="item.icon" />
          </span>
        </template>
        <span v-if="hiddenTags.length" class="plot__more" :title="hiddenTitle">+{{ hiddenTags.length }}</span>
      </div>
    </template>
  </EntityCard>
</template>

<style scoped>
/* 农场土地卡复用 EntityCard 公共骨架，这里只保留土地专属：等级配色、编号/土质、合种、选择态、性状标签。
   等级配色直接覆盖 EntityCard 的 --ec-*；差异尺寸用变量覆盖（原图 44px / 进度间距 5px / footer 间距 7px）。 */
.plot.plot {
  --ec-bg: #fbf8f1;
  --ec-line: #e6dbc2;
  --ec-ink: #86642e;
  --ec-chip: #f1e7d2;
  --ec-tint: #c9a867;
  --ec-media-size: 44px;
  --ec-progress-gap: 5px;
  --ec-footer-gap: 7px;
}
.plot.plot--lv2 {
  --ec-bg: #fdf4f1;
  --ec-line: #eecbc1;
  --ec-ink: #b0482f;
  --ec-chip: #f8ddd5;
}
.plot.plot--lv3 {
  --ec-bg: #f4f3f1;
  --ec-line: #d3cfc8;
  --ec-ink: #4b4540;
  --ec-chip: #e3dfd9;
}
.plot.plot--lv4 {
  --ec-bg: #fffae8;
  --ec-line: #ead57f;
  --ec-ink: #946600;
  --ec-chip: #f9e9a8;
}
.plot.plot--lv5 {
  --ec-bg: #f8f3fd;
  --ec-line: #d7c6ef;
  --ec-ink: #7140b5;
  --ec-chip: #eadffa;
}
.plot.plot--lv6 {
  --ec-bg: #eef8fd;
  --ec-line: #b5d9eb;
  --ec-ink: #367caa;
  --ec-chip: #d7edf8;
}

/* 选择态用 EntityCard 的 --selected/--disabled（基于 ui-primary），此处只保留土地专属边框色与合种/锁定 */
.plot.plot--ripe {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--ec-line));
}
.plot.plot--steal {
  border-color: color-mix(in srgb, var(--ui-violet) 55%, var(--ec-line));
}
.plot.plot--dead {
  filter: grayscale(0.85);
}
.plot.plot--locked {
  border-style: dashed;
  opacity: 0.6;
}
.plot--follower :deep(.entity-card__media),
.plot--follower :deep(.entity-card__name) {
  opacity: 0.45;
}

.plot__no {
  color: var(--ui-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.plot__soil {
  padding: 0 6px;
  border-radius: 999px;
  color: var(--ec-ink);
  background: var(--ec-chip);
  font-size: 10px;
  font-weight: var(--fw-700);
  line-height: 16px;
  white-space: nowrap;
}
.plot__joint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  color: var(--ec-ink);
  font-size: 10px;
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}
.plot__check {
  width: 20px;
  height: 20px;
  display: grid;
  flex: none;
  margin-left: auto;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
  border-radius: 50%;
  color: #fff;
  background: color-mix(in srgb, var(--ui-surface-strong) 65%, transparent);
  font-size: 12px;
}
.entity-card--selected .plot__check {
  border-color: var(--ui-primary-fill);
  background: var(--ui-primary-fill);
}
.entity-card--disabled .plot__check {
  color: var(--ui-subtle);
  border-color: var(--ui-border-strong);
  border-style: dashed;
  background: transparent;
}

.plot__joint + .plot__check {
  margin-left: 2px;
}

.plot.entity-card--selectable .plot__joint > span {
  display: none;
}

.plot :deep(.entity-card__media img) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.12));
}
.plot__placeholder {
  color: color-mix(in srgb, var(--ec-ink) 40%, transparent);
  font-size: 24px;
}

.plot :deep(.entity-card__name) {
  margin-top: 4px;
}

.plot :deep(.entity-card__state) {
  height: 20px;
}
.plot__countdown {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--ui-warning);
  font-size: 11px;
  font-weight: var(--fw-700);
  font-variant-numeric: tabular-nums;
}
.plot__state {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  overflow: hidden;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: var(--fw-700);
  line-height: 18px;
  white-space: nowrap;
}
.plot__state.is-ripe {
  color: #fff;
  background: var(--ui-primary-fill);
}
.plot__state.is-steal {
  color: var(--ui-violet);
  background: var(--ui-violet-soft);
}
.plot__state.is-dead {
  color: var(--ui-muted);
  background: color-mix(in srgb, var(--ui-ink) 8%, transparent);
}
.plot__state.is-muted {
  color: var(--ui-subtle);
  padding: 0;
  font-weight: var(--fw-500);
}

.plot__bar {
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ec-ink) 12%, transparent);
}
.plot__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
  transition: width 0.4s ease;
}

/* 土地卡的 tags 是图标行（无边框/无分隔线），覆盖 EntityCard footer 的操作行样式 */
.plot :deep(.entity-card__footer) {
  min-height: 20px;
  padding-top: 0;
  border-top: 0;
  flex-wrap: nowrap;
  gap: 3px;
}
.plot__tags {
  display: flex;
  width: 100%;
  height: 20px;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
}
.plot__need,
.plot__trait {
  width: 18px;
  height: 18px;
  display: inline-grid;
  flex: none;
  place-items: center;
  border-radius: 999px;
  font-size: 11px;
  cursor: help;
}
/* 图标块级、固定尺寸，去掉行内元素的行高与基线留白，圆内上下居中 */
.plot__need,
.plot__trait {
  box-sizing: border-box;
  line-height: 0;
}
.plot__need > span,
.plot__trait > span,
.plot__trait > img {
  display: block;
  flex: none;
}
.plot__need > span,
.plot__trait > span {
  width: 12px;
  height: 12px;
}
.plot__trait img {
  width: 12px;
  height: 12px;
  object-fit: contain;
}
/* 需处理：实心色块，最醒目 */
.plot__need {
  color: #fff;
}
.plot__need.is-water {
  background: #4b9fd5;
}
.plot__need.is-weed {
  background: #5a9f4e;
}
.plot__need.is-bug {
  background: #d9605c;
}
/* 加成与效果：描边，次要 */
.plot__trait {
  border: 1px solid currentColor;
  background: var(--ui-surface-strong);
}
.plot__trait.is-resonance {
  color: #8a55d6;
}
.plot__trait.is-mutant {
  color: #c08a12;
}
.plot__trait.is-effect {
  color: var(--ui-blue);
}
.plot__trait.is-organic {
  color: #5f8f1d;
}
.plot__trait.is-organic-off {
  color: var(--ui-subtle);
  opacity: 0.7;
}
.plot__sep {
  width: 1px;
  height: 12px;
  margin: 0 2px;
  background: var(--ui-border-strong);
}
.plot__more {
  height: 18px;
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  color: var(--ui-muted);
  background: color-mix(in srgb, var(--ui-ink) 8%, transparent);
  font-size: 10px;
  font-weight: var(--fw-700);
  line-height: 18px;
  cursor: help;
  font-variant-numeric: tabular-nums;
}
.plot__season {
  margin-left: 4px;
  color: var(--ui-subtle);
  font-size: 10px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 深色：深灰卡面，类型色只在顶部渐变、描边和类型标签上 */
.dark .plot.plot {
  --ec-tint: #9aa3ad;
  border-color: color-mix(in srgb, var(--ec-tint) 28%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--ec-tint) 12%, #1d2228) 0%, #1a1f25 70%);
  box-shadow: none;
}
.dark .plot.plot--lv1,
.dark .plot.plot--lv0 {
  --ec-tint: #c9a867;
}
.dark .plot.plot--lv2 {
  --ec-tint: #e08a6e;
}
.dark .plot.plot--lv3 {
  --ec-tint: #8d939b;
}
.dark .plot.plot--lv4 {
  --ec-tint: #e6c35a;
}
.dark .plot.plot--lv5 {
  --ec-tint: #b892f0;
}
.dark .plot.plot--lv6 {
  --ec-tint: #82bddf;
}
.dark .plot__soil,
.dark .plot__joint {
  color: var(--ec-tint);
  background: color-mix(in srgb, var(--ec-tint) 15%, transparent);
}
.dark .plot__joint {
  background: transparent;
}
.dark .plot__trait {
  background: transparent;
}
.dark .plot__bar {
  background: rgba(255, 255, 255, 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .plot,
  .plot__bar i {
    transition: none;
  }
}
</style>
