<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { provideRanchActions, useRanchUnmountReset } from '@/components/ranch/ranch-shared'
import RanchQuoteModal from '@/components/ranch/RanchQuoteModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'

type Section = 'overview' | 'personal' | 'illustrated' | 'mall' | 'friends' | 'activity'
/** instance 相同的页签共用一个面板实例（同一份数据，只切换展示），不重新读取。 */
interface Tab { key: string, label: string, icon: string, panel: any, props?: Record<string, unknown>, instance?: string }

const RanchOverview = defineAsyncComponent(() => import('@/views/RanchOverview.vue'))
const RanchAnimalsPanel = defineAsyncComponent(() => import('@/components/ranch/RanchAnimalsPanel.vue'))
const RanchFacilitiesPanel = defineAsyncComponent(() => import('@/components/ranch/RanchFacilitiesPanel.vue'))
const RanchBagPanel = defineAsyncComponent(() => import('@/components/ranch/RanchBagPanel.vue'))
const RanchTaskPanel = defineAsyncComponent(() => import('@/components/ranch/RanchTaskPanel.vue'))
const RanchBookPanel = defineAsyncComponent(() => import('@/components/ranch/RanchBookPanel.vue'))
const RanchMallPanel = defineAsyncComponent(() => import('@/components/ranch/RanchMallPanel.vue'))
const RanchFriendsPanel = defineAsyncComponent(() => import('@/components/ranch/RanchFriendsPanel.vue'))
const RanchActivityPanel = defineAsyncComponent(() => import('@/components/ranch/RanchActivityPanel.vue'))

// 牧场自有分区命名（不与农场撞名）：牧家（动物/设施/背包/任务）、图鉴、商城等。
const SECTIONS: Record<Section, Tab[]> = {
  overview: [{ key: 'overview', label: '牧野', icon: 'i-carbon-dashboard', panel: RanchOverview }],
  personal: [
    { key: 'animals', label: '我的牧场', icon: 'i-carbon-pet-image-o', panel: RanchAnimalsPanel },
    { key: 'facilities', label: '牧场设施', icon: 'i-carbon-building', panel: RanchFacilitiesPanel },
    { key: 'bag', label: '我的背包', icon: 'i-carbon-box', panel: RanchBagPanel },
    { key: 'tasks', label: '我的任务', icon: 'i-carbon-task', panel: RanchTaskPanel },
  ],
  illustrated: [
    { key: 'normal', label: '动物图鉴', icon: 'i-carbon-book', panel: RanchBookPanel, props: { kind: 'normal' }, instance: 'book' },
    { key: 'giant', label: '巨大图鉴', icon: 'i-carbon-gem', panel: RanchBookPanel, props: { kind: 'giant' }, instance: 'book' },
  ],
  mall: [
    { key: 'shop', label: '牧场商店', icon: 'i-carbon-shopping-bag', panel: RanchMallPanel, props: { tab: 'shop' } },
    { key: 'market', label: '仓鼠集市', icon: 'i-carbon-store', panel: RanchMallPanel, props: { tab: 'market' } },
    { key: 'cans', label: '罐头商城', icon: 'i-carbon-shopping-cart', panel: RanchMallPanel, props: { tab: 'cans' } },
  ],
  friends: [{ key: 'friends', label: '好友', icon: 'i-carbon-user-multiple', panel: RanchFriendsPanel }],
  activity: [{ key: 'activity', label: '活动', icon: 'i-carbon-gift', panel: RanchActivityPanel }],
}

/** 顶部分区切换：侧边栏只放一个「牧场」入口，农牧场各分区在这里切。 */
const SECTION_NAV: Array<{ key: Section, label: string, icon: string, name: string }> = [
  { key: 'overview', label: '牧野', icon: 'i-carbon-dashboard', name: 'ranch' },
  { key: 'personal', label: '牧家', icon: 'i-carbon-sprout', name: 'ranch-personal' },
  { key: 'illustrated', label: '图鉴', icon: 'i-carbon-book', name: 'ranch-illustrated' },
  { key: 'activity', label: '活动', icon: 'i-carbon-gift', name: 'ranch-activity' },
  { key: 'friends', label: '好友', icon: 'i-carbon-user-multiple', name: 'ranch-friends' },
  { key: 'mall', label: '商城', icon: 'i-carbon-shopping-cart', name: 'ranch-game-mall' },
]

const route = useRoute()
const router = useRouter()

// 牧场自带吸顶分区导航，而面板内工具栏也用 .panel-sticky 锚定 top:0、z-index:6，
// 滚动时会盖住分区导航。这里测量导航实际高度写入 --sticky-top，让次级工具栏吸附在导航下方。
const navRef = ref<HTMLElement | null>(null)
const pageRef = ref<HTMLElement | null>(null)
let navObserver: ResizeObserver | undefined
function syncStickyTop() {
  const height = Math.ceil(navRef.value?.getBoundingClientRect().height || 0)
  pageRef.value?.style.setProperty('--sticky-top', `${height}px`)
}
onMounted(() => {
  syncStickyTop()
  if (navRef.value && typeof ResizeObserver !== 'undefined') {
    navObserver = new ResizeObserver(syncStickyTop)
    navObserver.observe(navRef.value)
  }
})
onBeforeUnmount(() => navObserver?.disconnect())

const { currentAccountId } = storeToRefs(useAccountStore())
const { pending } = provideRanchActions()
const { busy } = storeToRefs(useRanchStore())
// 读取中允许切换页签（旧请求的结果会被丢弃）；写入和确认期间锁定。
const locked = computed(() => busy.value || !!pending.value)
useRanchUnmountReset()

const section = computed<Section>(() => (route.meta.ranchSection as Section) || 'personal')
const tabs = computed(() => SECTIONS[section.value] || SECTIONS.personal)
const current = computed(() => tabs.value.find(tab => tab.key === route.query.tab) || tabs.value[0]!)

function selectSection(item: { key: Section, name: string }) {
  if (item.key === section.value || locked.value)
    return
  void router.push({ name: item.name })
}

function selectTab(key: string) {
  if (key === current.value.key || locked.value)
    return
  router.replace({ query: { ...route.query, tab: key === tabs.value[0]!.key ? undefined : key } })
}
</script>

<template>
  <div ref="pageRef" class="page-stack ranch-page">
    <!-- 牧场主导航：分区在上、子页签在下，滚动时整体吸顶 -->
    <div ref="navRef" class="ranch-nav">
      <nav class="ranch-nav__sections" aria-label="牧场分区">
        <button
          v-for="item in SECTION_NAV"
          :key="item.key"
          type="button"
          class="ranch-nav__section"
          :class="{ 'is-active': item.key === section }"
          :aria-current="item.key === section ? 'page' : undefined"
          :disabled="locked && item.key !== section"
          @click="selectSection(item)"
        >
          <span :class="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div v-if="tabs.length > 1" class="ranch-nav__tabs" role="tablist" aria-label="牧场页签">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="ranch-nav__tab"
          :class="{ 'is-active': tab.key === current.key }"
          :aria-selected="tab.key === current.key"
          :disabled="locked && tab.key !== current.key"
          @click="selectTab(tab.key)"
        >
          <span :class="tab.icon" aria-hidden="true" />{{ tab.label }}
        </button>
      </div>
    </div>

    <EmptyState v-if="!currentAccountId" title="请先选择账号" description="在左侧选择账号后查看牧场" icon="i-carbon-user-avatar" />
    <component :is="current.panel" v-else :key="`${currentAccountId}:${current.instance || current.key}`" v-bind="current.props" />

    <RanchQuoteModal />
  </div>
</template>

<style scoped>
.ranch-page {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}

/* 吸顶导航：分区是主层级，子页签是次层级，两者不再分居页头与内容区。 */
.ranch-nav {
  position: sticky;
  top: 0;
  z-index: 7;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 6px 0;
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  backdrop-filter: blur(8px);
}

.ranch-nav__sections {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  gap: 2px;
  overflow-x: auto;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-surface-soft);
  scrollbar-width: none;
}

.ranch-nav__sections::-webkit-scrollbar {
  display: none;
}

.ranch-nav__section {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.ranch-nav__section:hover:not(:disabled) {
  color: var(--ui-primary);
}

.ranch-nav__section.is-active {
  background: var(--ui-surface);
  box-shadow:
    0 1px 2px rgba(38, 74, 52, 0.12),
    inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 22%, transparent);
  color: var(--ui-primary);
  font-weight: var(--fw-600);
}

.ranch-nav__section:disabled,
.ranch-nav__tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ranch-nav__tabs {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  gap: 2px;
  overflow-x: auto;
  padding-left: 12px;
  border-left: 1px solid var(--ui-border);
  scrollbar-width: none;
}

.ranch-nav__tabs::-webkit-scrollbar {
  display: none;
}

.ranch-nav__tab {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.ranch-nav__tab:hover:not(:disabled) {
  color: var(--ui-ink);
  background: var(--ui-surface-soft);
}

.ranch-nav__tab.is-active {
  color: var(--ui-primary);
  font-weight: var(--fw-600);
}

.ranch-nav__tab.is-active::after {
  display: none;
}

/* 面板纵向排列，工具栏在桌面端吸在导航下方。 */
:deep(.personal-panel) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

:deep(.personal-panel__card) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

@media (max-width: 860px) {
  .ranch-nav__sections {
    width: 100%;
  }

  .ranch-nav__tabs {
    padding-left: 0;
    border-left: 0;
  }
}

@media (max-width: 640px) {
  :deep(.personal-panel) {
    gap: 12px;
  }

  .ranch-nav__section {
    padding-inline: 11px;
  }
}
</style>
