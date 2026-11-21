<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAccountStore } from '@/stores/account'
import { useMugeStore } from '@/stores/muge'

/** 牧场人格：逐题保存，选中后自动进入下一题；切账号时重置答题状态。 */
const store = useMugeStore()
const { state, busy, needsRefresh } = storeToRefs(store)
const { currentAccountId } = storeToRefs(useAccountStore())
const answering = ref(false)
const questionIndex = ref(0)
const disabled = computed(() => busy.value || needsRefresh.value || !state.value?.active)

const questions = computed(() => state.value?.questions || [])
const question = computed(() => questions.value[questionIndex.value])
const personality = computed(() => state.value?.personality || null)
const answers = computed(() => personality.value?.answers || {})
const allAnswered = computed(() => questions.value.length > 0 && questions.value.every(q => answers.value[q.id]))
const isLast = computed(() => questionIndex.value === questions.value.length - 1)

async function startSurvey() {
  if (disabled.value || !await store.request('saveAnswers', { answers: {}, clear: true }) || needsRefresh.value)
    return
  answering.value = true
  questionIndex.value = 0
}
async function answer(value: number) {
  if (!question.value || disabled.value)
    return
  const index = questionIndex.value
  const saved = await store.request('saveAnswers', { answers: { [question.value.id]: value } })
  if (saved && index < questions.value.length - 1 && questionIndex.value === index)
    questionIndex.value++
}
async function settle() {
  if (await store.request('settle'))
    answering.value = false
}

watch(currentAccountId, () => {
  answering.value = false
  questionIndex.value = 0
})
</script>

<template>
  <EmptyState v-if="!personality" title="牧场人格暂不可用" icon="i-carbon-user-profile" />

  <section v-else-if="answering && question" class="muge-card muge-quiz" aria-label="牧场人格测试">
    <header class="muge-quiz__head">
      <span>第 <b>{{ questionIndex + 1 }}</b> / {{ questions.length }} 题</span>
      <NButton text :disabled="busy" @click="answering = false">
        退出测试
      </NButton>
    </header>
    <div class="muge-track" aria-hidden="true">
      <i :style="{ width: `${(questionIndex + 1) / questions.length * 100}%` }" />
    </div>
    <h3 class="muge-quiz__title">
      {{ question.title }}
    </h3>
    <div class="muge-quiz__options" role="radiogroup" :aria-label="question.title">
      <button
        v-for="option in question.options"
        :key="option.value"
        type="button"
        role="radio"
        class="muge-option"
        :aria-checked="answers[question.id] === option.value"
        :disabled="disabled"
        @click="answer(option.value)"
      >
        <span class="muge-option__letter">{{ option.label }}</span>
        <span class="muge-option__text">{{ option.text }}</span>
        <span v-if="answers[question.id] === option.value" class="muge-option__check i-carbon-checkmark-filled" aria-hidden="true" />
      </button>
    </div>
    <footer class="muge-quiz__foot">
      <NButton secondary :disabled="busy || questionIndex === 0" @click="questionIndex--">
        上一题
      </NButton>
      <NButton v-if="isLast" type="primary" :loading="busy" :disabled="disabled || !allAnswered" @click="settle">
        查看人格结果
      </NButton>
      <NButton v-else secondary :disabled="busy || !answers[question.id]" @click="questionIndex++">
        下一题
      </NButton>
    </footer>
  </section>

  <section v-else class="muge-card muge-result">
    <img v-if="personality.image" :src="personality.image" alt="我的牧场人格测试结果" class="muge-result__poster">
    <span v-else class="muge-result__placeholder" aria-hidden="true"><span class="i-carbon-user-profile" /></span>
    <div class="muge-result__body">
      <div>
        <h3>{{ personality.personalityId ? '我的牧场人格' : '测一测你的牧场人格' }}</h3>
        <p>
          {{ personality.personalityId
            ? '根据经营农场的习惯得出，活动期间可以重新测试，新结果会覆盖旧结果。'
            : '根据经营农场的习惯得出你的牧场人格，测试结果可以分享给好友。' }}
        </p>
      </div>
      <ul class="muge-result__facts">
        <li>
          <span>题目</span>
          <b>{{ questions.length }} 道</b>
        </li>
        <li>
          <span>已测试</span>
          <b>{{ personality.settleCount || (personality.personalityId ? 1 : 0) }} 次</b>
        </li>
        <li :class="{ 'is-ready': personality.personalityId && !personality.shareRewardClaimed }">
          <span>首次分享奖励</span>
          <b>{{ personality.shareRewardClaimed ? '已领取' : personality.personalityId ? '可领取' : '完成测试后领取' }}</b>
        </li>
      </ul>
      <div class="muge-result__actions">
        <NButton :type="personality.personalityId ? 'default' : 'primary'" :secondary="!!personality.personalityId" :disabled="disabled" @click="startSurvey">
          {{ personality.personalityId ? '重新测试' : '开始测试' }}
        </NButton>
        <NButton v-if="personality.personalityId && !personality.shareRewardClaimed" type="primary" :disabled="disabled" @click="store.request('claimShare')">
          领取首次分享奖励
        </NButton>
      </div>
    </div>
  </section>
</template>

<style scoped src="./styles/muge-common.css"></style>

<style scoped src="./styles/muge-personality.css"></style>
