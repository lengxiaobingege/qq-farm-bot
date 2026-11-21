import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api, { getApiErrorMessage } from '@/api'

export interface AdminInfo {
  username: string
  role: 'admin'
  avatar?: string
  mustChangePassword?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials' | 'verify_required' | 'push_failed'
    | 'verify_throttled' | 'challenge_expired' | 'challenge_mismatch' | 'invalid_code'
  remainingMs?: number
  /** 需要新设备验证码时返回，回填后交给 verifyLogin */
  challengeId?: string
  expiresIn?: number
  data?: {
    token: string
    role: 'admin'
    user: { username: string }
    mustChangePassword?: boolean
  }
}

export interface TrustedDevice {
  label: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number
}

export interface SecurityInfo {
  deviceVerifyEnabled: boolean
  session: {
    createdAt: number
    lastSeenAt: number
    expiresAt: number
    absoluteExpiresAt: number
    ip: string
    device: string
  } | null
  devices: TrustedDevice[]
}

function randomDeviceId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  }
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<AdminInfo | null>('user_info', null)
  /**
   * 设备标识：首次访问时随机生成并长期保存，用于「这台设备已通过过验证码」的免密判定。
   * 服务端只做比对，不参与密钥运算；清掉浏览器数据等同于换了一台新设备。
   */
  const deviceId = useStorage('admin_device_id', '')
  if (!deviceId.value)
    deviceId.value = randomDeviceId()

  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => userInfo.value?.username || '')
  const avatar = computed(() => userInfo.value?.avatar || '')

  function applyLogin(data: LoginResult['data']) {
    if (!data)
      return
    token.value = data.token
    userInfo.value = {
      username: data.user.username,
      role: 'admin',
      mustChangePassword: data.mustChangePassword,
    }
  }

  function pickError(payload: any): LoginResult {
    return {
      ok: false,
      error: getApiErrorMessage(payload, '网络错误'),
      errorType: payload?.errorType,
      remainingMs: payload?.remainingMs,
      challengeId: payload?.challengeId,
      expiresIn: payload?.expiresIn,
    }
  }

  async function login(usernameInput: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', {
        username: usernameInput,
        password,
        deviceId: deviceId.value,
      })
      const body = res.data
      if (body.ok) {
        applyLogin(body.data)
        return body
      }
      // 新设备需要验证码：这是正常流程，不是错误
      return pickError(body)
    }
    catch (error: any) {
      const data = error.response?.data
      return data ? pickError(data) : { ok: false, error: getApiErrorMessage(error, '网络错误') }
    }
  }

  async function verifyLogin(challengeId: string, code: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login/verify', {
        challengeId,
        code,
        deviceId: deviceId.value,
      })
      const body = res.data
      if (body.ok) {
        applyLogin(body.data)
        return body
      }
      return pickError(body)
    }
    catch (error: any) {
      const data = error.response?.data
      return data ? pickError(data) : { ok: false, error: getApiErrorMessage(error, '网络错误') }
    }
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok)
        userInfo.value = res.data.data
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  async function fetchSecurity(): Promise<SecurityInfo | null> {
    try {
      const res = await api.get('/api/user/security')
      return res.data?.ok ? res.data.data : null
    }
    catch {
      return null
    }
  }

  async function revokeTrustedDevices() {
    const res = await api.post('/api/user/devices/revoke')
    return res.data
  }

  return {
    token,
    userInfo,
    deviceId,
    isLoggedIn,
    username,
    avatar,
    login,
    verifyLogin,
    logout,
    fetchUserInfo,
    changePassword,
    fetchSecurity,
    revokeTrustedDevices,
  }
})
