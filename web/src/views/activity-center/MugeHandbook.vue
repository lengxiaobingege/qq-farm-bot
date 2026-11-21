<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useMugeStore } from '@/stores/muge'
import { claimable, progressTo, taskTone, tierTone } from './muge-utils'

/** 成长手册：积分档位 + 按解锁天数分组的任务，未解锁的天数默认收起。 */
const store = useMugeStore()
const { state, busy, needsRefresh } = storeToRefs(store)
const disabled = computed(() => busy.value || needsRefresh.value || !state.value?.active)
const handbook = computed(() => state.value?.handbook || null)
const taskDays = computed(() => {
  const groups = new Map<number, NonNullable<typeof handbook.value>['tasks']>()
  for (const task of handbook.value?.tasks || [])
    groups.set(task.unlockDay, [...(groups.get(task.unlockDay) || []), task])
  return [...groups].sort(([a], [b]) => a - b).map(([day, tasks]) => ({
    day,
    tasks,
    locked: tasks.every(task => task.status === 4),
    done: tasks.filter(task => task.status === 3).length,
  }))
})
const pointsProgress = () => progressTo(handbook.value!.points, handbook.value!.tiers, ' 积分')
</script>

<template>
  <EmptyState v-if="!handbook" title="成长手册未开启" description="种植等级达到 25 级并开启牧场后解锁" icon="i-carbon-locked" />
  <template v-else>
    <section class="muge-card muge-bar">
      <div class="muge-bar__value">
        <span>成长积分</span>
        <strong>{{ handbook.points }}<small>积分</small></strong>
      </div>
      <div class="muge-bar__progress">
        <div class="muge-track" aria-hidden="true">
          <i :style="{ width: `${pointsProgress().percent}%` }" />
        </div>
        <span>{{ pointsProgress().text }}</span>
      </div>
      <div class="muge-bar__actions">
        <NButton :disabled="disabled || !handbook.tasks.some(task => task.status === 2)" @click="store.request('claimTask')">
          领取任务奖励
        </NButton>
        <NButton type="primary" :secondary="!claimable(handbook.tiers)" :disabled="disabled || !claimable(handbook.tiers)" @click="store.request('claimHandbook')">
          领取积分奖励
        </NButton>
      </div>
    </section>

    <section class="muge-section">
      <header class="muge-section__head">
        <i aria-hidden="true" /><h2>积分奖励</h2><span>{{ handbook.tiers.filter(t => t.status === 3).length }} / {{ handbook.tiers.length }}</span>
      </header>
      <div class="muge-grid is-small">
        <article v-for="tier in handbook.tiers" :key="tier.id" class="muge-card muge-item is-compact" :class="`is-${tierTone(tier.status).tone}`" :title="tier.rewards.map(r => `${r.name} ×${r.count}`).join('、')">
          <span class="muge-item__well"><img v-if="tier.rewards[0]" :src="tier.rewards[0].image" alt=""></span>
          <div class="muge-item__main">
            <strong>{{ tier.threshold }} 积分</strong>
            <span v-if="tier.rewards[0]">{{ tier.rewards[0].name }} <b>×{{ tier.rewards[0].count.toLocaleString('zh-CN') }}</b></span>
          </div>
          <span v-if="tier.status !== 1" class="muge-status" :class="`is-${tierTone(tier.status).tone}`">
            <span v-if="tier.status === 3" class="i-carbon-checkmark" aria-hidden="true" />{{ tierTone(tier.status).text }}
          </span>
        </article>
      </div>
    </section>

    <details v-for="group in taskDays" :key="group.day" class="muge-section" :open="!group.locked">
      <summary class="muge-section__head">
        <i aria-hidden="true" /><h2>第 {{ group.day }} 天</h2>
        <span>{{ group.locked ? `未解锁 · ${group.tasks.length} 个任务` : `已完成 ${group.done} / ${group.tasks.length}` }}</span>
        <span class="muge-section__chevron i-carbon-chevron-down" aria-hidden="true" />
      </summary>
      <div class="muge-grid">
        <article v-for="task in group.tasks" :key="task.id" class="muge-card muge-item" :class="`is-${taskTone(task).tone}`">
          <span class="muge-item__well"><img v-if="task.rewards[0]" :src="task.rewards[0].image" alt=""></span>
          <div class="muge-item__main">
            <strong :title="task.description">{{ task.description }}</strong>
            <span>{{ task.points }} 积分<template v-for="reward in task.rewards" :key="reward.id"> · {{ reward.name }} <b>×{{ reward.count.toLocaleString('zh-CN') }}</b></template></span>
          </div>
          <span class="muge-status" :class="`is-${taskTone(task).tone}`">
            <span v-if="task.status === 3" class="i-carbon-checkmark" aria-hidden="true" />{{ taskTone(task).text }}
          </span>
        </article>
      </div>
    </details>
  </template>
</template>

<style scoped src="./styles/muge-common.css"></style>
