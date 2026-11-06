<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, watch } from 'vue'
import api from '@/api'
import AutomationSettingsForm from '@/components/settings/AutomationSettingsForm.vue'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import {
  automationSaving,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  loadAccountSettings,
  localAutomationSettings,
  normalizeFertilizerLandTypes,
  syncLocalAutomationSettings,
} from '@/components/settings/settings-local-state'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'

const { showAlert } = useSettingsAlert()

const accountStore = useAccountStore()
const { accounts, currentAccountId } = storeToRefs(accountStore)
const { loading: settingsLoading, loadedAccountId } = storeToRefs(useSettingStore())

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

async function saveAutomationSettings() {
  const accountId = currentAccountId.value
  if (!accountId)
    return
  automationSaving.value = true
  try {
    const payload = JSON.parse(JSON.stringify(localAutomationSettings.value))
    payload.automation.fertilizer_land_types = normalizeFertilizerLandTypes(payload.automation.fertilizer_land_types)
    const res = await useSettingStore().saveSettings(accountId, payload)
    if (accountId !== currentAccountId.value)
      return
    if (res.ok) {
      syncLocalAutomationSettings()
      showAlert('自动控制设置已保存', 'primary')

      // 如果启用了自动购买化肥，立即检测并购买
      if (payload.automation.fertilizer_buy_organic || payload.automation.fertilizer_buy_normal) {
        try {
          const buyRes = await api.post('/api/fertilizer/check-and-buy', {
            buyOrganic: payload.automation.fertilizer_buy_organic,
            buyNormal: payload.automation.fertilizer_buy_normal,
            organicCount: payload.fertilizerBuyOrganicCount,
            organicThresholdHours: payload.fertilizerBuyOrganicThresholdHours,
            normalCount: payload.fertilizerBuyNormalCount,
            normalThresholdHours: payload.fertilizerBuyNormalThresholdHours,
          }, {
            headers: { 'x-account-id': accountId },
          })
          if (accountId === currentAccountId.value && buyRes.data?.ok) {
            const totalBought = (buyRes.data.organicBought || 0) + (buyRes.data.normalBought || 0)
            if (totalBought > 0)
              showAlert(`已自动购买 ${totalBought} 个化肥`, 'primary')
          }
        }
        catch (e) {
          console.error('检测购买化肥失败', e)
        }
      }
    }
    else {
      const message = res.unconfirmed && res.saved
        ? `自动控制已保存，但运行进程尚未确认应用：${res.error || '请稍后重试或重启账号'}`
        : `保存失败: ${res.error}`
      showAlert(message, res.unconfirmed && res.saved ? 'primary' : 'danger')
    }
  }
  finally {
    if (accountId === currentAccountId.value)
      automationSaving.value = false
  }
}

watch(currentAccountId, (accountId) => {
  automationSaving.value = false
  if (accountId)
    loadAccountSettings(accountId)
})

onMounted(() => {
  const accountId = currentAccountId.value
  if (accountId && loadedAccountId.value !== accountId)
    loadAccountSettings(accountId)
  else
    syncLocalAutomationSettings()
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        自动控制
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

    <AutomationSettingsForm
      v-else
      v-model="localAutomationSettings"
      :saving="automationSaving"
      :fertilizer-land-type-options="fertilizerLandTypeOptions"
      :fertilizer-options="fertilizerOptions"
      @save="saveAutomationSettings"
    />
  </div>
</template>
