import { ref } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'

// Settings 页四个 Tab 共用的本地表单状态（模块级单例）。
// 三份 local* 与 store 中 settings 的同步由 sync* 函数完成；
// 拉取 + 三方同步统一走 loadAccountSettings()，保持原页面「一次拉取、三处同步」的行为。

const fertilizerLandTypeOptions = [
  { label: '蓝晶土地', value: 'blue-crystal' },
  { label: '紫金土地', value: 'purple-gold' },
  { label: '金土地', value: 'gold' },
  { label: '黑土地', value: 'black' },
  { label: '红土地', value: 'red' },
  { label: '普通土地', value: 'normal' },
]

const allFertilizerLandTypes = ['blue-crystal', 'purple-gold', 'gold', 'black', 'red', 'normal']
const defaultFertilizerLandTypes = allFertilizerLandTypes.filter(type => type !== 'blue-crystal')

const fertilizerOptions = [
  { label: '普通 + 有机', value: 'both' },
  { label: '普通 + 快成熟有机', value: 'smart' },
  { label: '仅普通化肥', value: 'normal' },
  { label: '仅有机化肥', value: 'organic' },
  { label: '不施肥', value: 'none' },
]

const automationSaving = ref(false)

const localStrategySettings = ref({
  plantingStrategy: 'max_exp',
  preferredSeedId: 0,
  bagSeedPriority: [] as number[],
  bagSeedMultiLandReservationEnabled: false,
  bagSeedLandTypes: {} as Record<string, string[]>,
  bagSeedFallbackStrategy: 'level',
  stealDelaySeconds: 0,
  plantOrderRandom: false,
  plantDelaySeconds: 0,
  intervals: { farmMin: 2, farmMax: 5, friendMin: 10, friendMax: 15 },
  friendQuietHours: { enabled: false, start: '23:00', end: '07:00', continueFarm: true },
})

const localAutomationSettings = ref({
  automation: {
    farm: false,
    farm_harvest_tiangong: true,
    task: false,
    sell: true,
    friend: false,
    friend_auto_accept: true,
    farm_push: false,
    land_upgrade: true,
    friend_steal: false,
    friend_help: false,
    friend_bad: true,
    friend_help_exp_limit: false,
    friend_help_protect_dog_ignore_exp_limit: true,
    fertilizer_gift: false,
    fertilizer_buy_organic: false,
    fertilizer_buy_normal: false,
    mystery_shop_auto_buy: false,
    mystery_shop_allow_gold: true,
    mystery_shop_allow_coupon: false,
    mystery_shop_allow_gold_bean: false,
    mystery_shop_allow_diamond: false,
    mystery_shop_arrival_notify: false,
    mystery_shop_purchase_notify: false,
    fertilizer: 'normal',
    skip_own_weed_bug: false,
    fertilizer_multi_season: false,
    fertilizer_land_types: [...defaultFertilizerLandTypes],
    fertilizer_smart_seconds: 300,
    show_manual_fertilizer: true,
  },
  fertilizerBuyOrganicCount: 10,
  fertilizerBuyOrganicThresholdHours: 10,
  fertilizerBuyNormalCount: 10,
  fertilizerBuyNormalThresholdHours: 10,
  fertilizerBuyCheckIntervalMinutes: 30,
  autoAcceptFriendMinLevel: 0,
  autoAcceptRequireOwnLevel: false,
  autoAcceptHarvestStealEnabled: true,
  autoAcceptHarvestStealHarvest: 8,
  autoAcceptHarvestStealSteal: 1,
})

const localEventNotify = ref({
  channel: 'webhook',
  endpoint: '',
  token: '',
  secret: '',
  title: '',
  msg: '',
  offlineDeleteSec: 0,
})

function normalizeFertilizerLandTypes(input: unknown) {
  const source = Array.isArray(input) ? input : defaultFertilizerLandTypes
  const normalized: string[] = []
  for (const item of source) {
    const value = String(item || '').trim().toLowerCase()
    if (!allFertilizerLandTypes.includes(value))
      continue
    if (normalized.includes(value))
      continue
    normalized.push(value)
  }
  return normalized
}

function syncLocalStrategySettings() {
  const settingStore = useSettingStore()
  const settings = settingStore.settings
  if (settings) {
    localStrategySettings.value = JSON.parse(JSON.stringify({
      plantingStrategy: settings.plantingStrategy,
      preferredSeedId: settings.preferredSeedId,
      bagSeedPriority: settings.bagSeedPriority ?? [],
      bagSeedMultiLandReservationEnabled: !!settings.bagSeedMultiLandReservationEnabled,
      bagSeedLandTypes: settings.bagSeedLandTypes ?? {},
      bagSeedFallbackStrategy: settings.bagSeedFallbackStrategy ?? 'level',
      stealDelaySeconds: settings.stealDelaySeconds ?? 0,
      plantOrderRandom: !!settings.plantOrderRandom,
      plantDelaySeconds: settings.plantDelaySeconds ?? 0,
      intervals: settings.intervals,
      friendQuietHours: {
        enabled: false,
        start: '23:00',
        end: '07:00',
        continueFarm: true,
        ...(settings.friendQuietHours || {}),
      },
    }))
  }
}

function syncLocalAutomationSettings() {
  const settingStore = useSettingStore()
  const settings = settingStore.settings
  if (settings) {
    if (!settings.automation) {
      localAutomationSettings.value.automation = {
        farm: false,
        farm_harvest_tiangong: true,
        task: false,
        sell: false,
        friend: false,
        friend_auto_accept: true,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        friend_help_protect_dog_ignore_exp_limit: true,
        fertilizer_gift: false,
        fertilizer_buy_organic: false,
        fertilizer_buy_normal: false,
        mystery_shop_auto_buy: false,
        mystery_shop_allow_gold: true,
        mystery_shop_allow_coupon: false,
        mystery_shop_allow_gold_bean: false,
        mystery_shop_allow_diamond: false,
        mystery_shop_arrival_notify: false,
        mystery_shop_purchase_notify: false,
        fertilizer: 'none',
        skip_own_weed_bug: false,
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
        fertilizer_smart_seconds: 300,
        show_manual_fertilizer: true,
      }
    }
    else {
      const defaults = {
        farm: false,
        farm_harvest_tiangong: true,
        task: false,
        sell: false,
        friend: false,
        friend_auto_accept: true,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        friend_help_protect_dog_ignore_exp_limit: true,
        fertilizer_gift: false,
        fertilizer_buy_organic: false,
        fertilizer_buy_normal: false,
        mystery_shop_auto_buy: false,
        mystery_shop_allow_gold: true,
        mystery_shop_allow_coupon: false,
        mystery_shop_allow_gold_bean: false,
        mystery_shop_allow_diamond: false,
        mystery_shop_arrival_notify: false,
        mystery_shop_purchase_notify: false,
        fertilizer: 'none',
        skip_own_weed_bug: false,
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
        fertilizer_smart_seconds: 300,
        show_manual_fertilizer: true,
      }
      localAutomationSettings.value.automation = {
        ...defaults,
        ...settings.automation,
      }
    }
    localAutomationSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localAutomationSettings.value.automation.fertilizer_land_types)
    if (localAutomationSettings.value.automation.fertilizer_smart_seconds === undefined) {
      localAutomationSettings.value.automation.fertilizer_smart_seconds = 300
    }
    if (localAutomationSettings.value.automation.show_manual_fertilizer === undefined) {
      localAutomationSettings.value.automation.show_manual_fertilizer = true
    }
    localAutomationSettings.value.fertilizerBuyOrganicCount = settings.fertilizerBuyOrganicCount ?? 10
    localAutomationSettings.value.fertilizerBuyOrganicThresholdHours = settings.fertilizerBuyOrganicThresholdHours ?? 10
    localAutomationSettings.value.fertilizerBuyNormalCount = settings.fertilizerBuyNormalCount ?? 10
    localAutomationSettings.value.fertilizerBuyNormalThresholdHours = settings.fertilizerBuyNormalThresholdHours ?? 10
    localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes = settings.fertilizerBuyCheckIntervalMinutes ?? 30
    localAutomationSettings.value.autoAcceptFriendMinLevel = settings.autoAcceptFriendMinLevel ?? 0
    localAutomationSettings.value.autoAcceptRequireOwnLevel = settings.autoAcceptRequireOwnLevel ?? false
    localAutomationSettings.value.autoAcceptHarvestStealEnabled = settings.autoAcceptHarvestStealEnabled ?? true
    localAutomationSettings.value.autoAcceptHarvestStealHarvest = settings.autoAcceptHarvestStealHarvest ?? 8
    localAutomationSettings.value.autoAcceptHarvestStealSteal = settings.autoAcceptHarvestStealSteal ?? 1
  }
}

function syncLocalEventNotify() {
  const settingStore = useSettingStore()
  const settings = settingStore.settings
  if (settings?.eventNotify) {
    const saved = JSON.parse(JSON.stringify(settings.eventNotify))
    const next = {
      channel: 'webhook',
      endpoint: '',
      token: '',
      secret: '',
      title: '',
      msg: '',
      offlineDeleteSec: 0,
      ...saved,
    }

    if (String(next.channel || '').trim().toLowerCase() === 'dingtalk') {
      const legacyToken = String(next.token || '').trim()
      if (!String(next.endpoint || '').trim() && legacyToken) {
        next.endpoint = /^https?:\/\//i.test(legacyToken)
          ? legacyToken
          : `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(legacyToken)}`
      }
      next.token = ''
    }

    localEventNotify.value = next
  }
}

function isAccountConnected(accountId: string): boolean {
  const statusStore = useStatusStore()
  return String(statusStore.status?.accountId || '') === String(accountId)
    && statusStore.status?.connection?.connected === true
}

/**
 * 拉取当前账号的设置并在成功后同步三份本地状态。
 * 返回 false 表示账号无效、拉取失败或拉取期间已切换账号。
 */
async function loadAccountSettings(accountId: string): Promise<boolean> {
  if (!accountId)
    return false
  const settingStore = useSettingStore()
  const loaded = await settingStore.fetchSettings(accountId)
  const accountStore = useAccountStore()
  if (!loaded || String(accountStore.currentAccountId || '') !== String(accountId))
    return false
  syncLocalStrategySettings()
  syncLocalAutomationSettings()
  syncLocalEventNotify()
  return true
}

export {
  automationSaving,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  isAccountConnected,
  loadAccountSettings,
  localAutomationSettings,
  localEventNotify,
  localStrategySettings,
  normalizeFertilizerLandTypes,
  syncLocalAutomationSettings,
  syncLocalEventNotify,
  syncLocalStrategySettings,
}
