<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BUCKETS, formatAssetAmount, formatCount, formatDuration, formatHours, RANCH_IMAGE, RANCH_TODO_TONES, sortFacilities, useRanchActions, useRanchClock, useRanchLoader, useRanchUnmountReset } from '@/components/ranch/ranch-shared'
import RanchGate from '@/components/ranch/RanchGate.vue'
import RunLogCard from '@/components/RunLogCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { getPlatformLabel, useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status, currentAccountConnected: isOnline } = storeToRefs(useStatusStore())
const { state, loading } = storeToRefs(useRanchStore())
const { refresh } = useRanchLoader('animals')
const { remainingSeconds } = useRanchClock()
const { request, disabled: actionsDisabled } = useRanchActions()
const router = useRouter()
useRanchUnmountReset()

const facilities = computed<any[]>(() => sortFacilities(state.value?.facilities || []))
const pens = computed(() => facilities.value.filter(f => f.ranch))
const animals = computed(() => pens.value.flatMap(f => (f.ranch.animals || []).map((animal: any) => ({ animal, pen: f.name }))))
const capacity = computed(() => pens.value.reduce((sum, f) => sum + (Number(f.ranch.capacity) || 0), 0))
const shelves = computed(() => pens.value.flatMap(f => (f.ranch.shelves || []).filter((s: any) => s.canCollect).map((s: any) => ({ ...s, pen: f.name, key: `${f.id}:${s.slot}` }))))
const shelvesReady = computed(() => shelves.value.length)
const hazards = computed(() => pens.value.reduce((sum, f) => sum + (f.ranch.hazards?.length || 0), 0))
const blocked = computed(() => animals.value.filter(({ animal }) => animal.grassBlocked).length)

/** 概览只铺一屏能看完的量，其余交给「我的牧场」。 */
const PREVIEW_LIMIT = 8
const animalPreview = computed(() => animals.value.slice(0, PREVIEW_LIMIT))
const hiddenAnimals = computed(() => Math.max(0, animals.value.length - PREVIEW_LIMIT))
const canHarvest = computed(() => animals.value.some(({ animal }) => animal.canHarvest) || shelvesReady.value > 0)
const canProduce = computed(() => animals.value.some(({ animal }) => animal.canProduce))

const displayName = computed(() => {
  const account = currentAccount.value
  const live = String(status.value?.accountId || '') === String(account?.id || '') ? status.value?.status?.name : ''
  return live || account?.nick || account?.name || '我的牧场'
})
const avatar = computed(() => {
  const account = currentAccount.value
  const live = String(status.value?.accountId || '') === String(account?.id || '') ? String(status.value?.status?.avatarUrl || '').trim() : ''
  return live || String(account?.avatar || '').trim()
})
const failedAvatar = ref('')
watch(avatar, () => failedAvatar.value = '')
const platformLabel = computed(() => getPlatformLabel(currentAccount.value?.platform))

const expPercent = computed(() => {
  const needed = Number(state.value?.neededExp) || 0
  return needed > 0 ? Math.min(100, Math.max(0, Number(state.value.currentExp) / needed * 100)) : 100
})
const expHint = computed(() => {
  if (!state.value?.neededExp)
    return '牧场已满级'
  const remain = Number(state.value.neededExp) - Number(state.value.currentExp)
  return `距 Lv.${Number(state.value.level) + 1} 还差 ${formatCount(Math.max(0, remain))} 经验`
})

const currency = (id: number) => state.value?.currencies?.find((c: any) => Number(c.id) === id)
const assetTiles = computed(() => [1007, 1002, 1005, 1008].map(id => currency(id)).filter(Boolean))
const stockTiles = computed(() => {
  const buckets = BUCKETS.map(bucket => ({
    key: bucket.id,
    label: bucket.name,
    image: bucket.image,
    value: formatHours(state.value?.buckets?.find((b: any) => Number(b.id) === bucket.id)?.seconds ?? 0),
    hours: true,
  }))
  const dung = currency(7002)
  return [
    { key: 7001, label: '牧草', image: RANCH_IMAGE(7001), value: formatCount(state.value?.grass ?? 0), hours: false },
    ...(dung ? [{ key: 7002, label: dung.name, image: dung.image, value: formatCount(dung.count), hours: false }] : []),
    ...buckets,
  ]
})

/** 待处理项点一下就直达：能一键处理的走报价弹窗，需要挑动物的跳到牧家页。 */
const todo = computed(() => [
  {
    key: 'harvest',
    label: '可收获',
    icon: RANCH_TODO_TONES.harvest,
    value: animals.value.filter(({ animal }) => animal.canHarvest).length + shelvesReady.value,
    go: () => request('harvest', { all: true }),
  },
  {
    key: 'produce',
    label: '可生产',
    icon: RANCH_TODO_TONES.produce,
    value: animals.value.filter(({ animal }) => animal.canProduce).length,
    go: () => request('produce', { all: true }),
  },
  {
    key: 'feed',
    label: '可喂养',
    icon: 'i-carbon-flash text-sky-500',
    value: animals.value.filter(({ animal }) => animal.canFeed).length,
    // 喂养要先选普通/有机罐头，交给牧家页的动物卡片处理。
    go: () => void router.push('/ranch/personal?tab=animals'),
  },
  {
    key: 'clean',
    label: '待清理',
    icon: RANCH_TODO_TONES.clean,
    value: hazards.value,
    go: () => request('clean'),
  },
])

/** 今日动作计数来自后端 ranch-stats，只统计次数与产出，不含估值。 */
const todayStats = computed(() => {
  const counts = state.value?.todayStats?.counts
  if (!counts)
    return null
  const rows = [
    { key: 'harvest', label: '收获', value: Number(counts.harvest || 0), unit: '次' },
    { key: 'produce', label: '生产', value: Number(counts.produce || 0), unit: '次' },
    { key: 'sell', label: '出售', value: Number(counts.sell || 0), unit: '次' },
    { key: 'feed', label: '喂养', value: Number(counts.feed || 0), unit: '次' },
  ].filter(row => row.value > 0)
  return rows.length ? rows : null
})

function facilityMeter(f: any) {
  if (f.state === 2)
    return { text: '待建造', percent: 0 }
  if (f.upgradeState)
    return { text: `升级中 · ${formatDuration(remainingSeconds(f.upgradeEndTime))}`, percent: 0 }
  if (f.ranch)
    return { text: `${f.ranch.count} / ${f.ranch.capacity}`, percent: f.ranch.capacity ? f.ranch.count / f.ranch.capacity * 100 : 0 }
  if (f.feed)
    return { text: `牧草 ${f.feed.count} / ${f.capacity}`, percent: f.capacity ? f.feed.count / f.capacity * 100 : 0 }
  return { text: `容量 ${f.capacity}`, percent: 0 }
}

/** 动物卡片只做状态摘要，点开再去牧家页处理，避免牧野里堆一排按钮。 */
function animalState(animal: any) {
  if (animal.canHarvest)
    return { text: '可收获', tone: 'ripe' }
  if (animal.canProduce)
    return { text: '可生产', tone: 'produce' }
  if (animal.grassBlocked)
    return { text: '缺牧草', tone: 'blocked' }
  if (animal.canFeed)
    return { text: '可喂养', tone: 'feed' }
  const seconds = animal.nextAtMs ? remainingSeconds(animal.nextAtMs) : 0
  return { text: seconds > 0 ? formatDuration(seconds) : animal.stageName || '成长中', tone: 'idle' }
}

function openAnimals() {
  void router.push('/ranch/personal?tab=animals')
}
</script>

<template>
  <div class="page-stack flex flex-col gap-5">
    <EmptyState v-if="!currentAccountId" title="请先选择账号" description="在左侧选择账号后查看牧场" icon="i-carbon-user-avatar" />
    <RanchGate v-else @retry="refresh">
      <div class="overview-grid">
        <!-- 账号：身份、在线状态与牧场等级 -->
        <section class="ov-card ov-account">
          <div class="ov-account__head">
            <div class="ov-avatar" :class="{ 'is-online': isOnline }">
              <img v-if="avatar && avatar !== failedAvatar" :key="avatar" :src="avatar" alt="" @error="failedAvatar = avatar">
              <span v-else class="i-carbon-user-avatar" />
              <i class="ov-avatar__dot" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="ov-account__name-row">
                <strong class="ov-account__name" :title="displayName">{{ displayName }}</strong>
                <span class="ov-level">牧场 Lv.{{ state.level }}</span>
              </div>
              <div class="ov-presence">
                <span class="ov-presence__state" :class="isOnline ? 'is-online' : 'is-offline'">{{ isOnline ? '在线' : '离线' }}</span>
                <span class="ov-presence__item"><span class="i-carbon-pet-image-o" />饲养 {{ animals.length }} / {{ capacity }}</span>
                <span v-if="platformLabel" class="ov-presence__item">{{ platformLabel }}</span>
              </div>
            </div>
            <NButton circle quaternary :loading="loading" title="刷新牧场" aria-label="刷新牧场" @click="refresh">
              <template #icon>
                <span class="i-carbon-renew" />
              </template>
            </NButton>
          </div>

          <div class="ov-exp">
            <div class="ov-exp__labels">
              <span>牧场经验</span>
              <span class="ov-exp__value">
                {{ formatCount(state.currentExp) }} / {{ state.neededExp ? formatCount(state.neededExp) : '—' }}
                <b>{{ Math.floor(expPercent) }}%</b>
              </span>
            </div>
            <div class="ov-exp__track">
              <div class="ov-exp__bar" :style="{ width: `${expPercent}%` }" />
            </div>
          </div>

          <div class="ov-account__foot">
            <span>{{ expHint }}</span>
          </div>
        </section>

        <!-- 资产 -->
        <section class="ov-card">
          <h3 class="ov-card__title">
            资产
          </h3>
          <div class="ov-tiles">
            <div v-for="item in assetTiles" :key="item.id" class="ov-tile">
              <span class="ov-tile__label"><img class="ov-tile__img" :src="item.image" alt="">{{ item.name }}</span>
              <strong class="ov-tile__value" :title="formatCount(item.count)">{{ formatAssetAmount(item.count) }}</strong>
            </div>
          </div>
        </section>

        <!-- 库存：牧草、便便与罐头桶 -->
        <section class="ov-card">
          <h3 class="ov-card__title">
            牧场库存
          </h3>
          <div class="ov-tiles">
            <div v-for="item in stockTiles" :key="item.key" class="ov-tile">
              <span class="ov-tile__label"><img class="ov-tile__img" :src="item.image" alt="">{{ item.label }}</span>
              <strong class="ov-tile__value">{{ item.value }}</strong>
            </div>
          </div>
        </section>
      </div>

      <div v-if="state.sceneFallback" class="ranch-alert" role="status">
        <span class="i-carbon-information" aria-hidden="true" />
        <span>该账号的牧场场景尚未解锁，数据在通用场景读取，部分写操作可能被服务端拒绝。</span>
      </div>

      <div v-if="blocked" class="ranch-alert" role="status">
        <span class="i-carbon-warning-alt" aria-hidden="true" />
        <span>牧草不足，{{ blocked }} 只动物已暂停成长。</span>
        <BaseButton variant="text" size="sm" to="/ranch/personal?tab=facilities">
          去补充牧草
        </BaseButton>
      </div>

      <div class="ov-board">
        <!-- 动物速览：概览只看状态，操作去个人页 -->
        <section class="ov-card ov-herd">
          <header class="ranch-card-head">
            <h3 class="ov-herd__title">
              <span class="i-carbon-pet-image-o" aria-hidden="true" />牧场动物
              <small>{{ animals.length }} / {{ capacity }}</small>
            </h3>
            <div class="ov-herd__actions">
              <BaseButton v-if="hazards" variant="text" size="sm" :disabled="actionsDisabled" @click="request('clean')">
                清理 ({{ hazards }})
              </BaseButton>
              <BaseButton variant="secondary" size="sm" :disabled="actionsDisabled || !canProduce" @click="request('produce', { all: true })">
                一键生产
              </BaseButton>
              <BaseButton variant="primary" size="sm" :disabled="actionsDisabled || !canHarvest" @click="request('harvest', { all: true })">
                一键收获
              </BaseButton>
              <BaseButton variant="text" size="sm" @click="openAnimals">
                全部动物<span class="i-carbon-chevron-right" aria-hidden="true" />
              </BaseButton>
            </div>
          </header>

          <div v-if="animalPreview.length" class="ov-herd__grid">
            <button
              v-for="{ animal, pen } in animalPreview"
              :key="`${animal.ranchId}:${animal.id}`"
              type="button"
              class="ov-animal"
              :class="`is-${animalState(animal).tone}`"
              :title="`${animal.name} · ${pen} · ${animalState(animal).text}`"
              @click="openAnimals"
            >
              <span class="ov-animal__media">
                <img v-if="animal.image" :src="animal.image" alt="" loading="lazy">
                <span v-else class="i-carbon-pet-image-o" aria-hidden="true" />
              </span>
              <span class="ov-animal__name">{{ animal.name }}</span>
              <span class="ov-animal__state">{{ animalState(animal).text }}</span>
            </button>
            <button v-if="hiddenAnimals" type="button" class="ov-animal ov-animal--more" @click="openAnimals">
              <span class="ov-animal__more">+{{ hiddenAnimals }}</span>
              <span class="ov-animal__name">还有 {{ hiddenAnimals }} 只</span>
            </button>
          </div>

          <div v-else class="ov-herd__empty">
            <span class="i-carbon-pet-image-o" aria-hidden="true" />
            <div>
              <strong>还没有饲养动物</strong>
              <p>去牧场商店买幼崽，到背包里放养到窝或棚。</p>
            </div>
            <BaseButton variant="secondary" size="sm" to="/ranch/game-mall">
              去牧场商店
            </BaseButton>
          </div>

          <div v-if="shelves.length" class="ov-shelves">
            <span class="ov-shelves__label"><span class="i-carbon-box" aria-hidden="true" />待收产物</span>
            <span v-for="shelf in shelves" :key="shelf.key" class="ov-shelves__item">
              <template v-for="product in shelf.products" :key="product.id">
                <img :src="product.image" alt="">{{ product.name }}<b>×{{ formatCount(product.count) }}</b>
              </template>
            </span>
          </div>
        </section>

        <div class="ov-side">
          <!-- 待处理：对应农场的“今日统计” -->
          <section class="ov-card ov-todo-card">
            <header class="ranch-card-head">
              <h3 class="ov-side__title">
                <span class="i-carbon-task" aria-hidden="true" />待处理
              </h3>
              <BaseButton variant="text" size="sm" to="/ranch/personal">
                管理动物<span class="i-carbon-chevron-right" aria-hidden="true" />
              </BaseButton>
            </header>
            <div class="ov-todo">
              <button
                v-for="item in todo"
                :key="item.key"
                type="button"
                class="ranch-todo"
                :class="{ 'is-zero': !item.value }"
                :disabled="!item.value || actionsDisabled"
                :title="item.value ? `点击处理：${item.label}` : `暂无${item.label}`"
                @click="item.go()"
              >
                <span class="ranch-todo__label"><span class="select-none" :class="item.icon" aria-hidden="true" />{{ item.label }}</span>
                <b>{{ item.value }}</b>
              </button>
            </div>
            <div v-if="todayStats" class="ranch-today">
              <span class="text-xs text-gray-500">今日</span>
              <span v-for="row in todayStats" :key="row.key" class="ranch-today__item">
                {{ row.label }}<b>{{ row.value }}</b>{{ row.unit }}
              </span>
            </div>
            <p v-else class="ranch-today ranch-today--empty">
              今日暂无操作记录
            </p>
          </section>

          <!-- 设施 -->
          <section class="ov-card ov-facility-card">
            <h3 class="ov-side__title mb-3">
              <span class="i-carbon-building" aria-hidden="true" />牧场设施
            </h3>
            <div class="ranch-facilities">
              <div v-for="f in facilities" :key="f.id" class="ranch-facility" :class="{ 'is-pending': f.state === 2 }">
                <div class="ranch-facility__row">
                  <span class="ranch-facility__name">{{ f.name }}<small>Lv.{{ f.level }}</small></span>
                  <span class="ranch-facility__value">{{ facilityMeter(f).text }}</span>
                </div>
                <div class="ranch-facility__track" aria-hidden="true">
                  <i :style="{ width: `${Math.min(100, facilityMeter(f).percent)}%` }" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <!-- 运行日志按账号记录，与农场概览共用组件，这里默认只看牧场模块 -->
      <div class="ov-log">
        <RunLogCard module="ranch" />
      </div>
    </RanchGate>
  </div>
</template>

<style scoped src="@/styles/overview.css"></style>

<style scoped>
.ov-account__head > :deep(.n-button) {
  align-self: flex-start;
}

/* 异构道具图标统一放进浅色圆角托盘，视觉归一、更有质感 */
.ov-tile__img {
  box-sizing: content-box;
  width: 18px;
  height: 18px;
  flex: none;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-solid);
  box-shadow: 0 1px 2px rgba(38, 74, 52, 0.08);
  object-fit: contain;
}

.ranch-alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 30%, transparent);
  border-radius: var(--ui-radius-control);
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
  font-size: 13px;
}

/* 只有带操作按钮时（元素 1 图标、2 文案、3 按钮）把按钮推到右侧，单条文案保持左对齐 */
.ranch-alert > :nth-child(3) {
  margin-left: auto;
}

.ranch-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

/* 主体：左边动物，右边待处理与设施。.ov-side 只做分组，用 contents 让两张卡直接进网格 */
.ov-board {
  display: grid;
  align-items: stretch;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 768px) {
  .ov-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ov-herd {
    grid-column: 1 / -1;
  }
}

@media (min-width: 1280px) {
  .ov-board {
    grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr);
  }

  .ov-herd {
    grid-column: auto;
  }
}

.ov-side {
  display: contents;
}

.ov-herd__title,
.ov-side__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-ink);
  font-size: 15px;
  font-weight: var(--fw-650);
}

.ov-herd__title > span:first-child,
.ov-side__title > span:first-child {
  color: var(--ui-primary);
}

.ov-herd__title small {
  color: var(--ui-subtle);
  font-size: 12px;
  font-weight: var(--fw-500);
  font-variant-numeric: tabular-nums;
}

.ov-herd__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.ov-herd__grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
}

.ov-animal {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface-soft);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    transform 0.16s ease,
    background-color 0.16s ease;
}

.ov-animal:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 34%, var(--ui-border));
  background: var(--ui-surface);
  transform: translateY(-1px);
}

.ov-animal__media {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
}

.ov-animal__media img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.ov-animal__media > span {
  color: var(--ui-subtle);
  font-size: 20px;
}

.ov-animal__name {
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 12px;
  font-weight: var(--fw-600);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-animal__state {
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-subtle);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ov-animal.is-ripe {
  border-color: color-mix(in srgb, var(--ui-primary) 46%, var(--ui-border));
}

.ov-animal.is-ripe .ov-animal__state {
  color: var(--ui-primary);
  font-weight: var(--fw-650);
}

.ov-animal.is-produce .ov-animal__state {
  color: var(--ui-primary);
}

.ov-animal.is-blocked {
  border-color: color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
}

.ov-animal.is-blocked .ov-animal__state {
  color: var(--ui-warning);
  font-weight: var(--fw-650);
}

.ov-animal--more {
  justify-content: center;
  border-style: dashed;
  background: transparent;
}

.ov-animal__more {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  color: var(--ui-muted);
  font-size: 15px;
  font-weight: var(--fw-650);
}

.ov-herd__empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  border: 1px dashed var(--ui-border-strong);
  border-radius: var(--ui-radius-control);
  color: var(--ui-muted);
}

.ov-herd__empty > span {
  color: var(--ui-subtle);
  font-size: 26px;
}

.ov-herd__empty strong {
  display: block;
  color: var(--ui-ink);
  font-size: 14px;
}

.ov-herd__empty p {
  margin: 2px 0 0;
  font-size: 12px;
}

.ov-herd__empty > :last-child {
  margin-left: auto;
}

.ov-shelves {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--ui-border);
  font-size: 12px;
}

.ov-shelves__label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-muted);
  font-weight: var(--fw-600);
}

.ov-shelves__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 2px;
  border-radius: 999px;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
}

.ov-shelves__item img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.ov-shelves__item b {
  color: var(--ui-ink);
  font-variant-numeric: tabular-nums;
}

.ov-todo {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ranch-todo {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--ui-surface-soft);
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.ranch-todo:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--ui-primary) 32%, transparent);
  background: color-mix(in srgb, var(--ui-primary-soft) 60%, var(--ui-surface-soft));
}

.ranch-todo:disabled {
  cursor: default;
}

.ranch-todo__label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ranch-todo b {
  font-size: 15px;
}

.ranch-todo.is-zero {
  opacity: 0.6;
}

.ranch-today {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--ui-border);
  color: var(--ui-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ranch-today--empty {
  margin: 10px 0 0;
  color: var(--ui-subtle);
  line-height: 1.5;
}

.ranch-today__item b {
  margin: 0 1px 0 3px;
  color: var(--ui-ink);
  font-weight: var(--fw-650);
}

.ranch-facilities {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ranch-facility__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.ranch-facility__name {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--ui-ink);
  font-weight: var(--fw-600);
}

.ranch-facility__name small {
  color: var(--ui-subtle);
  font-size: 11px;
  font-weight: var(--fw-500);
}

.ranch-facility__value {
  color: var(--ui-muted);
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ranch-facility__track {
  height: 6px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-surface-soft);
}

.ranch-facility__track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #9fd17d, var(--ui-primary));
  transition: width 0.4s ease;
}

.ranch-facility.is-pending {
  opacity: 0.6;
}

/* 日志收在页面最后，固定高度，避免占掉概览的视觉重心 */
.ov-log {
  display: flex;
  min-width: 0;
}

.ov-log :deep(.dash-logs) {
  width: 100%;
  flex: none;
}

.ov-log :deep(.dash-logs__card) {
  height: 240px;
  flex: none;
}

/* RunLogCard 在 >=768px 给外层设 min-height:480px 供绝对定位卡片铺满，
   而牧场把卡片压到 220/240px。外层高度须与卡片一致，否则底部空一大截。 */
@media (min-width: 768px) {
  .ov-log :deep(.dash-logs) {
    min-height: 240px;
  }
}

@media (min-width: 1180px) {
  .ov-log :deep(.dash-logs) {
    min-height: 220px;
  }

  .ov-log :deep(.dash-logs__card) {
    height: 220px;
  }
}

@media (max-width: 639px) {
  .ranch-card-head {
    align-items: flex-start;
  }

  .ov-herd__actions {
    width: 100%;
    justify-content: flex-start;
  }

  /* 手机端筛选项为 2×2 网格 + 按钮行，本身约占 200px；
     卡片太矮会让日志列表只剩一两行、内容被裁切，这里给足高度容纳多行日志。 */
  .ov-log :deep(.dash-logs) {
    min-height: 460px;
  }

  .ov-log :deep(.dash-logs__card) {
    height: 460px;
  }
}
</style>
