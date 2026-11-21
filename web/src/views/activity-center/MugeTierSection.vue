<script setup lang="ts">
import type { MugeAction, MugeTier } from '@/stores/muge'
import { NButton } from 'naive-ui/es/button'
import { useMugeStore } from '@/stores/muge'
import { claimable, compact, progressTo, tierTone } from './muge-utils'

/** 兴牧庆典与牧友同行结构相同：一个累计值 + 若干档位，差异全部由 prop 注入。 */
const props = defineProps<{
  section: { label: string, unit: string, value: number, tiers: MugeTier[], action: MugeAction, note: string }
  disabled: boolean
  busy: boolean
}>()
const store = useMugeStore()
const progress = () => progressTo(props.section.value, props.section.tiers, props.section.unit)
</script>

<template>
  <section class="muge-card muge-bar">
    <div class="muge-bar__value">
      <span>{{ section.label }}</span>
      <strong>{{ section.value.toLocaleString('zh-CN') }}<small>{{ section.unit }}</small></strong>
    </div>
    <div class="muge-bar__progress">
      <div class="muge-track" aria-hidden="true">
        <i :style="{ width: `${progress().percent}%` }" />
      </div>
      <span>{{ progress().text }}<em> · {{ section.note }}</em></span>
    </div>
    <NButton type="primary" :secondary="!claimable(section.tiers)" :disabled="disabled || !claimable(section.tiers)" :loading="busy" @click="store.request(section.action)">
      {{ claimable(section.tiers) ? `领取 ${claimable(section.tiers)} 档奖励` : '暂无可领取' }}
    </NButton>
  </section>

  <div class="muge-grid">
    <article v-for="tier in section.tiers" :key="tier.id" class="muge-card muge-item" :class="`is-${tierTone(tier.status).tone}`">
      <span class="muge-item__well"><img v-if="tier.rewards[0]" :src="tier.rewards[0].image" alt=""></span>
      <div class="muge-item__main">
        <strong>{{ compact(tier.threshold) }}{{ section.unit }}</strong>
        <span v-for="reward in tier.rewards" :key="reward.id">{{ reward.name }} <b>×{{ reward.count.toLocaleString('zh-CN') }}</b></span>
      </div>
      <span class="muge-status" :class="`is-${tierTone(tier.status).tone}`">
        <span v-if="tier.status === 3" class="i-carbon-checkmark" aria-hidden="true" />{{ tierTone(tier.status).text }}
      </span>
    </article>
  </div>
</template>

<style scoped src="./styles/muge-common.css"></style>
