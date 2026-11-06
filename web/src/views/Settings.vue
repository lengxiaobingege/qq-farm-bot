<script setup lang="ts">
import { NTab } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmModal from '@/components/ConfirmModal.vue'
import PageTabs from '@/components/PageTabs.vue'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import { useAccountStore } from '@/stores/account'
import AccountTab from '@/views/settings/AccountTab.vue'
import AutomationTab from '@/views/settings/AutomationTab.vue'
import StrategyTab from '@/views/settings/StrategyTab.vue'
import SystemTab from '@/views/settings/SystemTab.vue'

// 设置页薄壳：只负责 Tab 切换、账号列表初始化与提示弹窗渲染。
// 各 Tab 的表单状态与逻辑见 src/views/settings/ 下的四个子组件；
// 跨 Tab 共享的本地状态见 src/components/settings/settings-local-state.ts。
const { modalVisible, modalConfig } = useSettingsAlert()

const router = useRouter()
const route = useRoute()
const accountStore = useAccountStore()

type SettingsTab = 'account' | 'strategy' | 'automation' | 'system'
const storedTab = localStorage.getItem('settings-active-tab')
const settingsTabKeys: SettingsTab[] = ['account', 'strategy', 'automation', 'system']
const queryTab = String(route.query.tab || '')
const initialTab = settingsTabKeys.includes(queryTab as SettingsTab)
  ? queryTab as SettingsTab
  : storedTab === 'user' ? 'system' : (storedTab as SettingsTab) || 'account'
const activeTab = ref<SettingsTab>(initialTab)

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
  if (String(route.query.tab || '') !== newTab) {
    router.replace({
      query: { ...route.query, tab: newTab },
    })
  }
})

watch(() => route.query.tab, (value) => {
  const nextTab = String(value || '')
  if (settingsTabKeys.includes(nextTab as SettingsTab) && nextTab !== activeTab.value)
    activeTab.value = nextTab as SettingsTab
})

const tabs = [
  { key: 'account', label: '账号管理', icon: 'i-carbon-user-profile' },
  { key: 'strategy', label: '策略设置', icon: 'i-carbon-settings-adjust' },
  { key: 'automation', label: '自动控制', icon: 'i-carbon-settings-adjust' },
  { key: 'system', label: '系统设置', icon: 'i-carbon-settings' },
] as const

function setActiveTab(value: string) {
  if (tabs.some(tab => tab.key === value))
    activeTab.value = value as typeof activeTab.value
}

onMounted(async () => {
  await accountStore.fetchAccounts()
  const { accounts, currentAccountId } = storeToRefs(accountStore)
  if (!currentAccountId.value && accounts.value.length > 0 && accounts.value[0]) {
    accountStore.selectAccount(String(accounts.value[0].id))
  }
})
</script>

<template>
  <div class="settings-page page-stack">
    <div class="settings-content">
      <PageTabs :value="activeTab" @update:value="setActiveTab">
        <NTab v-for="tab in tabs" :key="tab.key" :name="tab.key">
          <span class="inline-flex items-center gap-2">
            <span :class="tab.icon" />
            {{ tab.label }}
          </span>
        </NTab>
      </PageTabs>

      <div class="settings-body">
        <AccountTab v-if="activeTab === 'account'" />
        <StrategyTab v-else-if="activeTab === 'strategy'" />
        <AutomationTab v-else-if="activeTab === 'automation'" />
        <SystemTab v-else-if="activeTab === 'system'" />
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>
