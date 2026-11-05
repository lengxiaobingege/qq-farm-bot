<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const userStore = useUserStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')
const wxGameVersion = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const needsSetup = ref(false)
const setupChecking = ref(true)
const generatedPassword = ref('')
const copied = ref(false)
const error = ref('')
const success = ref('')
const loading = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

function randomInt(max: number): number {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / max) * max
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limit)
  return buf[0] % max
}

function generateRandomPassword(): void {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnpqrstuvwxyz',
    '23456789',
    '#%^*+?!-_=',
  ]
  const chars: string[] = groups.map(g => g[randomInt(g.length)])
  const all = groups.join('')
  while (chars.length < 16)
    chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  const value = chars.join('')
  password.value = value
  confirmPassword.value = value
  generatedPassword.value = value
  copied.value = false
  error.value = ''
}

async function copyGeneratedPassword(): Promise<void> {
  try {
    await navigator.clipboard.writeText(generatedPassword.value)
    copied.value = true
  }
  catch {
    error.value = '复制失败，请手动选中密码复制'
  }
}

function clearGeneratedPassword(): void {
  if (generatedPassword.value) {
    generatedPassword.value = ''
    copied.value = false
  }
}

watch([password, confirmPassword], ([pwd, confirm]) => {
  if (generatedPassword.value && (pwd !== generatedPassword.value || confirm !== generatedPassword.value))
    clearGeneratedPassword()
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }
  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }
  if (!password.value) {
    error.value = needsSetup.value ? '请输入要设置的密码' : '请输入密码'
    return false
  }
  if (needsSetup.value && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return false
  }
  return true
}

async function handleSetup() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.post('/api/setup', { password: password.value })
    if (res.data.ok) {
      userStore.token = res.data.data.token
      userStore.userInfo = {
        username: res.data.data.user.username,
        role: 'admin',
        mustChangePassword: false,
      }
      success.value = '密码设置成功，正在进入面板'
      setTimeout(() => {
        window.location.href = '/'
      }, 500)
    }
    else {
      error.value = res.data.error || '设置失败'
    }
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '设置失败')
  }
  finally {
    loading.value = false
  }
}

async function handleSubmit() {
  if (!validateForm())
    return
  if (needsSetup.value) {
    await handleSetup()
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const result = await userStore.login(username.value, password.value)
    if (result.ok) {
      if (result.data?.mustChangePassword)
        success.value = '登录成功，请修改默认密码'
      setTimeout(() => {
        window.location.href = '/'
      }, 500)
    }
    else if (result.errorType === 'rate_limit') {
      error.value = result.error || '请求过于频繁，请稍后重试'
      if (result.remainingMs)
        rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
    }
    else if (result.errorType === 'locked') {
      error.value = result.error || '账户已被锁定'
      if (result.remainingMs)
        lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
    }
    else {
      error.value = result.error || '登录失败'
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = getApiErrorMessage(data, '请求过于频繁')
      if (data.remainingMs)
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
    }
    else if (data?.errorType === 'locked') {
      error.value = getApiErrorMessage(data, '账户已被锁定')
      if (data.remainingMs)
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
    }
    else {
      error.value = getApiErrorMessage(e, '操作异常')
    }
  }
  finally {
    loading.value = false
  }
}

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok)
      gameVersion.value = res.data.clientVersion
    wxGameVersion.value = res.data.wxClientVersion || ''
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

async function checkSetupStatus() {
  try {
    const res = await api.get('/api/setup-status')
    if (res.data.ok && res.data.data?.needsSetup) {
      needsSetup.value = true
      username.value = 'admin'
    }
  }
  catch {
    // 接口不可用时保持普通登录形态
  }
  finally {
    setupChecking.value = false
  }
}

onMounted(() => {
  fetchGameVersion()
  checkSetupStatus()
})
</script>

<template>
  <main class="login-container">
    <section class="login-card">
      <header class="logo-area">
        <BrandMark class="logo-icon" :size="58" />
        <div>
          <span class="logo-kicker">QQ FARM</span>
          <h1 class="logo-title">
            QQ农场智能助手
          </h1>
          <p class="logo-subtitle">
            {{ needsSetup ? '首次使用 · 设置管理员密码' : '超级管理员登录' }}
          </p>
        </div>
      </header>

      <form class="form-area" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label" for="username">
            <span class="i-carbon-user" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            autocomplete="username"
            :disabled="needsSetup"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" for="password">
            <span class="i-carbon-locked" />
            {{ needsSetup ? '设置密码' : '密码' }}
          </label>
          <div v-if="needsSetup" class="generate-row">
            <BaseButton variant="outline" size="sm" type="button" @click="generateRandomPassword">
              <span class="inline-flex items-center gap-1">
                <span class="i-carbon-renew" />
                生成随机密码
              </span>
            </BaseButton>
            <span class="generate-hint">16 位，含大小写字母、数字、特殊符号</span>
          </div>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            :placeholder="needsSetup ? '至少8位，含大小写/数字/符号中3类' : '请输入密码'"
            :autocomplete="needsSetup ? 'new-password' : 'current-password'"
            required
          />
          <p v-if="needsSetup" class="form-hint">
            账号固定为 admin；密码至少 8 位，且包含大写字母、小写字母、数字、特殊符号中的至少 3 类
          </p>
        </div>

        <div v-if="needsSetup" class="form-group">
          <label class="form-label" for="confirmPassword">
            <span class="i-carbon-locked" />
            确认密码
          </label>
          <BaseInput
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            autocomplete="new-password"
            required
          />
        </div>

        <div v-if="generatedPassword" class="generated-box">
          <div class="generated-label">
            已生成，请立即保存（仅此一次显示）
          </div>
          <div class="generated-value">
            <code>{{ generatedPassword }}</code>
            <BaseButton variant="text" size="sm" type="button" @click="copyGeneratedPassword">
              <span class="inline-flex items-center gap-1">
                <span :class="copied ? 'i-carbon-checkmark' : 'i-carbon-copy'" />
                {{ copied ? '已复制' : '复制' }}
              </span>
            </BaseButton>
          </div>
        </div>

        <div v-if="error" class="message error-message" role="alert">
          <span class="i-carbon-warning-alt" />
          <div>
            {{ error }}
            <span v-if="lockoutRemaining > 0">（{{ lockoutRemaining }} 分钟后解锁）</span>
            <span v-if="rateLimitRemaining > 0">（{{ rateLimitRemaining }} 秒后可重试）</span>
          </div>
        </div>
        <div v-if="success" class="message success-message" role="status">
          <span class="i-carbon-checkmark-filled" />
          {{ success }}
        </div>

        <BaseButton type="submit" variant="primary" block :loading="loading || setupChecking" class="submit-btn">
          <span v-if="!loading" class="inline-flex items-center gap-2">
            <span :class="needsSetup ? 'i-carbon-password' : 'i-carbon-login'" />
            {{ needsSetup ? '设置密码并登录' : '登录' }}
          </span>
        </BaseButton>
      </form>

      <footer class="card-footer">
        <div class="footer-info">
          <span>Web v{{ appVersion }}</span>
          <span v-if="gameVersion">{{ gameVersion }}</span>
          <span v-if="wxGameVersion">微信 {{ wxGameVersion }}</span>
        </div>
        <a href="https://github.com/lengxiaobingege/qq-farm-bot" target="_blank" rel="noopener noreferrer" class="github-link" aria-label="GitHub">
          <span class="i-carbon-logo-github" />
        </a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-container {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 100dvh;
  place-items: center;
  overflow: hidden;
  padding: 28px 18px;
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}

.login-container::before {
  position: absolute;
  inset: 8% 7%;
  border: 1px solid rgba(67, 141, 99, 0.08);
  border-radius: 36px;
  background: color-mix(in srgb, var(--ui-surface-strong) 22%, transparent);
  content: '';
}

.login-card {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  padding: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-bg) 82%, transparent);
  box-shadow:
    0 28px 76px rgba(55, 75, 61, 0.16),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ui-border);
}

.logo-icon {
  flex: none;
  filter: drop-shadow(0 8px 18px rgba(45, 122, 83, 0.24));
}

.logo-kicker {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: var(--fw-700);
}

.logo-title {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 0;
}

.logo-subtitle {
  margin: 5px 0 0;
  color: var(--ui-muted);
  font-size: 12px;
}

.form-area {
  display: flex;
  flex-direction: column;
  gap: 17px;
  padding-top: 24px;
}

.form-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.form-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: var(--fw-600);
}

.form-label > span {
  color: var(--ui-primary);
}

.login-card :deep(.base-input) {
  height: 42px;
  border-color: var(--ui-border);
  border-radius: 10px;
  color: var(--ui-ink);
  background: color-mix(in srgb, var(--ui-surface-strong) 70%, transparent);
}

.login-card :deep(.base-input:focus) {
  border-color: rgba(67, 141, 99, 0.55);
  box-shadow: 0 0 0 3px rgba(67, 141, 99, 0.1);
}

.form-hint {
  margin: 0;
  color: var(--ui-danger);
  font-size: 11px;
}

.form-hint:not(.error) {
  color: var(--ui-muted);
  line-height: 1.5;
}

.generate-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.generate-hint {
  color: var(--ui-subtle);
  font-size: 11px;
}

.generated-box {
  padding: 10px 12px;
  border: 1px solid rgba(67, 141, 99, 0.28);
  border-radius: 10px;
  background: var(--ui-primary-soft);
}

.generated-label {
  margin-bottom: 6px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: var(--fw-600);
}

.generated-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.generated-value code {
  color: var(--ui-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  letter-spacing: 0.5px;
  user-select: all;
  word-break: break-all;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.error-message {
  border-color: rgba(201, 95, 102, 0.18);
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.success-message {
  border-color: rgba(67, 141, 99, 0.18);
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.submit-btn {
  margin-top: 2px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding-top: 17px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-subtle);
  font-size: 10px;
}

.footer-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.github-link {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  color: var(--ui-muted);
  text-decoration: none;
}

.github-link:hover {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

@media (max-width: 480px) {
  .login-container {
    align-items: center;
    padding: 16px 12px;
  }

  .login-container::before {
    inset: 4%;
    border-radius: 24px;
  }

  .login-card {
    padding: 24px 20px;
    border-radius: 16px;
  }

  .logo-icon {
    width: 52px;
    height: 52px;
  }

  .logo-title {
    font-size: 19px;
  }
}
</style>
