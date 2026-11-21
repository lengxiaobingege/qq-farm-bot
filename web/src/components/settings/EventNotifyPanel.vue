<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useSettingsAlert } from '@/components/settings/settings-alert'
import { localEventNotify, syncLocalEventNotify } from '@/components/settings/settings-local-state'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useSettingStore } from '@/stores/setting'

const { showAlert } = useSettingsAlert()
const { settings } = storeToRefs(useSettingStore())

const saving = ref(false)
const testing = ref(false)

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

const channel = computed(() => String(localEventNotify.value.channel || '').trim().toLowerCase())
const isDingTalk = computed(() => channel.value === 'dingtalk')
const isMeow = computed(() => channel.value === 'meow')
const usesEndpoint = computed(() => channel.value === 'webhook' || isDingTalk.value)
const endpointLabel = computed(() => isDingTalk.value ? 'Webhook 地址' : '接口地址')
const endpointPlaceholder = computed(() => isDingTalk.value
  ? '从钉钉群机器人设置页复制完整 Webhook'
  : '接收消息的接口地址')
const tokenLabel = computed(() => isMeow.value ? '昵称' : 'Token')
const tokenPlaceholder = computed(() => isMeow.value
  ? 'MeoW 注册昵称'
  : '接收端 token')
const docUrl = computed(() => CHANNEL_DOCS[channel.value] || '')

function openDocs() {
  if (!docUrl.value)
    return
  window.open(docUrl.value, '_blank', 'noopener,noreferrer')
}

function validateDingTalkWebhook(): string {
  if (!isDingTalk.value)
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

// 设置可能在本组件挂载后才拉取，账号数据就绪后同步一次事件通知配置。
watch(settings, () => {
  syncLocalEventNotify()
}, { deep: true })

async function handleSave() {
  const validationError = validateDingTalkWebhook()
  if (validationError) {
    showAlert(validationError, 'danger')
    return
  }

  saving.value = true
  try {
    const res = await useSettingStore().saveEventNotifyConfig(localEventNotify.value)
    if (res.ok)
      showAlert('事件通知设置已保存', 'primary')
    else
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
  }
  finally {
    saving.value = false
  }
}

async function handleTest() {
  const validationError = validateDingTalkWebhook()
  if (validationError) {
    showAlert(validationError, 'danger')
    return
  }

  testing.value = true
  try {
    const { data } = await api.post('/api/settings/event-notify/test', localEventNotify.value)
    if (data?.ok)
      showAlert('测试消息发送成功', 'primary')
    else
      showAlert(`测试失败: ${getApiErrorMessage(data, '未知错误')}`, 'danger')
  }
  catch (e: any) {
    showAlert(`测试失败: ${getApiErrorMessage(e, '请求失败')}`, 'danger')
  }
  finally {
    testing.value = false
  }
}
</script>

<template>
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
            :disabled="!docUrl"
            @click="openDocs"
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
        v-if="usesEndpoint"
        v-model="localEventNotify.endpoint"
        :label="endpointLabel"
        type="text"
        :placeholder="endpointPlaceholder"
      />

      <BaseInput
        v-if="!isDingTalk"
        v-model="localEventNotify.token"
        :label="tokenLabel"
        type="password"
        :placeholder="tokenPlaceholder"
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
        :loading="testing"
        :disabled="saving"
        @click="handleTest"
      >
        测试通知
      </BaseButton>
      <BaseButton
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="testing"
        @click="handleSave"
      >
        保存事件通知设置
      </BaseButton>
    </div>
  </section>
</template>
