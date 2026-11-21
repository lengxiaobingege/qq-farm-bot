<script setup lang="ts">
/**
 * 实体卡片公共基座：农场土地卡（FarmLandCard）与牧场动物卡（RanchAnimalCard）共用同一套骨架。
 *
 * 只负责布局与通用状态外观，业务数据、配色、进度形态、标签/操作全部通过 props + slot 由使用方提供：
 *   - top     顶部标签（土地编号/土质 or 窝棚/巨大徽章）
 *   - media   图片区（作物/动物图）
 *   - name    名称
 *   - state   状态徽章/倒计时
 *   - progress 进度条 or 生产轮次
 *   - footer  性状标签 or 操作按钮
 *
 * 配色用 CSS 变量，使用方在自己的 class 上覆盖 --ec-bg/line/ink/chip/tint 即可共用同一套外观：
 * 农场 .plot--lv* 与牧场 .pen--giant 都是这套变量的实例。
 * 公共组件不 import 任何 store，数据动作留在各使用方组件，保证农场直调 / 牧场两段确认链路不被污染。
 */
withDefaults(defineProps<{
  /** 交互形态：决定 role/tabindex/键盘激活，农场选择态与详情态用得到。 */
  interactive?: boolean
  selectable?: boolean
  selected?: boolean
  disabled?: boolean
  titleText?: string
  ariaLabel?: string
}>(), {
  interactive: false,
  selectable: false,
  selected: false,
  disabled: false,
  titleText: '',
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
    class="entity-card"
    :class="{
      'entity-card--interactive': interactive,
      'entity-card--selectable': selectable,
      'entity-card--selected': selectable && selected,
      'entity-card--disabled': selectable && disabled,
    }"
    :role="interactive ? (selectable ? 'checkbox' : 'button') : undefined"
    :tabindex="interactive && !(selectable && disabled) ? 0 : undefined"
    :aria-checked="selectable ? selected : undefined"
    :aria-disabled="selectable ? disabled : undefined"
    :aria-label="ariaLabel || undefined"
    :title="titleText || undefined"
    @click="interactive && emit('activate')"
    @keydown="interactive && onKeydown($event)"
  >
    <header v-if="$slots.top" class="entity-card__top">
      <slot name="top" />
    </header>

    <div v-if="$slots.media" class="entity-card__media">
      <slot name="media" />
    </div>

    <div v-if="$slots.name" class="entity-card__name">
      <slot name="name" />
    </div>

    <div v-if="$slots.state" class="entity-card__state">
      <slot name="state" />
    </div>

    <div v-if="$slots.progress" class="entity-card__progress">
      <slot name="progress" />
    </div>

    <footer v-if="$slots.footer" class="entity-card__footer">
      <slot name="footer" />
    </footer>
  </article>
</template>

<style scoped>
.entity-card {
  /* 默认取农场普通土地 / 牧场普通窝的干草色系；使用方 class 可覆盖整组变量 */
  --ec-bg: #fbf8f1;
  --ec-line: #e6dbc2;
  --ec-ink: #86642e;
  --ec-chip: #f1e7d2;
  --ec-tint: #c9a867;
  --ec-media-size: 48px;
  --ec-progress-gap: 6px;
  --ec-footer-gap: 8px;

  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  padding: 8px 10px 9px;
  border: 1px solid var(--ec-line);
  border-radius: 14px;
  color: var(--ui-ink);
  background: var(--ec-bg);
  box-shadow: 0 1px 2px rgba(45, 66, 52, 0.05);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
}

.entity-card--interactive {
  cursor: pointer;
  user-select: none;
}
.entity-card--interactive:hover {
  border-color: color-mix(in srgb, var(--ec-ink) 45%, var(--ec-line));
  box-shadow: 0 4px 14px rgba(45, 66, 52, 0.1);
}
.entity-card--interactive:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 60%, transparent);
  outline-offset: 2px;
}
.entity-card--selected,
.entity-card--selected:hover {
  border-color: var(--ui-primary);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--ui-primary) 22%, transparent),
    inset 0 0 0 1px var(--ui-primary);
}
.entity-card--disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.entity-card__top {
  display: flex;
  width: 100%;
  height: 20px;
  align-items: center;
  gap: 4px;
}

.entity-card__media {
  display: grid;
  width: var(--ec-media-size);
  height: var(--ec-media-size);
  margin-top: 2px;
  place-items: center;
}

.entity-card__name {
  width: 100%;
  margin-top: 4px;
  overflow: hidden;
  font-size: 12px;
  font-weight: var(--fw-650);
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-card__state {
  display: flex;
  max-width: 100%;
  height: 20px;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}

.entity-card__progress {
  width: 100%;
  margin-top: var(--ec-progress-gap);
}

.entity-card__footer {
  display: flex;
  width: 100%;
  min-height: 20px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: var(--ec-footer-gap);
  padding-top: 6px;
  border-top: 1px dashed color-mix(in srgb, var(--ec-ink) 22%, transparent);
}

.dark .entity-card {
  border-color: color-mix(in srgb, var(--ec-tint) 28%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--ec-tint) 12%, #1d2228) 0%, #1a1f25 70%);
  box-shadow: none;
}
.dark .entity-card__footer {
  border-top-color: rgba(255, 255, 255, 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .entity-card {
    transition: none;
  }
}
</style>
