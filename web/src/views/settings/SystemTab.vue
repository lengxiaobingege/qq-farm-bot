<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, ref, watch } from 'vue'
import { getApiErrorMessage } from '@/api'
import EventNotifyPanel from '@/components/settings/EventNotifyPanel.vue'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import { loadAccountSettings } from '@/components/settings/settings-local-state'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user'

const { showAlert } = useSettingsAlert()

const { loadedAccountId } = storeToRefs(useSettingStore())
const { currentAccountId } = storeToRefs(useAccountStore())
const userStore = useUserStore()

const passwordSaving = ref(false)

// ── 登录安全：会话有效期与受信任设备 ──
const securityLoading = ref(false)
const securityRevoking = ref(false)
const securityInfo = ref<any>(null)

function formatDateTime(ts?: number): string {
  if (!ts)
    return '—'
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function daysLeft(ts?: number): string {
  if (!ts)
    return '—'
  const left = ts - Date.now()
  if (left <= 0)
    return '已过期'
  const days = Math.floor(left / 86400000)
  if (days >= 1)
    return `${days} 天后`
  return `${Math.max(1, Math.floor(left / 3600000))} 小时后`
}

async function loadSecurity() {
  securityLoading.value = true
  try {
    securityInfo.value = await userStore.fetchSecurity()
  }
  finally {
    securityLoading.value = false
  }
}

async function handleRevokeDevices() {
  if (!confirm('撤销后，所有浏览器（包括当前这台）下次登录都要重新收微信验证码。确定继续？'))
    return
  securityRevoking.value = true
  try {
    const result = await userStore.revokeTrustedDevices()
    if (result?.ok) {
      showAlert(`已撤销 ${result.data?.revoked ?? 0} 台受信任设备`)
      await loadSecurity()
    }
    else {
      showAlert(result?.error || '撤销失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(getApiErrorMessage(e, '撤销失败'), 'danger')
  }
  finally {
    securityRevoking.value = false
  }
}

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

async function handleChangePassword() {
  if (!passwordForm.value.old || !passwordForm.value.new) {
    showAlert('请填写完整', 'danger')
    return
  }
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    showAlert('两次密码输入不一致', 'danger')
    return
  }
  if (passwordForm.value.new.length < 6) {
    showAlert('密码长度至少6位', 'danger')
    return
  }

  passwordSaving.value = true
  try {
    const res = await userStore.changePassword(passwordForm.value.old, passwordForm.value.new)

    if (res.ok) {
      showAlert('密码修改成功，请重新登录', 'primary')
      passwordForm.value = { old: '', new: '', confirm: '' }
      setTimeout(() => {
        userStore.logout()
        window.location.href = '/login'
      }, 1500)
    }
    else {
      showAlert(`修改失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    passwordSaving.value = false
  }
}

// 直接落在「系统设置」tab 时，settings 可能尚未拉取：账号就绪后自行补齐，
// 否则事件通知会显示默认值（渠道/Token 都是空的）。
// 事件通知组件内部也会 watch settings 同步，这里保证首次加载顺序。
// 运行环境/登录设置两块已从 UI 移除，但后端配置、API 与运行时注入完全保留。
watch(currentAccountId, (accountId) => {
  if (accountId && loadedAccountId.value !== accountId)
    loadAccountSettings(accountId)
}, { immediate: true })

onMounted(() => {
  loadSecurity()
})
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
      系统设置
    </h3>

    <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <!-- 左列：修改密码 + 事件通知；右列：登录安全。两列高度接近，避免左列大片留白。 -->
      <div class="min-w-0 space-y-4">
        <section class="farm-card rounded-lg p-4">
          <div class="mb-4 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
              <span class="i-carbon-password text-xl" />
            </div>
            <div>
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                修改管理员密码
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                更新后台管理登录凭据
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <BaseInput
              v-model="passwordForm.old"
              label="当前密码"
              type="password"
              placeholder="当前管理员密码"
            />
            <BaseInput
              v-model="passwordForm.new"
              label="新密码"
              type="password"
              placeholder="至少 6 位"
            />
            <BaseInput
              v-model="passwordForm.confirm"
              label="确认新密码"
              type="password"
              placeholder="再次输入新密码"
            />
          </div>

          <div class="mt-3 flex items-center justify-end border-t pt-3 dark:border-gray-700">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="passwordSaving"
              @click="handleChangePassword"
            >
              修改管理员密码
            </BaseButton>
          </div>
        </section>

        <EventNotifyPanel />
      </div>

      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <span class="i-carbon-security text-xl" />
          </div>
          <div class="flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              登录安全
            </h4>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              同一时间只允许一处登录；新设备登录需微信验证码；通过后 30 天内免验证
            </p>
          </div>
          <BaseButton variant="text" size="sm" :loading="securityLoading" @click="loadSecurity">
            刷新
          </BaseButton>
        </div>

        <div v-if="securityInfo" class="space-y-3">
          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
            <div class="mb-2 text-xs text-gray-500 font-medium dark:text-gray-400">
              当前会话
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <div class="text-gray-400">
                  设备
                </div>
                <div class="text-gray-800 dark:text-gray-200">
                  {{ securityInfo.session?.device || '—' }}
                </div>
              </div>
              <div>
                <div class="text-gray-400">
                  来源 IP
                </div>
                <div class="text-gray-800 dark:text-gray-200">
                  {{ securityInfo.session?.ip || '—' }}
                </div>
              </div>
              <div>
                <div class="text-gray-400">
                  自动续期至
                </div>
                <div class="text-gray-800 dark:text-gray-200">
                  {{ daysLeft(securityInfo.session?.expiresAt) }}
                </div>
              </div>
              <div>
                <div class="text-gray-400">
                  最迟重登
                </div>
                <div class="text-gray-800 dark:text-gray-200">
                  {{ daysLeft(securityInfo.session?.absoluteExpiresAt) }}
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs text-gray-500 font-medium dark:text-gray-400">
                受信任设备（{{ securityInfo.devices?.length || 0 }}）
              </span>
              <span v-if="!securityInfo.deviceVerifyEnabled" class="text-xs text-amber-600">
                设备验证已通过环境变量关闭
              </span>
            </div>
            <div v-if="!securityInfo.devices?.length" class="text-xs text-gray-400">
              暂无受信任设备。下次在新浏览器登录会立刻信任该设备并推送通知。
            </div>
            <ul v-else class="space-y-2">
              <li
                v-for="device in securityInfo.devices"
                :key="device.label + device.createdAt"
                class="flex items-center justify-between text-xs"
              >
                <span class="text-gray-800 dark:text-gray-200">
                  {{ device.label }}
                </span>
                <span class="text-gray-400">
                  最近 {{ formatDateTime(device.lastSeenAt) }} · {{ daysLeft(device.expiresAt) }}失效
                </span>
              </li>
            </ul>
          </div>

          <div class="flex items-center justify-between border-t pt-3 dark:border-gray-700">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              撤销后所有设备都要重新收验证码
            </span>
            <BaseButton
              variant="outline"
              size="sm"
              :loading="securityRevoking"
              :disabled="!securityInfo.devices?.length"
              @click="handleRevokeDevices"
            >
              撤销全部设备
            </BaseButton>
          </div>
        </div>
        <div v-else class="text-xs text-gray-400">
          加载中…
        </div>
      </section>
    </div>
  </div>
</template>
