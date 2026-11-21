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
import AutomationCenterTab from '@/views/settings/AutomationCenterTab.vue'
import SystemTab from '@/views/settings/SystemTab.vue'

// 设置页薄壳：只负责 Tab 切换、账号列表初始化与提示弹窗渲染。
// 各 Tab 的表单状态与逻辑见 src/views/settings/ 下的子组件；
// 「策略设置」与「自动控制」已彻底合并为单一「自动化设置」（AutomationCenterTab），
// 同一份表单、同一套分组导航、一次保存；跨 Tab 共享的本地状态见 settings-local-state.ts。
const { modalVisible, modalConfig } = useSettingsAlert()

const router = useRouter()
const route = useRoute()
const accountStore = useAccountStore()

type SettingsTab = 'account' | 'automation' | 'system'
const settingsTabKeys: SettingsTab[] = ['account', 'automation', 'system']
// 兼容旧链接/旧本地值：strategy、automation 都归入新的「自动化设置」。
const LEGACY_AUTOMATION_TABS = new Set(['strategy', 'automation'])
function normalizeTab(value: string): SettingsTab | null {
  if (!value) return null
  if (LEGACY_AUTOMATION_TABS.has(value)) return 'automation'
  if (value === 'user') return 'system'
  return settingsTabKeys.includes(value as SettingsTab) ? value as SettingsTab : null
}
const storedTab = localStorage.getItem('settings-active-tab')
const initialTab = normalizeTab(String(route.query.tab || ''))
  || normalizeTab(storedTab || '')
  || 'account'
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
  const nextTab = normalizeTab(String(value || ''))
  if (nextTab && nextTab !== activeTab.value)
    activeTab.value = nextTab
})

const tabs = [
  { key: 'account', label: '账号管理', icon: 'i-carbon-user-profile' },
  // 与其他 tab 保持同一套简约线性图标，避免单独用彩色道具图显得突兀。
  { key: 'automation', label: '自动化设置', icon: 'i-carbon-settings-adjust' },
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
      <PageTabs :value="activeTab" class="settings-page-tabs" @update:value="setActiveTab">
        <NTab v-for="tab in tabs" :key="tab.key" :name="tab.key">
          <span class="inline-flex items-center justify-center gap-2">
            <span :class="tab.icon" />
            {{ tab.label }}
          </span>
        </NTab>
      </PageTabs>

      <div class="settings-body">
        <AccountTab v-if="activeTab === 'account'" />
        <AutomationCenterTab v-else-if="activeTab === 'automation'" />
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
