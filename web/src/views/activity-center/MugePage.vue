<script setup lang="ts">
import type { MugeAction } from '@/stores/muge'
import { NButton } from 'naive-ui/es/button'
import { NTab, NTabs } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import ActivityRulesDialog from '@/components/activity/ActivityRulesDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAccountStore } from '@/stores/account'
import { useMugeStore } from '@/stores/muge'
import { claimable } from './muge-utils'
import MugeHandbook from './MugeHandbook.vue'
import MugePersonality from './MugePersonality.vue'
import MugeTierSection from './MugeTierSection.vue'

/**
 * 牧歌初启编排壳：农场与牧场共用同一份账号进度，两个空间的活动页都打开这里。
 * 只负责标题、页签、空状态与规则弹窗；四个玩法的具体内容拆到独立子组件。
 */
type Section = 'celebration' | 'friends' | 'handbook' | 'personality'

defineEmits<{ back: [] }>()
const store = useMugeStore()
const { state, busy, error, needsRefresh } = storeToRefs(store)
const { currentAccountId } = storeToRefs(useAccountStore())
const tab = ref<Section>('celebration')
const rulesOpen = ref(false)
const disabled = computed(() => busy.value || needsRefresh.value || !state.value?.active)

const period = computed(() => {
  const s = state.value
  if (!s)
    return null
  const format = (value: number) => new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  // 按自然日计算剩余天数，与其他活动页的标题一致。
  const day = (ms: number) => {
    const date = new Date(ms)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const days = Math.round((day(s.endTime) - day(s.serverTime)) / 86_400_000)
  const badge = !s.active || days < 0 ? '已结束' : days === 0 ? '今天结束' : `还剩 ${days} 天`
  return { text: `${format(s.startTime)} – ${format(s.endTime)}`, badge, ended: badge === '已结束' }
})

const sections = computed(() => {
  const s = state.value
  return [
    { key: 'celebration' as const, label: '兴牧庆典', icon: 'i-carbon-trophy', dot: claimable(s?.celebration?.tiers) > 0 },
    { key: 'friends' as const, label: '牧友同行', icon: 'i-carbon-user-multiple', dot: claimable(s?.friends?.tiers) > 0 },
    { key: 'handbook' as const, label: '成长手册', icon: 'i-carbon-notebook', dot: !!s?.handbook && (claimable(s.handbook.tiers) > 0 || s.handbook.tasks.some(task => task.status === 2)) },
    { key: 'personality' as const, label: '牧场人格', icon: 'i-carbon-user-profile', dot: !!s?.personality?.personalityId && !s.personality.shareRewardClaimed },
  ]
})

/** 兴牧庆典与牧友同行结构相同，收敛成一份配置交给 MugeTierSection。 */
const tierSection = computed(() => {
  const s = state.value
  if (tab.value === 'celebration' && s?.celebration)
    return { label: '全服累计饲养', unit: '只', value: s.celebration.total, tiers: s.celebration.tiers, action: 'claimCelebration' as MugeAction, note: '全服饲养数量达到档位后，所有玩家都可领取' }
  if (tab.value === 'friends' && s?.friends)
    return { label: '已开启牧场的好友', unit: '位', value: s.friends.count, tiers: s.friends.tiers, action: 'claimFriends' as MugeAction, note: '好友关系解除不影响已计数的好友' }
  return null
})

/** 规则原文是游戏配置 JSON（含 <b> 标记），整理成段落，【】开头的行作为小标题。 */
const rules = computed(() => {
  const lines: string[] = []
  for (const raw of state.value?.rules || []) {
    let parsed: any = null
    try {
      parsed = JSON.parse(raw)
    }
    catch {}
    lines.push(...(Array.isArray(parsed?.tips?.txt) ? parsed.tips.txt.map(String) : [String(raw)]))
  }
  return lines
    .map(line => ({ heading: /^\s*<b>.*<\/b>\s*$/.test(line), text: line.replace(/<[^>]+>/g, '').trim() }))
    .filter(line => line.text)
})

watch(currentAccountId, () => {
  void store.request()
}, { immediate: true })
</script>

<template>
  <section class="muge">
    <!-- 标题行：与全站页头同一字号与位置，返回、标题、活动时间；右侧说明与刷新。 -->
    <header class="muge-head">
      <div class="muge-head__lead">
        <NButton quaternary circle title="返回活动列表" aria-label="返回活动列表" @click="$emit('back')">
          <template #icon>
            <span class="i-carbon-arrow-left" />
          </template>
        </NButton>
        <img src="/activity-assets/muge/icon.png" alt="" width="32" height="32" class="muge-head__icon">
        <div class="muge-head__text min-w-0">
          <h1>牧歌初启</h1>
          <p v-if="period">
            <span class="i-carbon-calendar" aria-hidden="true" />{{ period.text }}
            <span class="muge-head__badge" :class="{ 'is-ended': period.ended }">{{ period.badge }}</span>
          </p>
        </div>
      </div>
      <div class="muge-head__actions">
        <NButton quaternary :disabled="!state" title="活动说明" aria-label="活动说明" @click="rulesOpen = true">
          <template #icon>
            <span class="i-carbon-information" />
          </template>
          <span class="muge-head__rules-label">活动说明</span>
        </NButton>
        <NButton quaternary circle :loading="busy" title="刷新活动" aria-label="刷新活动" @click="store.request()">
          <template #icon>
            <span class="i-carbon-renew" />
          </template>
        </NButton>
      </div>
    </header>

    <NTabs v-model:value="tab" type="line" class="muge-tabs" aria-label="牧歌初启玩法">
      <NTab v-for="section in sections" :key="section.key" :name="section.key">
        <span class="muge-tab"><span :class="section.icon" aria-hidden="true" />{{ section.label }}<i v-if="section.dot" class="muge-tab__dot" aria-label="有可领取奖励" /></span>
      </NTab>
    </NTabs>

    <div class="muge-content">
      <p v-if="error" class="muge-error" role="alert">
        <span class="i-carbon-warning-alt" aria-hidden="true" />{{ error }}
      </p>

      <EmptyState v-if="!currentAccountId" title="请先选择账号" icon="i-carbon-user-avatar" />
      <EmptyState v-else-if="!state" :title="busy ? '正在读取活动进度' : '暂未获取到活动数据'" :icon="busy ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-calendar'">
        <NButton v-if="!busy" secondary @click="store.request()">
          重新读取
        </NButton>
      </EmptyState>

      <template v-else>
        <p v-if="!state.active" class="muge-notice">
          <span class="i-carbon-time" aria-hidden="true" />活动尚未开始或已经结束，奖励暂不可领取
        </p>

        <!-- 兴牧庆典 / 牧友同行 -->
        <MugeTierSection v-if="tierSection" :section="tierSection" :disabled="disabled" :busy="busy" />
        <!-- 成长手册 -->
        <MugeHandbook v-else-if="tab === 'handbook'" />
        <!-- 牧场人格 -->
        <MugePersonality v-else-if="tab === 'personality'" />
      </template>
    </div>

    <ActivityRulesDialog :open="rulesOpen" title="牧歌初启 · 活动说明" @close="rulesOpen = false">
      <div v-if="rules.length" class="muge-rules">
        <p v-for="(line, index) in rules" :key="index" :class="{ 'is-heading': line.heading }">
          {{ line.text }}
        </p>
      </div>
      <p v-else class="muge-rules__empty">
        暂无活动说明
      </p>
    </ActivityRulesDialog>
  </section>
</template>

<style scoped src="./styles/muge-page.css"></style>
