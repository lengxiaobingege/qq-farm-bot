<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import { loadAccountSettings, localEventNotify, syncLocalEventNotify } from '@/components/settings/settings-local-state'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user'

const { showAlert } = useSettingsAlert()

const { settings, loadedAccountId } = storeToRefs(useSettingStore())
const { currentAccountId } = storeToRefs(useAccountStore())
const userStore = useUserStore()

const passwordSaving = ref(false)
const offlineSaving = ref(false)
const offlineTesting = ref(false)

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

const channelOptions = [
  { label: 'Webhook(自定义接口)', value: 'webhook' },
  { label: 'Qmsg 酱', value: 'qmsg' },
  { label: 'Server 酱', value: 'serverchan' },
  { label: 'Push Plus', value: 'pushplus' },
  { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
  { label: '钉钉', value: 'dingtalk' },
  { label: '企业微信', value: 'wecom' },
  { label: 'Bark', value: 'bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp' },
  { label: 'OneBot', value: 'onebot' },
  { label: 'Atri', value: 'atri' },
  { label: 'PushDeer', value: 'pushdeer' },
  { label: 'iGot', value: 'igot' },
  { label: 'Telegram', value: 'telegram' },
  { label: '飞书', value: 'feishu' },
  { label: 'IFTTT', value: 'ifttt' },
  { label: '企业微信群机器人', value: 'wecombot' },
  { label: 'Discord', value: 'discord' },
  { label: 'WxPusher', value: 'wxpusher' },
  { label: 'MeoW', value: 'meow' },
]

const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/orgapp/customize-robot-security-settings',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
  meow: 'https://www.chuckfang.com/MeoW/api_doc.html',
}

const eventNotifyChannel = computed(() => String(localEventNotify.value.channel || '').trim().toLowerCase())
const isDingTalkChannel = computed(() => eventNotifyChannel.value === 'dingtalk')
const isMeowChannel = computed(() => eventNotifyChannel.value === 'meow')
const eventNotifyChannelUsesEndpoint = computed(() => eventNotifyChannel.value === 'webhook' || isDingTalkChannel.value)
const eventNotifyEndpointLabel = computed(() => isDingTalkChannel.value ? 'Webhook 地址' : '接口地址')
const eventNotifyEndpointPlaceholder = computed(() => isDingTalkChannel.value
  ? '从钉钉群机器人设置页复制完整 Webhook'
  : '接收消息的接口地址')
const eventNotifyTokenLabel = computed(() => isMeowChannel.value ? '昵称' : 'Token')
const eventNotifyTokenPlaceholder = computed(() => isMeowChannel.value
  ? 'MeoW 注册昵称'
  : '接收端 token')
const currentChannelDocUrl = computed(() => CHANNEL_DOCS[eventNotifyChannel.value] || '')

function openChannelDocs() {
  const url = currentChannelDocUrl.value
  if (!url)
    return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function validateDingTalkWebhook(): string {
  if (!isDingTalkChannel.value)
    return ''

  const endpoint = String(localEventNotify.value.endpoint || '').trim()
  if (!endpoint)
    return '请填写钉钉机器人设置页提供的完整 Webhook 地址'

  try {
    const url = new URL(endpoint)
    const isOfficialWebhook = url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'oapi.dingtalk.com'
      && url.pathname === '/robot/send'
      && !!url.searchParams.get('access_token')
    if (!isOfficialWebhook)
      return '钉钉 Webhook 地址格式不正确，请从群机器人设置页重新复制'
  }
  catch {
    return '钉钉 Webhook 地址格式不正确，请从群机器人设置页重新复制'
  }

  return ''
}

watch(settings, () => {
  syncLocalEventNotify()
}, { deep: true })

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

async function handleSaveOffline() {
  const validationError = validateDingTalkWebhook()
  if (validationError) {
    showAlert(validationError, 'danger')
    return
  }

  offlineSaving.value = true
  try {
    const res = await useSettingStore().saveEventNotifyConfig(localEventNotify.value)

    if (res.ok) {
      showAlert('事件通知设置已保存', 'primary')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    offlineSaving.value = false
  }
}

async function handleTestOffline() {
  const validationError = validateDingTalkWebhook()
  if (validationError) {
    showAlert(validationError, 'danger')
    return
  }

  offlineTesting.value = true
  try {
    const { data } = await api.post('/api/settings/event-notify/test', localEventNotify.value)
    if (data?.ok) {
      showAlert('测试消息发送成功', 'primary')
    }
    else {
      showAlert(`测试失败: ${getApiErrorMessage(data, '未知错误')}`, 'danger')
    }
  }
  catch (e: any) {
    const msg = getApiErrorMessage(e, '请求失败')
    showAlert(`测试失败: ${msg}`, 'danger')
  }
  finally {
    offlineTesting.value = false
  }
}

const systemConfigSaving = ref(false)
const systemConfigLoading = ref(false)
const loginSettingsSaving = ref(false)

const defaultDeviceInfo = {
  os: 'Windows',
  clientVersion: '',
  sysSoftware: 'Windows 10',
  network: 'wifi',
  memory: '16384',
  deviceId: 'DESKTOP-PC<WPC>',
  userAgent: '',
}

const localSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  wxClientVersion: '',
  platform: 'wx',
  os: 'Windows',
  timeZone: 'Asia/Shanghai',
  deviceInfo: { ...defaultDeviceInfo },
})
const defaultSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  wxClientVersion: '',
  platform: 'wx',
  os: 'Windows',
  timeZone: 'Asia/Shanghai',
  deviceInfo: { ...defaultDeviceInfo },
})
const localLoginSettings = ref({
  wechatQrLogin: true,
})
const devicePresets = ref<any[]>([])
const selectedPresetId = ref('')
const timeZoneOptions = ref([
  { label: '北京时间 / 上海（UTC+8）', value: 'Asia/Shanghai' },
])
const platformOptions = [
  { label: '微信', value: 'wx' },
]
const osOptions = [
  { label: 'Windows', value: 'Windows' },
  { label: 'iOS', value: 'iOS' },
  { label: 'Android', value: 'Android' },
]

function normalizeSystemConfig(source: any, fallback: any) {
  return {
    serverUrl: source?.serverUrl || '',
    clientVersion: source?.clientVersion || '',
    wxClientVersion: source?.wxClientVersion || fallback.wxClientVersion || '',
    platform: source?.platform || 'wx',
    os: source?.os || 'Windows',
    timeZone: source?.timeZone || fallback.timeZone || 'Asia/Shanghai',
    deviceInfo: source?.deviceInfo ? { ...fallback.deviceInfo, ...source.deviceInfo } : { ...fallback.deviceInfo },
  }
}

function normalizeLoginSettings(source: any) {
  return {
    wechatQrLogin: typeof source?.wechatQrLogin === 'boolean' ? source.wechatQrLogin : true,
  }
}

async function loadDevicePresets() {
  try {
    const { data } = await api.get('/api/settings/device-presets')
    if (data?.ok && Array.isArray(data.data))
      devicePresets.value = data.data
  }
  catch (e) {
    console.error('加载设备预设失败:', e)
  }
}

function applyDevicePreset(presetId: string) {
  const preset = devicePresets.value.find(item => item.id === presetId)
  if (!preset)
    return
  const deviceInfo = { ...defaultDeviceInfo, ...(preset.deviceInfo || {}) }
  localSystemConfig.value = {
    ...localSystemConfig.value,
    os: deviceInfo.os || 'Windows',
    clientVersion: deviceInfo.clientVersion || '',
    deviceInfo,
  }
  selectedPresetId.value = presetId
}

async function loadSystemConfig() {
  systemConfigLoading.value = true
  try {
    const { data } = await api.get('/api/settings/system-config')
    if (data?.ok) {
      if (Array.isArray(data.data.timeZones) && data.data.timeZones.length) {
        timeZoneOptions.value = data.data.timeZones.map((option: any) => ({
          label: String(option.label || option.value || ''),
          value: String(option.value || 'Asia/Shanghai'),
        }))
      }
      defaultSystemConfig.value = normalizeSystemConfig(data.data.default, defaultSystemConfig.value)
      localSystemConfig.value = normalizeSystemConfig(data.data.saved || data.data.default, defaultSystemConfig.value)
      localLoginSettings.value = normalizeLoginSettings(data.data.loginSettings)
    }
  }
  catch (e) {
    console.error('加载系统配置失败:', e)
  }
  finally {
    systemConfigLoading.value = false
  }
}

async function handleSaveLoginSettings() {
  loginSettingsSaving.value = true
  try {
    const { data } = await api.post('/api/settings/login-config', localLoginSettings.value)
    if (data?.ok) {
      localLoginSettings.value = normalizeLoginSettings(data.data)
    }
    showAlert(data?.ok ? '登录设置已保存' : getApiErrorMessage(data, '保存失败'), data?.ok ? 'primary' : 'danger')
  }
  catch (e: any) {
    showAlert(`保存失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    loginSettingsSaving.value = false
  }
}

async function handleSaveSystemConfig() {
  systemConfigSaving.value = true
  try {
    localSystemConfig.value.clientVersion = localSystemConfig.value.deviceInfo.clientVersion
    localSystemConfig.value.os = localSystemConfig.value.deviceInfo.os
    const { data } = await api.post('/api/settings/system-config', localSystemConfig.value)
    showAlert(data?.ok ? '系统配置已保存，连接参数在下次登录时生效' : getApiErrorMessage(data, '保存失败'), data?.ok ? 'primary' : 'danger')
  }
  catch (e: any) {
    showAlert(`保存失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

async function handleResetSystemConfig() {
  systemConfigSaving.value = true
  try {
    const { data } = await api.post('/api/settings/system-config/reset')
    if (data?.ok) {
      localSystemConfig.value = normalizeSystemConfig(data.data.saved, defaultSystemConfig.value)
      selectedPresetId.value = ''
      showAlert('系统配置已重置，连接参数在下次登录时生效', 'primary')
    }
    else {
      showAlert(getApiErrorMessage(data, '重置失败'), 'danger')
    }
  }
  catch (e: any) {
    showAlert(`重置失败: ${getApiErrorMessage(e, '未知错误')}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

// 直接落在「系统设置」tab 时，settings 可能尚未拉取：账号就绪后自行补齐，
// 否则事件通知会显示默认值（渠道/Token 都是空的）。
watch(currentAccountId, (accountId) => {
  if (accountId && loadedAccountId.value !== accountId)
    loadAccountSettings(accountId)
}, { immediate: true })

onMounted(() => {
  syncLocalEventNotify()
  loadSystemConfig()
  loadDevicePresets()
})
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
      系统设置
    </h3>

    <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
            <span class="i-carbon-settings-adjust text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              运行环境
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              服务器连接、时区与客户端设备参数
            </p>
          </div>
        </div>

        <div v-if="systemConfigLoading" class="py-8 text-center text-gray-500">
          <span class="i-svg-spinners-90-ring-with-bg inline-block text-2xl" />
        </div>
        <div v-else class="space-y-3">
          <div v-if="devicePresets.length" class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-300">设备预设</label>
            <div class="flex flex-wrap gap-2">
              <NButton
                v-for="preset in devicePresets"
                :key="preset.id"
                size="small"
                :type="selectedPresetId === preset.id ? 'primary' : 'default'"
                :secondary="selectedPresetId !== preset.id"
                :title="preset.description"
                @click="applyDevicePreset(preset.id)"
              >
                {{ preset.name }}
              </NButton>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput
              v-model="localSystemConfig.serverUrl"
              label="服务器地址"
              type="text"
              placeholder="wss://..."
            />
            <div>
              <BaseSelect
                v-model="localSystemConfig.timeZone"
                label="系统时区"
                :options="timeZoneOptions"
              />
              <p class="mt-1 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
                礼包、任务、安静时段和日志均以此时区为准。
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
              <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
              <div class="flex flex-wrap gap-2">
                <NButton
                  v-for="option in platformOptions"
                  :key="option.value"
                  size="small"
                  :type="localSystemConfig.platform === option.value ? 'primary' : 'default'"
                  :secondary="localSystemConfig.platform !== option.value"
                  @click="localSystemConfig.platform = option.value"
                >
                  {{ option.label }}
                </NButton>
              </div>
            </div>
            <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
              <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
              <div class="flex flex-wrap gap-2">
                <NButton
                  v-for="option in osOptions"
                  :key="option.value"
                  size="small"
                  :type="localSystemConfig.deviceInfo.os === option.value ? 'primary' : 'default'"
                  :secondary="localSystemConfig.deviceInfo.os !== option.value"
                  @click="localSystemConfig.deviceInfo.os = option.value; localSystemConfig.os = option.value"
                >
                  {{ option.label }}
                </NButton>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput
              v-model="localSystemConfig.deviceInfo.clientVersion"
              label="客户端版本"
              type="text"
              :placeholder="defaultSystemConfig.deviceInfo.clientVersion || '从服务器加载中...'"
            />
            <BaseInput
              v-model="localSystemConfig.wxClientVersion"
              label="微信客户端版本"
              type="text"
              :placeholder="defaultSystemConfig.wxClientVersion || '从服务器加载中...'"
            />
            <BaseInput
              v-model="localSystemConfig.deviceInfo.sysSoftware"
              label="系统版本"
              type="text"
              placeholder="Windows 10"
            />
            <BaseInput
              v-model="localSystemConfig.deviceInfo.deviceId"
              label="设备标识"
              type="text"
              placeholder="DESKTOP-PC<WPC>"
            />
            <BaseInput
              v-model="localSystemConfig.deviceInfo.memory"
              label="内存 (MB)"
              type="text"
              placeholder="16384"
            />
            <BaseInput
              v-model="localSystemConfig.deviceInfo.network"
              label="网络"
              type="text"
              placeholder="wifi"
            />
            <BaseInput
              v-model="localSystemConfig.deviceInfo.userAgent"
              label="User-Agent"
              type="text"
              placeholder="Mozilla/5.0 ..."
            />
          </div>

          <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
            <BaseButton variant="secondary" size="sm" :loading="systemConfigSaving" @click="handleResetSystemConfig">
              重置
            </BaseButton>
            <BaseButton variant="primary" size="sm" :loading="systemConfigSaving" @click="handleSaveSystemConfig">
              保存运行环境
            </BaseButton>
          </div>
        </div>
      </section>

      <div class="min-w-0 space-y-4">
        <section class="farm-card rounded-lg p-4">
          <div class="mb-4 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
              <span class="i-carbon-login text-xl" />
            </div>
            <div>
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                登录设置
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                控制添加账号时可用的扫码登录方式
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
              <BaseSwitch v-model="localLoginSettings.wechatQrLogin" label="微信扫码登录" />
            </div>
          </div>

          <div class="mt-3 flex justify-end border-t pt-3 dark:border-gray-700">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="loginSettingsSaving"
              @click="handleSaveLoginSettings"
            >
              保存登录设置
            </BaseButton>
          </div>
        </section>

        <section class="farm-card rounded-lg p-4">
          <div class="mb-4 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400">
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

        <section class="farm-card rounded-lg p-4">
          <div class="mb-4 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400">
              <span class="i-carbon-notification text-xl" />
            </div>
            <div>
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                事件通知
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                配置一次即可同时用于登录成功、账号离线、自动重登失败与活动结算提醒。标题和内容可用 {accountName} 插入账号名。
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="min-w-0 flex flex-col gap-1.5">
              <div class="min-h-6 flex items-center justify-between gap-2">
                <span class="text-sm text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
                <BaseButton
                  variant="text"
                  size="sm"
                  :disabled="!currentChannelDocUrl"
                  @click="openChannelDocs"
                >
                  官方文档
                </BaseButton>
              </div>
              <BaseSelect
                v-model="localEventNotify.channel"
                :options="channelOptions"
              />
            </div>

            <BaseInput
              v-if="eventNotifyChannelUsesEndpoint"
              v-model="localEventNotify.endpoint"
              :label="eventNotifyEndpointLabel"
              type="text"
              :placeholder="eventNotifyEndpointPlaceholder"
            />

            <BaseInput
              v-if="!isDingTalkChannel"
              v-model="localEventNotify.token"
              :label="eventNotifyTokenLabel"
              type="password"
              :placeholder="eventNotifyTokenPlaceholder"
            />

            <template v-else>
              <BaseInput
                v-model="localEventNotify.secret"
                label="加签密钥（可选）"
                type="password"
                placeholder="仅在机器人开启加签时填写 SEC..."
              />
              <p class="text-xs text-gray-500 leading-relaxed sm:col-span-2 dark:text-gray-400">
                从群机器人的设置页复制完整 Webhook；只有开启“加签”时才需要填写加签密钥。
              </p>
            </template>

            <BaseInput
              v-model="localEventNotify.title"
              label="标题"
              type="text"
              placeholder="{accountName} 已离线"
            />
            <BaseInput
              v-model.number="localEventNotify.offlineDeleteSec"
              label="离线删除账号 (秒)"
              type="number"
              min="0"
              placeholder="0 表示不删除"
            />
            <BaseInput
              v-model="localEventNotify.msg"
              label="内容"
              type="text"
              placeholder="农场连接已断开，重新扫码登录即可继续。"
              class="sm:col-span-2"
            />
          </div>

          <div class="mt-3 flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="offlineTesting"
              :disabled="offlineSaving"
              @click="handleTestOffline"
            >
              测试通知
            </BaseButton>
            <BaseButton
              variant="primary"
              size="sm"
              :loading="offlineSaving"
              :disabled="offlineTesting"
              @click="handleSaveOffline"
            >
              保存事件通知设置
            </BaseButton>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
