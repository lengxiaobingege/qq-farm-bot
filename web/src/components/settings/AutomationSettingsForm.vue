<script setup lang="ts">
import type { SettingsState } from '@/stores/setting'
import { NButton } from 'naive-ui/es/button'
import { NCheckbox, NCheckboxGroup } from 'naive-ui/es/checkbox'
import { NInputNumber } from 'naive-ui/es/input-number'
import { NTimePicker } from 'naive-ui/es/time-picker'
import { computed, onMounted, ref, toRef } from 'vue'
import api from '@/api'
import BagSeedPriorityItem from '@/components/settings/BagSeedPriorityItem.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import AutomationSectionHeader from './AutomationSectionHeader.vue'
import RanchCubPriority from './RanchCubPriority.vue'
import { type StrategyFormModel, useStrategyForm } from './useStrategyForm'

export type AutomationSettingsFormModel = Pick<
  SettingsState,
  | 'automation'
  | 'fertilizerBuyOrganicCount'
  | 'fertilizerBuyOrganicThresholdHours'
  | 'fertilizerBuyNormalCount'
  | 'fertilizerBuyNormalThresholdHours'
  | 'fertilizerBuyCheckIntervalMinutes'
  | 'autoAcceptFriendMinLevel'
  | 'autoAcceptRequireOwnLevel'
  | 'autoAcceptHarvestStealEnabled'
  | 'autoAcceptHarvestStealHarvest'
  | 'autoAcceptHarvestStealSteal'
>

const props = withDefaults(defineProps<{
  accountId?: string
  accountName?: string
  connected?: boolean
  saving: boolean
  fertilizerLandTypeOptions: Array<{ label: string, value: string }>
  fertilizerOptions: Array<{ label: string, value: string }>
}>(), { accountId: '', accountName: '', connected: false })

const emit = defineEmits<{
  save: []
}>()

const settings = defineModel<AutomationSettingsFormModel>({ required: true })
const strategy = defineModel<StrategyFormModel>('strategy', { required: true })

// 策略表单逻辑（种子/排序/预览），与原策略页完全同源。
const strategyForm = useStrategyForm({
  model: strategy,
  currentAccountId: toRef(props, 'accountId'),
})

const ripeningOnly = computed(() => ['normal_ripen', 'organic_ripen'].includes(settings.value.automation.fertilizer ?? 'none'))
const ripeningEnabled = computed(() => ripeningOnly.value || settings.value.automation.fertilizer === 'smart')
const ripeningFertilizerLabel = computed(() => settings.value.automation.fertilizer === 'normal_ripen' ? '普通化肥' : '有机化肥')

// 平坦开关统一用数组驱动，减少重复的模板与样式包裹。
const farmSwitches = [
  { key: 'farm', label: '自动种植收获', span: false },
  { key: 'farm_harvest_tiangong', label: '自动收获天工作物', span: false },
  { key: 'farm_push', label: '推送触发巡田', span: false },
  { key: 'skip_own_weed_bug', label: '巡田时跳过一键务农', span: false },
  { key: 'land_upgrade', label: '自动升级土地', span: false },
  { key: 'task', label: '自动做任务', span: false },
  { key: 'sell', label: '自动卖果实', span: false },
  { key: 'fertilizer_gift', label: '自动填充化肥', span: true },
] as const
const fertilizerSwitches = [
  { key: 'fertilizer_buy_organic', label: '自动购买有机化肥' },
  { key: 'fertilizer_buy_normal', label: '自动购买无机化肥' },
  { key: 'fertilizer_multi_season', label: '多季补肥' },
  { key: 'show_manual_fertilizer', label: '显示手动施肥按钮' },
] as const
const friendActionSwitches = [
  { key: 'friend_steal', label: '自动偷菜' },
  { key: 'friend_help', label: '自动帮忙' },
  { key: 'friend_bad', label: '自动捣乱' },
  { key: 'friend_help_exp_limit', label: '经验满不帮忙' },
  { key: 'friend_help_protect_dog_ignore_exp_limit', label: '护主犬经验满仍帮忙' },
] as const
const mysteryShopSwitches = [
  { key: 'mystery_shop_auto_buy', label: '自动购买', span: false },
  { key: 'mystery_shop_arrival_notify', label: '到货提醒', span: false },
  { key: 'mystery_shop_purchase_notify', label: '购买提醒', span: true },
] as const
const mysteryShopCurrencySwitches = [
  { key: 'mystery_shop_allow_gold', label: '金币' },
  { key: 'mystery_shop_allow_coupon', label: '点券' },
  { key: 'mystery_shop_allow_gold_bean', label: '金豆豆' },
  { key: 'mystery_shop_allow_diamond', label: '钻石' },
] as const

// 牧场自动化（services/ranch）开关，与后端 config/ranch-automation.ts 一一对应。
const ranchSwitches = [
  { key: 'ranch_harvest', label: '自动收获产物' },
  { key: 'ranch_produce', label: '自动生产（催产）' },
  { key: 'ranch_buy', label: '自动补栏（金券）' },
  { key: 'ranch_upgrade', label: '自动升级设施（金券）' },
  { key: 'ranch_sell', label: '自动出售牧场产物' },
  { key: 'ranch_market_organic_poop', label: '集市粑粑兑换有机化肥' },
  { key: 'ranch_market_organic_pinecone', label: '集市松果兑换有机化肥' },
  { key: 'ranch_clean', label: '自动清理灾害' },
  { key: 'ranch_grass', label: '自动补充牧草' },
  { key: 'ranch_grass_buy', label: '牧草不足时购买（金券）' },
  { key: 'ranch_fill_cans', label: '自动填充库存罐头' },
  { key: 'ranch_feed_normal', label: '普通罐头喂养' },
  { key: 'ranch_feed_organic', label: '有机罐头喂养' },
  { key: 'ranch_task', label: '自动领取牧场任务奖励' },
  { key: 'ranch_illustrated', label: '自动领取图鉴奖励' },
  { key: 'ranch_share', label: '每日首次分享礼包' },
  { key: 'ranch_dry_run', label: '演练模式（只报价不执行）' },
] as const
const ranchFriendSwitches = [
  { key: 'ranch_friend_steal', label: '偷取好友产物' },
  { key: 'ranch_friend_clean', label: '帮好友清理' },
  { key: 'ranch_stroke', label: '抚摸好友动物' },
  { key: 'ranch_friend_mosquito', label: '给好友放蚊子' },
] as const
const RANCH_STRATEGIES = [
  { label: '按已解锁等级', value: 'level' },
  { label: '指定动物', value: 'preferred' },
  { label: '优先背包幼崽', value: 'bag_priority' },
]
const ranchAnimalOptions = ref<Array<{ value: number, label: string, kind: string }>>([])
onMounted(async () => {
  try {
    const { data } = await api.get('/api/ranch/automation-options', { skipErrorToast: true } as any)
    if (data?.ok && Array.isArray(data.data))
      ranchAnimalOptions.value = data.data
  }
  catch {
    // 拿不到动物列表时只影响「指定动物」下拉，其余设置照常保存
  }
})

// ── 设置中心：左侧分组导航 + 右侧单面板 ──
// 策略类分组（planting / cadence）不是布尔开关集合，用「已配置」标记代替启用计数。
// 每组图标统一用服务器同款道具图，语义与分组内容一一对应，且互不重复。
const sectionConfig = [
  {
    id: 'planting', title: '种植策略', description: '选种策略、种子优先级与预留规则',
    icon: 1018, tone: 'green', kind: 'strategy' as const, // 幼苗：选种与种植
    keys: [] as readonly string[],
  },
  {
    id: 'cadence', title: '执行节奏', description: '巡查间隔、静默时段与种植/偷菜延迟',
    icon: 4002, tone: 'blue', kind: 'strategy' as const, // 闪电：速度与节奏
    keys: [] as readonly string[],
  },
  {
    id: 'farm', title: '日常农场', description: '巡田、种植、任务与产出处理',
    icon: 1021, tone: 'green', kind: 'automation' as const, // 叶片：农场作物与产出
    keys: farmSwitches.map(s => s.key),
  },
  {
    id: 'fertilizer', title: '施肥管理', description: '施肥策略、范围与化肥补充',
    icon: 1011, tone: 'amber', kind: 'automation' as const, // 化肥桶：施肥
    keys: fertilizerSwitches.map(s => s.key),
  },
  {
    id: 'friends', title: '好友互动', description: '好友农场互动与好友申请',
    icon: 1013, tone: 'blue', kind: 'automation' as const, // 爱心：好友互动
    keys: ['friend', ...friendActionSwitches.map(s => s.key), 'friend_auto_accept'],
  },
  {
    id: 'shop', title: '神秘商人', description: '自动购买与到货/购买提醒',
    icon: 1030, tone: 'violet', kind: 'automation' as const, // 宝箱：商人与购买
    keys: [...mysteryShopSwitches.map(s => s.key), ...mysteryShopCurrencySwitches.map(s => s.key)],
  },
  {
    id: 'ranch', title: '牧场', description: '收获、催产、补草、喂养与好友互动',
    icon: 60001, tone: 'amber', kind: 'automation' as const, // 小鸡：牧场
    keys: [...ranchSwitches.map(s => s.key), ...ranchFriendSwitches.map(s => s.key)],
  },
] as const

// 自动化设置总图标：4001 金色齿轮星，顶栏标记与设置页入口一致。
const automationMarkId = 4001

// 服务器同款道具图：与全项目统一走 /game-config/seed_images_named/seed_images/{id}.png
const gameImg = (id: number | string) => `/game-config/seed_images_named/seed_images/${id}.png`

const activeSection = ref<string>('planting')
const activeSectionMeta = computed(() => sectionConfig.find(s => s.id === activeSection.value) ?? sectionConfig[0])

function enabledCount(keys: readonly string[]): number {
  return keys.reduce((count, key) => count + ((settings.value.automation as any)[key] ? 1 : 0), 0)
}
</script>

<template>
  <div class="automation-center">
    <!-- 顶部常驻保存栏 -->
    <div class="automation-topbar">
      <div class="automation-topbar__lead">
        <span class="automation-topbar__mark"><img :src="gameImg(automationMarkId)" alt=""></span>
        <div class="min-w-0">
          <div class="automation-topbar__title">
            <span class="automation-topbar__account">{{ accountName || '未选择账号' }}</span>
            <span class="automation-topbar__sep">/</span>
            <span>{{ activeSectionMeta.title }}</span>
          </div>
          <div class="automation-topbar__crumb">
            共 {{ sectionConfig.length }} 组设置 · 修改后点击右上角一次保存全部
          </div>
        </div>
      </div>
      <div class="automation-topbar__actions">
        <BaseButton variant="primary" size="sm" :loading="saving" @click="emit('save')">
          <template #icon>
            <span class="i-carbon-save" />
          </template>
          保存设置
        </BaseButton>
      </div>
    </div>

    <div class="automation-center__body">
      <!-- 左侧分组导航 -->
      <nav class="automation-nav" aria-label="自动控制分组">
        <button
          v-for="section in sectionConfig"
          :key="section.id"
          type="button"
          class="automation-nav__item"
          :class="{ 'is-active': activeSection === section.id }"
          :aria-current="activeSection === section.id ? 'page' : undefined"
          @click="activeSection = section.id"
        >
          <span class="automation-nav__icon" :class="`is-${section.tone}`">
            <img :src="gameImg(section.icon)" alt="">
          </span>
          <span class="automation-nav__text">
            <span class="automation-nav__title">{{ section.title }}</span>
            <span class="automation-nav__desc">{{ section.description }}</span>
          </span>
          <span v-if="section.kind === 'strategy'" class="automation-nav__tag">设置</span>
          <span v-else class="automation-nav__count">{{ enabledCount(section.keys) }}/{{ section.keys.length }}</span>
        </button>
      </nav>

      <!-- 右侧单面板 -->
      <div class="automation-panels">
        <!-- 种植策略 -->
        <section v-if="activeSection === 'planting'" class="automation-panel">
          <AutomationSectionHeader title="种植策略" description="选种策略、背包种子优先级与预留规则" tone="green">
            <img :src="gameImg(1018)" alt="">
          </AutomationSectionHeader>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseSelect
              v-model="strategy.plantingStrategy"
              label="种植策略"
              :options="strategyForm.plantingStrategyOptions"
            />
            <BaseSelect
              v-if="strategy.plantingStrategy === 'preferred'"
              v-model="strategy.preferredSeedId"
              label="优先种植种子"
              :options="strategyForm.preferredSeedOptions.value"
            />
            <BaseSelect
              v-else-if="strategy.plantingStrategy === 'bag_priority' && strategy.bagSeedFallbackStrategy === 'preferred'"
              v-model="strategy.preferredSeedId"
              label="优先种植种子"
              :options="strategyForm.preferredSeedOptions.value"
              @change="strategyForm.handlePreferredSeedChange"
            />
            <div v-else class="flex flex-col gap-1.5">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                {{ strategy.plantingStrategy === 'bag_priority' ? '第二优先策略预览' : '策略选种预览' }}
              </label>
              <div class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
                <span class="truncate">{{ strategyForm.strategyPreviewLabel.value ?? '加载中...' }}</span>
                <span class="shrink-0 text-lg text-gray-400">▼</span>
              </div>
            </div>
          </div>

          <div v-if="strategy.plantingStrategy === 'bag_priority'" class="panel-stack">
            <BaseSelect
              v-model="strategy.bagSeedFallbackStrategy"
              label="第二优先策略"
              :options="strategyForm.bagFallbackStrategyOptions"
              @change="strategyForm.handleBagFallbackStrategyChange"
            />
            <div class="panel-hint panel-hint--amber">
              <BaseSwitch
                v-model="strategy.bagSeedMultiLandReservationEnabled"
                label="为高优先级多格种子预留土地"
              />
              <p class="panel-note">
                开启后可能暂时留空部分土地，直到明确排在前面的多格种子凑齐连续布局。默认关闭。
              </p>
            </div>
            <div class="panel-hint panel-hint--amber">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="panel-hint__heading">
                    背包种子优先顺序
                  </div>
                  <p class="panel-note">
                    先按下方顺序消耗背包中的 1x1 / 2x2 种子；背包种子不足时，再按第二优先策略补种。
                  </p>
                  <p class="panel-note">
                    配了土地限制的种子会先占用它能种的地块，再由不限制的种子使用剩余空地。
                  </p>
                </div>
                <NButton size="tiny" type="warning" secondary @click="strategyForm.resetBagSeedPriority">
                  重置顺序
                </NButton>
              </div>
              <div v-if="strategyForm.bagSeedsLoading.value" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
                加载中...
              </div>
              <div v-else-if="strategyForm.bagSeedsError.value" class="py-4 text-center text-sm text-red-600 dark:text-red-400">
                {{ strategyForm.bagSeedsError.value }}
              </div>
              <div v-else-if="strategyForm.bagSeeds.value.length === 0" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
                背包中暂无 1x1 / 2x2 种子
              </div>
              <div v-else class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <BagSeedPriorityItem
                  v-for="(seed, index) in strategyForm.sortedBagSeeds.value"
                  :key="seed.seedId"
                  :seed="seed"
                  :index="index"
                  :land-types="strategy.bagSeedLandTypes[String(seed.seedId)]"
                  :land-type-options="fertilizerLandTypeOptions"
                  :dragging="strategyForm.draggingBagSeedId.value === seed.seedId"
                  :can-move-up="index > 0"
                  :can-move-down="index < strategyForm.sortedBagSeeds.value.length - 1"
                  @move-up="strategyForm.moveBagSeedUp(seed.seedId)"
                  @move-down="strategyForm.moveBagSeedDown(seed.seedId)"
                  @update:land-types="strategyForm.setBagSeedLandTypes(seed.seedId, $event)"
                  @drag-start="strategyForm.startBagSeedDrag(seed.seedId, $event)"
                  @drag-end="strategyForm.endBagSeedDrag"
                  @drag-over="strategyForm.dragOverBagSeed(seed.seedId, $event)"
                  @drop="strategyForm.dropBagSeed(seed.seedId, $event)"
                />
              </div>
              <div v-if="strategyForm.orphanRestrictedSeeds.value.length > 0" class="border-t border-amber-200 pt-2 dark:border-amber-800/50">
                <div class="text-xs text-amber-800 dark:text-amber-300">
                  未持有但已配限制
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="item in strategyForm.orphanRestrictedSeeds.value"
                    :key="item.seedId"
                    class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  >
                    {{ item.name }} · {{ item.scope }}
                    <button
                      type="button"
                      class="i-carbon-close text-amber-600 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
                      :title="`清除 ${item.name} 的土地限制`"
                      :aria-label="`清除 ${item.name} 的土地限制`"
                      @click="strategyForm.setBagSeedLandTypes(item.seedId, [])"
                    />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 执行节奏 -->
        <section v-else-if="activeSection === 'cadence'" class="automation-panel">
          <AutomationSectionHeader title="执行节奏" description="巡查间隔、静默时段与种植/偷菜延迟" tone="blue">
            <img :src="gameImg(4002)" alt="">
          </AutomationSectionHeader>

          <div class="panel-hint__heading">
            巡查间隔
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BaseInput v-model.number="strategy.intervals.farmMin" label="农场巡查最小 (秒)" type="number" min="1" />
            <BaseInput v-model.number="strategy.intervals.farmMax" label="农场巡查最大 (秒)" type="number" min="1" />
            <BaseInput v-model.number="strategy.intervals.friendMin" label="好友任务最小 (秒)" type="number" min="1" />
            <BaseInput v-model.number="strategy.intervals.friendMax" label="好友任务最大 (秒)" type="number" min="1" />
          </div>

          <div class="panel-subsection">
            <div class="flex flex-wrap items-center gap-4">
              <BaseSwitch v-model="strategy.friendQuietHours.enabled" label="启用静默时段" />
              <div class="flex items-center gap-2">
                <NTimePicker
                  v-model:formatted-value="strategy.friendQuietHours.start"
                  class="w-28"
                  format="HH:mm"
                  value-format="HH:mm"
                  :clearable="false"
                  :disabled="!strategy.friendQuietHours.enabled"
                  size="small"
                />
                <span class="text-xs text-gray-500">-</span>
                <NTimePicker
                  v-model:formatted-value="strategy.friendQuietHours.end"
                  class="w-28"
                  format="HH:mm"
                  value-format="HH:mm"
                  :clearable="false"
                  :disabled="!strategy.friendQuietHours.enabled"
                  size="small"
                />
              </div>
              <BaseSwitch
                v-model="strategy.friendQuietHours.continueFarm"
                label="静默时继续农场巡查"
                :disabled="!strategy.friendQuietHours.enabled"
              />
            </div>
          </div>

          <div class="panel-subsection">
            <h4 class="panel-subsection__title">
              种植与偷菜延迟
            </h4>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <BaseSwitch v-model="strategy.plantOrderRandom" label="种植顺序随机" />
              <BaseInput v-model.number="strategy.plantDelaySeconds" label="种植延迟 (秒)" type="number" min="0" max="60" />
              <BaseInput v-model.number="strategy.stealDelaySeconds" label="偷菜延迟 (秒)" type="number" min="0" max="300" />
            </div>
          </div>
        </section>

        <!-- 日常农场 -->
        <section v-else-if="activeSection === 'farm'" class="automation-panel">
          <AutomationSectionHeader title="日常农场" description="管理巡田、种植、任务和产出处理" tone="green">
            <img :src="gameImg(1021)" alt="">
          </AutomationSectionHeader>
          <div class="setting-grid">
            <div
              v-for="item in farmSwitches"
              :key="item.key"
              class="setting-tile"
              :class="{ 'sm:col-span-2': item.span }"
            >
              <BaseSwitch v-model="(settings.automation as any)[item.key]" :label="item.label" />
            </div>
          </div>
        </section>

        <!-- 施肥管理 -->
        <section v-else-if="activeSection === 'fertilizer'" class="automation-panel">
          <AutomationSectionHeader title="施肥管理" description="设置施肥策略、范围和化肥补充" tone="amber">
            <img :src="gameImg(1011)" alt="">
          </AutomationSectionHeader>

          <div class="setting-grid">
            <div v-for="item in fertilizerSwitches" :key="item.key" class="setting-tile">
              <BaseSwitch
                v-model="(settings.automation as any)[item.key]"
                :label="item.label"
                :disabled="item.key === 'fertilizer_multi_season' && ripeningOnly"
              />
            </div>
          </div>

          <div
            v-if="settings.automation.fertilizer_buy_organic || settings.automation.fertilizer_buy_normal"
            class="panel-hint panel-hint--green"
          >
            <div v-if="settings.automation.fertilizer_buy_organic" class="panel-hint__block">
              <div class="panel-hint__heading">
                有机化肥设置
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BaseInput v-model.number="settings.fertilizerBuyOrganicCount" label="购买数量" type="number" min="1" max="10000" />
                <BaseInput v-model.number="settings.fertilizerBuyOrganicThresholdHours" label="触发阈值 (小时)" type="number" min="1" max="990" />
              </div>
            </div>
            <div v-if="settings.automation.fertilizer_buy_normal" class="panel-hint__block">
              <div class="panel-hint__heading">
                无机化肥设置
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BaseInput v-model.number="settings.fertilizerBuyNormalCount" label="购买数量" type="number" min="1" max="10000" />
                <BaseInput v-model.number="settings.fertilizerBuyNormalThresholdHours" label="触发阈值 (小时)" type="number" min="1" max="990" />
              </div>
            </div>
            <BaseInput v-model.number="settings.fertilizerBuyCheckIntervalMinutes" label="检测间隔 (分钟)" type="number" min="1" max="1440" />
            <p class="panel-note">
              系统会按检测间隔检查化肥余量，低于阈值时自动购买。两种化肥同时开启时优先购买有机化肥。
            </p>
          </div>

          <div class="panel-hint panel-hint--amber">
            <div class="panel-hint__heading">
              施肥范围
            </div>
            <NCheckboxGroup v-model:value="settings.automation.fertilizer_land_types">
              <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
                <NCheckbox
                  v-for="option in fertilizerLandTypeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </NCheckbox>
              </div>
            </NCheckboxGroup>
            <p class="panel-note">
              仅对选中土地类型的地块执行施肥策略。
            </p>
          </div>

          <div class="panel-stack">
            <BaseSelect v-model="settings.automation.fertilizer" label="施肥策略" :options="fertilizerOptions" />
            <div
              v-if="ripeningEnabled"
              class="flex flex-wrap gap-4 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20"
            >
              <BaseInput
                v-model.number="settings.automation.fertilizer_smart_seconds"
                label="快成熟判定秒数"
                type="number"
                min="30"
                max="3600"
                class="w-40"
              />
              <span class="flex items-end pb-2 text-xs text-gray-500 dark:text-gray-400">
                距离成熟时间 ≤ 此秒数时施{{ ripeningFertilizerLabel }}（默认 300 秒）
              </span>
              <p v-if="ripeningOnly" class="w-full text-xs text-gray-500 dark:text-gray-400">
                只在巡田时催熟，不在播种后提前施肥；每季独立判断，不受「多季补肥」开关影响。
              </p>
            </div>
          </div>
        </section>

        <!-- 好友互动 -->
        <section v-else-if="activeSection === 'friends'" class="automation-panel">
          <AutomationSectionHeader title="好友互动" description="管理好友农场互动和好友申请" tone="blue">
            <img :src="gameImg(1013)" alt="">
          </AutomationSectionHeader>

          <div class="setting-grid">
            <div class="setting-tile sm:col-span-2">
              <BaseSwitch v-model="settings.automation.friend" label="自动好友互动" />
            </div>
          </div>
          <div v-if="settings.automation.friend" class="panel-hint panel-hint--blue">
            <div class="panel-hint__heading">
              互动行为
            </div>
            <div class="setting-grid">
              <div v-for="item in friendActionSwitches" :key="item.key" class="setting-tile">
                <BaseSwitch v-model="(settings.automation as any)[item.key]" :label="item.label" />
              </div>
            </div>
          </div>

          <div class="panel-hint panel-hint--blue">
            <BaseSwitch v-model="settings.automation.friend_auto_accept" label="自动通过好友申请" />
            <template v-if="settings.automation.friend_auto_accept">
              <div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                <BaseInput v-model.number="settings.autoAcceptFriendMinLevel" label="最低等级" type="number" min="0" max="200" />
                <BaseSwitch v-model="settings.autoAcceptRequireOwnLevel" label="不低于自己等级" />
              </div>
              <p class="panel-note">
                最低等级设为 0 表示不限制固定等级；开启等级条件时需同时满足所有条件。
              </p>
              <div class="flex flex-wrap items-end gap-3">
                <BaseSwitch v-model="settings.autoAcceptHarvestStealEnabled" label="收偷比过滤" />
                <BaseInput
                  v-model.number="settings.autoAcceptHarvestStealHarvest"
                  label="收获"
                  type="number"
                  min="0"
                  max="9999"
                  class="w-28"
                  :disabled="!settings.autoAcceptHarvestStealEnabled"
                />
                <span class="pb-2 text-xs text-gray-500 dark:text-gray-400">:</span>
                <BaseInput
                  v-model.number="settings.autoAcceptHarvestStealSteal"
                  label="偷菜"
                  type="number"
                  min="1"
                  max="9999"
                  class="w-28"
                  :disabled="!settings.autoAcceptHarvestStealEnabled"
                />
              </div>
              <p class="panel-note">
                默认按 8:1 比较收获/偷菜数量，不合格的申请会直接拒绝。
              </p>
            </template>
          </div>
        </section>

        <!-- 神秘商人 -->
        <section v-else-if="activeSection === 'shop'" class="automation-panel">
          <AutomationSectionHeader title="神秘商人" description="自动购买商品并接收相关提醒" tone="violet">
            <img :src="gameImg(1030)" alt="">
          </AutomationSectionHeader>

          <div class="setting-grid">
            <div
              v-for="item in mysteryShopSwitches"
              :key="item.key"
              class="setting-tile"
              :class="{ 'sm:col-span-2': item.span }"
            >
              <BaseSwitch
                v-model="(settings.automation as any)[item.key]"
                :label="item.label"
                :disabled="item.key === 'mystery_shop_purchase_notify' && !settings.automation.mystery_shop_auto_buy"
              />
            </div>
          </div>

          <div v-if="settings.automation.mystery_shop_auto_buy" class="panel-hint panel-hint--neutral">
            <div class="panel-hint__heading">
              允许使用的货币
            </div>
            <div class="setting-grid">
              <div v-for="item in mysteryShopCurrencySwitches" :key="item.key" class="setting-tile">
                <BaseSwitch v-model="(settings.automation as any)[item.key]" :label="item.label" />
              </div>
            </div>
            <p class="panel-note">
              自动购买会先按标价币种筛选，再检查余额是否足够；提醒使用「用户设置 → 事件通知」的推送渠道。
            </p>
          </div>
          <p v-else class="panel-note panel-note--standalone">
            到货提醒可单独开启；购买提醒需先打开自动购买。
          </p>
        </section>

        <!-- 牧场 -->
        <section v-else class="automation-panel">
          <AutomationSectionHeader title="牧场" description="收获、催产、补草、喂养、清理与好友互动" tone="amber">
            <img :src="gameImg(60001)" alt="">
          </AutomationSectionHeader>

          <div class="setting-grid">
            <div v-for="{ key, label } in ranchSwitches" :key="key" class="setting-tile">
              <BaseSwitch
                v-model="(settings.automation as any)[key]"
                :label="label"
                :disabled="key === 'ranch_grass_buy' && !settings.automation.ranch_grass"
              />
            </div>
            <div class="col-span-full panel-note">
              两种兑换可独立开启；松果按 8 小时、4 小时、1 小时兑换，粑粑按 4 小时、1 小时兑换。到访或货币到账后排队，登录、重连和日常巡查时核对集市状态。
            </div>
            <div class="setting-tile">
              <NInputNumber v-model:value="settings.automation.ranch_check_minutes" :min="1" :max="60" :step="1" class="w-full">
                <template #prefix>
                  巡查间隔
                </template>
              </NInputNumber>
            </div>
          </div>

          <div class="panel-subsection">
            <h4 class="panel-subsection__title">
              好友互动
            </h4>
            <div class="setting-grid">
              <div v-for="{ key, label } in ranchFriendSwitches" :key="key" class="setting-tile">
                <BaseSwitch v-model="(settings.automation as any)[key]" :label="label" />
              </div>
            </div>
          </div>

          <div class="panel-stack">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BaseSelect v-model="settings.automation.ranch_strategy" label="养殖策略" :options="RANCH_STRATEGIES" />
              <BaseSelect
                v-if="settings.automation.ranch_strategy === 'bag_priority'"
                v-model="settings.automation.ranch_bag_fallback"
                label="库存不足时"
                :options="RANCH_STRATEGIES.slice(0, 2)"
              />
              <template v-if="settings.automation.ranch_strategy === 'preferred' || (settings.automation.ranch_strategy === 'bag_priority' && settings.automation.ranch_bag_fallback === 'preferred')">
                <BaseSelect
                  v-model="settings.automation.ranch_coop_animal"
                  label="窝 · 指定动物"
                  :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '窝')]"
                />
                <BaseSelect
                  v-model="settings.automation.ranch_shed_animal"
                  label="棚 · 指定动物"
                  :options="[{ value: 0, label: '不购买' }, ...ranchAnimalOptions.filter(animal => animal.kind === '棚')]"
                />
              </template>
            </div>
            <RanchCubPriority
              v-if="settings.automation.ranch_strategy === 'bag_priority'"
              v-model="settings.automation"
              :account-id="accountId"
              :connected="connected"
            />
            <p class="panel-note">
              牧场自动化会把收获/喂养等写操作切到牧场场景再执行；未解锁场景 2 的账号会自动降级为当前场景读取，无需额外设置。
            </p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.automation-center {
  display: grid;
  gap: 16px;
}

/* ── 顶部常驻保存栏 ── */
.automation-topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: color-mix(in srgb, var(--ui-surface-strong) 88%, transparent);
  box-shadow: var(--ui-shadow-sm);
  backdrop-filter: blur(12px);
}

.automation-topbar__lead {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.automation-topbar__mark {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: var(--ui-primary-soft);
}

.automation-topbar__mark img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.automation-topbar__title {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 15px;
  font-weight: var(--fw-700);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-topbar__account {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-topbar__sep {
  color: var(--ui-border-strong);
}

.automation-topbar__crumb {
  margin-top: 2px;
  color: var(--ui-muted);
  font-size: 12px;
}

.automation-topbar__actions {
  flex-shrink: 0;
}

/* ── 两栏主体 ── */
.automation-center__body {
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  align-items: start;
  gap: 16px;
}

/* ── 左侧分组导航 ── */
.automation-nav {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
}

.automation-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-ink);
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.automation-nav__item:hover {
  background: var(--ui-surface-soft);
}

.automation-nav__item.is-active {
  border-color: color-mix(in srgb, var(--ui-primary) 28%, transparent);
  background: var(--ui-primary-soft);
}

.automation-nav__icon {
  display: flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  font-size: 18px;
}

.automation-nav__icon img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.automation-nav__icon.is-green { color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 14%, transparent); }
.automation-nav__icon.is-amber { color: #b45309; background: rgb(245 158 11 / 14%); }
.automation-nav__icon.is-blue { color: #2563eb; background: rgb(59 130 246 / 14%); }
.automation-nav__icon.is-violet { color: #7c3aed; background: rgb(139 92 246 / 14%); }
:global(.dark) .automation-nav__icon.is-amber { color: #fcd34d; }
:global(.dark) .automation-nav__icon.is-blue { color: #93c5fd; }
:global(.dark) .automation-nav__icon.is-violet { color: #c4b5fd; }

.automation-nav__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.automation-nav__title {
  font-size: 13px;
  font-weight: var(--fw-700);
}

.automation-nav__desc {
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-nav__count {
  flex-shrink: 0;
  color: var(--ui-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.automation-nav__item.is-active .automation-nav__count {
  color: var(--ui-primary);
  font-weight: var(--fw-700);
}

.automation-nav__tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font-size: 10px;
}

.automation-nav__item.is-active .automation-nav__tag {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

/* ── 右侧面板 ── */
.automation-panels {
  min-width: 0;
}

.automation-panel {
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-sm);
}

.setting-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 8px;
}

@media (min-width: 640px) {
  .setting-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.setting-tile {
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-control);
  background: color-mix(in srgb, var(--ui-surface-strong) 58%, transparent);
}

.panel-hint {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 14px;
  border-radius: 12px;
}

.panel-hint--green { background: rgb(34 139 96 / 8%); }
.panel-hint--amber { border: 1px solid rgb(245 158 11 / 30%); background: rgb(245 158 11 / 8%); }
.panel-hint--blue { background: rgb(59 130 246 / 8%); }
.panel-hint--neutral { background: var(--ui-surface-soft); }

.panel-hint__block {
  display: grid;
  gap: 8px;
}

.panel-hint__heading {
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: var(--fw-700);
}

.panel-hint--green .panel-hint__heading { color: #157f52; }
:global(.dark) .panel-hint--green .panel-hint__heading { color: #6ee7a8; }
.panel-hint--blue .panel-hint__heading { color: #2563eb; }
:global(.dark) .panel-hint--blue .panel-hint__heading { color: #93c5fd; }

.panel-note {
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.5;
}

.panel-note--standalone {
  margin-top: 14px;
}

.panel-stack {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.panel-subsection {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}

.panel-subsection__title {
  margin-bottom: 10px;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-700);
}

/* ── 窄屏：导航转横向标签 ── */
@media (max-width: 900px) {
  .automation-center__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .automation-nav {
    position: static;
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
  }

  .automation-nav__item {
    width: auto;
    flex: 0 0 auto;
    min-width: 0;
  }

  .automation-nav__icon {
    width: 30px;
    height: 30px;
    font-size: 16px;
  }

  .automation-nav__desc {
    display: none;
  }

  .automation-topbar {
    position: static;
  }
}

@media (max-width: 520px) {
  .automation-topbar__crumb {
    display: none;
  }

  .automation-topbar__title {
    font-size: 14px;
  }
}
</style>
