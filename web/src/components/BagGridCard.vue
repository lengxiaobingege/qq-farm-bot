<script setup lang="ts">
/**
 * 背包物品卡公共基座：农场 BagPanel 与牧场 RanchBagPanel 共用同一套卡片骨架。
 *
 * 只负责卡片外观与通用结构（批量角标 / 图标 / 名称 / 元信息 / 说明 / UID / 底栏），
 * 分类口径、数量格式、操作按钮和业务确认全部由使用方通过 slot 提供：
 *   - cue    右上角批量选择角标（农场专用；牧场不传）
 *   - thumb  图标内容（img / 首字母兜底 / 锁标）
 *   - name   名称文本
 *   - meta   分类、等级、价格、锁定状态等短标签
 *   - line   可省略的说明行（农场变异信息）
 *   - ids    可省略的编号行（农场 UID）
 *   - footer 底栏：左侧数量，右侧操作按钮
 *
 * 使用 farm-card 全局类，确保牧场背包与农场背包使用同一套卡片材质。
 */
withDefaults(defineProps<{
  /** 图标兜底字符。 */
  fallback?: string
  /** 名称 title；不传时不显示。 */
  nameTitle?: string
  /** 是否可点击（农场批量模式下开启）。 */
  interactive?: boolean
  /** 是否作为复选框暴露语义。 */
  selectable?: boolean
  selected?: boolean
  disabled?: boolean
  ariaLabel?: string
}>(), {
  fallback: '物',
  nameTitle: '',
  interactive: false,
  selectable: false,
  selected: false,
  disabled: false,
  ariaLabel: '',
})

const emit = defineEmits<{ activate: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('activate')
  }
}
</script>

<template>
  <article
    class="bag-item-card farm-card"
    :class="{
      'bag-item-card--interactive': interactive,
      'bag-item-card--selectable': interactive && selectable,
      'bag-item-card--selected': interactive && selectable && selected,
      'bag-item-card--disabled': interactive && disabled,
    }"
    :role="interactive ? (selectable ? 'checkbox' : 'button') : undefined"
    :tabindex="interactive && !disabled ? 0 : undefined"
    :aria-checked="interactive && selectable ? selected : undefined"
    :aria-disabled="interactive ? disabled : undefined"
    :aria-label="ariaLabel || undefined"
    @click="interactive && emit('activate')"
    @keydown="interactive && onKeydown($event)"
  >
    <div v-if="$slots.cue" class="bag-item-card__cue">
      <slot name="cue" />
    </div>

    <div class="bag-item-card__thumb thumb-wrap" :data-fallback="fallback">
      <slot name="thumb" />
    </div>

    <div class="bag-item-card__name" :title="nameTitle || undefined">
      <slot name="name" />
    </div>

    <div v-if="$slots.meta" class="bag-item-card__meta">
      <slot name="meta" />
    </div>

    <div v-if="$slots.line" class="bag-item-card__line">
      <slot name="line" />
    </div>

    <div v-if="$slots.ids" class="bag-item-card__ids">
      <slot name="ids" />
    </div>

    <footer v-if="$slots.footer" class="bag-item-card__foot">
      <slot name="footer" />
    </footer>
  </article>
</template>

<style scoped>
.bag-item-card.bag-item-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 12px 12px !important;
  text-align: center;
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;
}

.bag-item-card--interactive {
  cursor: pointer;
}

.bag-item-card--selectable:hover {
  outline: 1px solid color-mix(in srgb, var(--ui-primary) 45%, transparent);
}

.bag-item-card--selected,
.bag-item-card--selected:hover {
  outline: 2px solid var(--ui-primary);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ui-primary-soft) 70%, var(--ui-surface)) !important;
}

.bag-item-card--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bag-item-card--interactive:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 60%, transparent);
  outline-offset: 2px;
}

.bag-item-card__cue {
  position: absolute;
  top: 8px;
  right: 8px;
}

.bag-item-card__thumb {
  position: relative;
  display: grid;
  width: 72px;
  height: 72px;
  margin-bottom: 8px;
  place-items: center;
  border-radius: 18px;
  background: var(--ui-surface-soft);
}

.bag-item-card__thumb :deep(img) {
  max-width: 56px;
  max-height: 56px;
  object-fit: contain;
}

.bag-item-card__thumb :deep(.bag-item__fallback) {
  color: var(--ui-subtle);
  font-size: 24px;
  font-weight: var(--fw-700);
}

.bag-item-card__thumb :deep(.bag-item__lock) {
  position: absolute;
  top: -6px;
  left: -6px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--ui-warning-fill);
  box-shadow: 0 0 0 2px var(--ui-surface-strong);
  font-size: 12px;
}

.bag-item-card__name {
  width: 100%;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: var(--fw-650);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item-card__meta {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  color: var(--ui-muted);
  font-size: 11px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.bag-item-card__meta :deep(.bag-type) {
  padding: 0 6px;
  border-radius: 5px;
  font-weight: var(--fw-600);
}

.bag-item-card__meta :deep(.is-sellable) {
  color: var(--ui-primary);
}

.bag-item-card__meta :deep(.is-locked) {
  color: var(--ui-warning);
  font-weight: var(--fw-600);
}

.bag-item-card__line {
  width: 100%;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item-card__ids {
  color: var(--ui-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.bag-item-card__foot {
  display: flex;
  width: 100%;
  min-height: 34px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--ui-border);
}

.bag-item-card__foot :deep(.bag-item__qty) {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 16px;
  font-weight: var(--fw-700);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bag-item-card__foot :deep(.bag-item__qty small) {
  margin-right: 1px;
  color: var(--ui-muted);
  font-size: 12px;
  font-weight: var(--fw-600);
}

.bag-item-card__foot :deep(.bag-item__qty.is-hours) {
  color: var(--ui-blue);
  font-size: 14px;
}

.bag-item-card__foot :deep(.bag-item__ops) {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.bag-item-card__foot :deep(.bag-item__actions) {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  margin-inline-start: auto;
}

@media (prefers-reduced-motion: reduce) {
  .bag-item-card {
    transition: none;
  }
}
</style>
