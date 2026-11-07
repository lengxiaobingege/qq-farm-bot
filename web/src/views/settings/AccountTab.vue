<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import BaseButton from '@/components/ui/BaseButton.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const { showAlert } = useSettingsAlert()

const router = useRouter()
const accountStore = useAccountStore()
const { accounts, loading: accountsLoading, currentAccountId } = storeToRefs(accountStore)
const { status: runtimeStatus } = storeToRefs(useStatusStore())

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const deleteLoading = ref(false)
const editingAccount = ref<any>(null)
const accountToDelete = ref<any>(null)
const showClearStoppedConfirm = ref(false)
const clearStoppedLoading = ref(false)
const accountAvatarErrors = ref<Set<string>>(new Set())

function getAccountAvatar(account: any) {
  const accountId = String(account?.id || '')
  const liveAccountId = String(runtimeStatus.value?.accountId || '')
  const liveAvatar = accountId && accountId === liveAccountId
    ? String(runtimeStatus.value?.status?.avatarUrl || '').trim()
    : ''
  return liveAvatar || String(account?.avatar || '').trim()
}

function canShowAccountAvatar(account: any) {
  const accountId = String(account?.id || '')
  return !!getAccountAvatar(account) && !accountAvatarErrors.value.has(accountId)
}

function handleAccountAvatarError(account: any) {
  const accountId = String(account?.id || '')
  if (accountId)
    accountAvatarErrors.value.add(accountId)
}

// 游戏「角色编号」即 gid；微信账号没有 QQ 号(uin)，回退到微信登录状态
function getAccountIdentity(account: any) {
  const gid = String(account?.gid || '').trim()
  if (gid && gid !== '0')
    return gid
  const uin = String(account?.uin || '').trim()
  const id = String(account?.id || '').trim()
  const idPrefix = id ? `ID ${id} · ` : ''
  if (uin)
    return `${idPrefix}${uin}`
  const openId = String(account?.wxOpenId || '').trim()
  if (openId)
    return `${idPrefix}微信 …${openId.slice(-6)}`
  if (account?.platform === 'wx')
    return `${idPrefix}微信登录${account?.hasLoginBuffer ? '' : '（未保存登录态）'}`
  return `${idPrefix}未绑定`
}

const stoppedAccounts = computed(() => accounts.value.filter((acc: any) => !acc.running))
const stoppedAccountsCount = computed(() => stoppedAccounts.value.length)

onMounted(async () => {
  await accountStore.fetchAccounts()
  if (!currentAccountId.value && accounts.value.length > 0 && accounts.value[0]) {
    accountStore.selectAccount(String(accounts.value[0].id))
  }
})

function openSettings(account: any) {
  accountStore.selectAccount(account.id)
  router.push('/settings')
}

function openAddModal() {
  editingAccount.value = null
  showModal.value = true
}

function openEditModal(account: any) {
  editingAccount.value = { ...account }
  showModal.value = true
}

async function handleDelete(account: any) {
  accountToDelete.value = account
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (accountToDelete.value) {
    try {
      deleteLoading.value = true
      await accountStore.deleteAccount(accountToDelete.value.id)
      accountToDelete.value = null
      showDeleteConfirm.value = false
    }
    finally {
      deleteLoading.value = false
    }
  }
}

async function toggleAccount(account: any) {
  if (account.running) {
    await accountStore.stopAccount(account.id)
  }
  else {
    await accountStore.startAccount(account.id)
  }
}

function handleSaved() {
  accountStore.fetchAccounts()
}

function selectAccount(account: any) {
  if (!account || !account.id)
    return
  accountStore.selectAccount(String(account.id))
}

function openClearStoppedConfirm() {
  if (stoppedAccountsCount.value === 0) {
    showAlert('没有已停止的账号需要清理', 'primary')
    return
  }
  showClearStoppedConfirm.value = true
}

async function confirmClearStopped() {
  clearStoppedLoading.value = true
  try {
    const stoppedIds = stoppedAccounts.value.map((acc: any) => acc.id)
    let deletedCount = 0
    for (const id of stoppedIds) {
      try {
        await accountStore.deleteAccount(id)
        deletedCount++
      }
      catch (e) {
        console.error(`删除账号 ${id} 失败:`, e)
      }
    }
    showClearStoppedConfirm.value = false
    showAlert(`成功清理 ${deletedCount} 个已停止的账号`, 'primary')
    await accountStore.fetchAccounts()
  }
  finally {
    clearStoppedLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        账号管理
      </h3>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="stoppedAccountsCount === 0"
          @click="openClearStoppedConfirm"
        >
          <span class="i-carbon-trash-can mr-2" />
          <span class="hidden sm:inline">一键清理</span>
          <span class="sm:hidden">清理</span>
          ({{ stoppedAccountsCount }})
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          @click="openAddModal"
        >
          <span class="i-carbon-add mr-2" />
          添加账号
        </BaseButton>
      </div>
    </div>

    <div v-if="accountsLoading && accounts.length === 0" class="py-8 text-center text-gray-500">
      <span class="i-carbon-circle-dash mb-2 inline-block animate-spin text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="accounts.length === 0" class="farm-card rounded-2xl bg-white py-12 text-center shadow-md dark:bg-gray-800">
      <div class="i-carbon-user-avatar mb-4 inline-block text-4xl text-gray-400" />
      <p class="mb-4 text-gray-500">
        暂无账号
      </p>
      <BaseButton
        variant="text"
        size="sm"
        @click="openAddModal"
      >
        立即添加
      </BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="cursor-pointer border cartoon-card rounded-2xl bg-white p-3 shadow-md transition-all duration-200 dark:bg-gray-800 sm:p-4"
        :class="String(currentAccountId) === String(acc.id)
          ? 'ring-2'
          : 'border-transparent'"
        :style="String(currentAccountId) === String(acc.id)
          ? { borderColor: 'var(--theme-primary)', backgroundColor: 'rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1)' }
          : {}"
        @click="selectAccount(acc)"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0 flex flex-1 items-center gap-3">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 sm:h-12 sm:w-12 dark:bg-gray-700">
              <img
                v-if="canShowAccountAvatar(acc)"
                :src="getAccountAvatar(acc)"
                class="h-full w-full object-cover"
                @error="handleAccountAvatarError(acc)"
              >
              <span v-else class="i-carbon-user text-xl text-gray-400 sm:text-2xl" />
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate text-base font-bold sm:text-lg">
                {{ acc.name || acc.nick || acc.id }}
              </h4>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  v-if="acc.platform"
                  class="rounded px-1.5 py-0.5 text-[10px] leading-tight font-medium"
                  :class="getPlatformClass(acc.platform)"
                >
                  {{ getPlatformLabel(acc.platform) }}
                </span>
                <span class="truncate text-xs text-gray-500 sm:text-sm">
                  {{ getAccountIdentity(acc) }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
            <span class="flex items-center gap-1 text-xs text-gray-500 sm:hidden">
              <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
              {{ acc.running ? '运行中' : '已停止' }}
            </span>
            <BaseButton
              variant="secondary"
              size="sm"
              class="border rounded-full shadow-sm transition-all duration-500 ease-in-out sm:w-20 active:scale-95"
              :class="acc.running ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 active:border-red-300 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:ring-red-500 dark:active:border-red-700' : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 active:border-green-300 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:focus:ring-green-500 dark:active:border-green-700'"
              @click="toggleAccount(acc)"
            >
              <span class="mr-1" :class="acc.running ? 'i-carbon-stop-filled' : 'i-carbon-play-filled'" />
              {{ acc.running ? '停止' : '启动' }}
            </BaseButton>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 sm:mt-4 dark:border-gray-700 sm:pt-4">
          <div class="hidden items-center gap-2 text-sm text-gray-500 sm:flex">
            <span class="flex items-center gap-1">
              <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
              {{ acc.running ? '运行中' : '已停止' }}
            </span>
          </div>

          <div class="flex flex-1 justify-end gap-1 sm:flex-initial sm:gap-2">
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] !p-2"
              title="设置"
              @click="openSettings(acc)"
            >
              <span class="i-carbon-settings" />
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] !p-2"
              title="编辑"
              @click="openEditModal(acc)"
            >
              <span class="i-carbon-edit" />
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
              title="删除"
              @click="handleDelete(acc)"
            >
              <span class="i-carbon-trash-can" />
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <AccountModal
      :show="showModal"
      :edit-data="editingAccount"
      @close="showModal = false"
      @saved="handleSaved"
    />

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除账号"
      :message="accountToDelete ? `确定要删除账号 ${accountToDelete.name || accountToDelete.id} 吗?` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && (showDeleteConfirm = false)"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    />

    <ConfirmModal
      :show="showClearStoppedConfirm"
      :loading="clearStoppedLoading"
      title="一键清理已停止账号"
      :message="`确定要清理 ${stoppedAccountsCount} 个已停止的账号吗？此操作不可恢复！`"
      confirm-text="确认清理"
      type="danger"
      @close="!clearStoppedLoading && (showClearStoppedConfirm = false)"
      @cancel="!clearStoppedLoading && (showClearStoppedConfirm = false)"
      @confirm="confirmClearStopped"
    />
  </div>
</template>
