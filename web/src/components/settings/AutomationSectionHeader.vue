<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  tone?: 'green' | 'amber' | 'blue' | 'violet'
}>(), { tone: 'green' })
</script>

<template>
  <header class="panel-head">
    <div class="panel-head__icon" :class="`is-${tone}`">
      <slot name="icon">
        <slot />
      </slot>
    </div>
    <div class="min-w-0">
      <h4 class="panel-head__title">
        {{ title }}
      </h4>
      <p v-if="description" class="panel-head__desc">
        {{ description }}
      </p>
    </div>
  </header>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.panel-head__icon {
  display: flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 22px;
}

.panel-head__icon img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.panel-head__icon.is-green {
  color: var(--ui-primary);
  background: linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 20%, transparent), color-mix(in srgb, var(--ui-primary) 8%, transparent));
}
.panel-head__icon.is-amber {
  color: #b45309;
  background: linear-gradient(145deg, rgb(245 158 11 / 22%), rgb(245 158 11 / 8%));
}
.panel-head__icon.is-blue {
  color: #2563eb;
  background: linear-gradient(145deg, rgb(59 130 246 / 22%), rgb(59 130 246 / 8%));
}
.panel-head__icon.is-violet {
  color: #7c3aed;
  background: linear-gradient(145deg, rgb(139 92 246 / 22%), rgb(139 92 246 / 8%));
}

:global(.dark) .panel-head__icon.is-amber { color: #fcd34d; }
:global(.dark) .panel-head__icon.is-blue { color: #93c5fd; }
:global(.dark) .panel-head__icon.is-violet { color: #c4b5fd; }

.panel-head__title {
  color: var(--ui-ink);
  font-size: 17px;
  font-weight: var(--fw-700);
  line-height: 1.3;
}

.panel-head__desc {
  margin-top: 3px;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.4;
}
</style>
