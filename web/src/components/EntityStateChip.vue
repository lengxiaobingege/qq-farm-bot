<script setup lang="ts">
/**
 * 农场土地页与牧场动物页共享的状态统计胶囊。
 *
 * 农场以只读 span 展示；牧场以 button 展示并支持筛选。两者使用同一套外观，
 * 业务方只提供文案、数值、图标与交互状态。
 */
withDefaults(defineProps<{
  label: string
  value: string | number
  icon?: string
  /** 自定义 SVG path（农场“空闲/枯萎”等无 Carbon 图标时使用）。 */
  path?: string
  interactive?: boolean
  active?: boolean
  disabled?: boolean
  zero?: boolean
}>(), {
  icon: '',
  path: '',
  interactive: false,
  active: false,
  disabled: false,
  zero: false,
})

const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    class="entity-state-chip"
    :class="{ 'is-active': active, 'is-zero': zero }"
    :type="interactive ? 'button' : undefined"
    :disabled="interactive ? disabled : undefined"
    :aria-pressed="interactive ? active : undefined"
    @click="interactive && emit('select')"
  >
    <svg v-if="path" :class="icon" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path :d="path" />
    </svg>
    <span v-else-if="icon" :class="icon" aria-hidden="true" />
    {{ label }}<b>{{ value }}</b>
  </component>
</template>

<style scoped>
.entity-state-chip.entity-state-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px 3px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.entity-state-chip b {
  margin-left: 2px;
  color: var(--ui-ink);
  font-weight: var(--fw-650);
}

.entity-state-chip.is-zero {
  opacity: 0.65;
}

button.entity-state-chip {
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

button.entity-state-chip:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--ui-primary) 34%, transparent);
  color: var(--ui-primary);
}

button.entity-state-chip.is-active {
  border-color: transparent;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-weight: var(--fw-600);
}

button.entity-state-chip:disabled {
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  button.entity-state-chip {
    transition: none;
  }
}
</style>
