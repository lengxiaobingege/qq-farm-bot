<script setup lang="ts">
import type { PetItem } from '@/stores/pet-diary'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { usePetDiaryStore } from '@/stores/pet-diary'
import PetMascot from './PetMascot.vue'
import PetPaw from './PetPaw.vue'
import PetSolarScene from './PetSolarScene.vue'
import PetTreasurePanel from './PetTreasurePanel.vue'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const friends = useFriendStore()
const diary = usePetDiaryStore()
const { activity: pet, pending, error, notice, stale, records, plunderRecords, friend } = storeToRefs(diary)
const tab = ref('home')
const friendId = ref('')
const logKind = ref<'interact' | 'plunder'>('interact')
const recordEntries = computed(() => logKind.value === 'plunder' ? plunderRecords.value : records.value)
const treasurePanel = ref<InstanceType<typeof PetTreasurePanel> | null>(null)
const quantities = ref<Record<string, number>>({})
const scrollViewport = ref<HTMLElement | null>(null)
const walletMenu = ref<HTMLDetailsElement | null>(null)
const recordDialog = ref<HTMLDialogElement | null>(null)
const giftPanel = ref<HTMLElement | null>(null)
const exchangeDialog = ref<HTMLDialogElement | null>(null)
const selectedGoodsId = ref('')
const selectedTermId = ref('')
const clientNow = ref(Date.now())
const offset = ref(0)
const timer = window.setInterval(() => clientNow.value = Date.now(), 1000)
onUnmounted(() => {
  window.clearInterval(timer)
  diary.clearNotice()
})
const now = computed(() => clientNow.value + offset.value)
const busy = computed(() => !!pending.value || stale.value || !pet.value?.active)
const tabs = [
  { id: 'home', label: '比熊之家', icon: '' },
  { id: 'stories', label: '爪印手记', icon: 'i-carbon-book' },
  { id: 'shop', label: '拾物小铺', icon: 'i-carbon-store' },
  { id: 'solar', label: '节令小礼', icon: 'i-carbon-sun' },
]
const growthPercent = computed(() => Math.min(100, (pet.value?.nurture.growth || 0) / (pet.value?.nurture.adultGrowth || 1) * 100))
const feedHint = computed(() => {
  const state = pet.value
  if (!state?.active || !state.nurture.initialized || (state.nurture.adult && !state.nurture.dogGranted))
    return ''
  const count = state.nurture.adult ? state.hunt.count : state.nurture.feedCount
  const limit = state.nurture.adult ? state.hunt.limit : state.nurture.feedLimit
  if (count >= limit)
    return state.nurture.adult ? '今日寻宝次数已用完' : '今日投喂次数已用完'
  const costs = state.nurture.adult ? state.hunt.costs : state.nurture.feedCosts
  if (costs.some(item => !state.balances.find(balance => balance.id === item.id)?.known))
    return '请刷新确认元气糕余额'
  if (costs.some(item => BigInt(state.balances.find(balance => balance.id === item.id)?.count || '0') < BigInt(item.count)))
    return '元气糕不足，请先收获活动作物'
  return ''
})
const unlocked = computed(() => pet.value?.stories.filter(s => s.unlocked).length || 0)
const albumPercent = computed(() => pet.value?.stories.length ? unlocked.value / pet.value.stories.length * 100 : 0)
const feedLabel = computed(() => {
  const state = pet.value
  if (!state)
    return ''
  return state.nurture.adult ? `今日寻宝 ${state.hunt.count} / ${state.hunt.limit}` : `今日投喂 ${state.nurture.feedCount} / ${state.nurture.feedLimit}`
})
const seedRewards = computed(() => pet.value?.seeds.days.find(d => d.claimable && !d.claimed)?.rewards || pet.value?.seeds.days[0]?.rewards || [])
const claimableTreasures = computed(() => pet.value?.treasures.some(t => t.status === 3 || (t.status === 2 && t.endTime > 0 && t.endTime <= now.value)))
const escortingCount = computed(() => pet.value?.treasures.filter(t => t.status === 2 && t.endTime > now.value).length || 0)
const waitingCount = computed(() => pet.value?.treasures.filter(t => t.status === 1).length || 0)
const luckyStars = computed(() => pet.value?.balances.find(item => item.id === '1029'))
const activityRemaining = computed(() => {
  const hours = Math.max(0, Math.ceil(((pet.value?.endTime || 0) - now.value) / 3600000))
  return pet.value?.active ? `${Math.floor(hours / 24)}天${hours % 24}时` : '活动已结束'
})
const currentTerm = computed(() => {
  const terms = pet.value?.solarTerms?.terms || []
  return terms.find(term => term.id === selectedTermId.value)
    || terms.find(term => Number(term.startTime) * 1000 <= now.value && Number(term.endTime) * 1000 >= now.value)
    || terms[0]
})
const exchangeItem = computed(() => pet.value?.shop.find(goods => goods.id === selectedGoodsId.value))
const exchangeQuantity = computed({
  get: () => quantities.value[selectedGoodsId.value] ?? 1,
  set: (value: number) => quantities.value[selectedGoodsId.value] = value,
})
const exchangeLimit = computed(() => Math.min(9999, Number(exchangeItem.value?.remaining ?? 9999)))
const validQuantity = computed(() => Number.isSafeInteger(exchangeQuantity.value) && exchangeQuantity.value > 0 && exchangeQuantity.value <= exchangeLimit.value)
const exchangeCosts = computed(() => validQuantity.value ? exchangeItem.value?.costs.map(item => ({ ...item, count: String(BigInt(item.count) * BigInt(exchangeQuantity.value)) })) || [] : [])
const affordableQuantity = computed(() => {
  const costs = new Map<string, bigint>()
  for (const item of exchangeItem.value?.costs || [])
    costs.set(item.id, (costs.get(item.id) || 0n) + BigInt(item.count))
  let limit = BigInt(exchangeLimit.value)
  for (const [id, cost] of costs) {
    const balance = pet.value?.balances.find(item => item.id === id)
    if (!balance?.known)
      return 0
    if (cost > 0n && BigInt(balance.count) / cost < limit)
      limit = BigInt(balance.count) / cost
  }
  return Number(limit)
})
const canExchange = computed(() => !busy.value && exchangeItem.value?.exchangeable && validQuantity.value && exchangeQuantity.value <= affordableQuantity.value)
const exchangeHint = computed(() => {
  if (!exchangeItem.value?.safeCosts)
    return '此商品当前不可兑换'
  if (!exchangeLimit.value)
    return '此商品已兑完'
  if (!validQuantity.value)
    return `请输入 1–${exchangeLimit.value} 之间的整数`
  if (exchangeQuantity.value > affordableQuantity.value)
    return '道具余额不足'
  return ''
})
async function openExchange(id: string) {
  selectedGoodsId.value = id
  quantities.value[id] = 1
  await nextTick()
  exchangeDialog.value?.showModal()
}
async function submitExchange() {
  if (!canExchange.value)
    return
  const id = selectedGoodsId.value
  const owner = accountId()
  await diary.operate('exchange', { goodsId: id, count: exchangeQuantity.value })
  if (owner === accountId() && selectedGoodsId.value === id && !error.value)
    exchangeDialog.value?.close()
}
async function showRecords() {
  diary.clearNotice()
  await nextTick()
  recordDialog.value?.showModal()
  await readLogs('interact')
}
function feedBalance(item: PetItem) {
  const balance = pet.value?.balances.find(balance => balance.id === item.id)
  return balance?.known ? `${balance.count} / ${item.count}` : `待刷新 / ${item.count}`
}
function date(value: number) {
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
function time(value: number) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function itemText(items: PetItem[] = []) {
  return items.map(i => `${i.name} ×${i.count}`).join('、')
}
function remaining(end: number) {
  const minutes = Math.max(0, Math.ceil((end - now.value) / 60000))
  return minutes > 0 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分` : '已到结算时间'
}
function accountId() {
  return String(accountStore.currentAccountId || '')
}
function load() {
  return diary.load(accountId())
}
function scrollToGift() {
  const viewport = scrollViewport.value
  const target = giftPanel.value
  if (!viewport || !target)
    return
  viewport.scrollBy({ top: target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12, behavior: 'smooth' })
}
async function loadFriends() {
  await friends.fetchFriends(accountId())
}
async function readLogs(kind: 'interact' | 'plunder') {
  logKind.value = kind
  await diary.readExtra(kind)
}
watch(() => accountStore.currentAccountId, () => {
  exchangeDialog.value?.close()
  recordDialog.value?.close()
  selectedGoodsId.value = ''
  selectedTermId.value = ''
  friendId.value = ''
  quantities.value = {}
  tab.value = 'home'
  void load()
}, { immediate: true })
watch(tab, () => {
  diary.clearNotice()
  if (scrollViewport.value)
    scrollViewport.value.scrollTop = 0
  walletMenu.value?.removeAttribute('open')
}, { flush: 'post' })
watch(pet, (value) => {
  if (value)
    offset.value = value.serverTime - Date.now()
})
</script>

<template>
  <ActivityShell theme="day">
    <div class="pet-diary" aria-label="萌宠成长日记">
      <header class="pet-header">
        <div class="pet-header__brand">
          <button type="button" class="pet-back" aria-label="返回活动列表" @click="emit('back')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4-8 8 8 8" /></svg>
            <span class="pet-back__text">活动列表</span>
          </button>
          <div class="pet-title">
            <small>活动中心</small>
            <h1>萌宠成长日记</h1>
          </div>
        </div>
        <span v-if="pet" class="pet-countdown" :title="`${date(pet.startTime)} — ${date(pet.endTime)}`">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 3h6" /></svg>
          <span class="pet-countdown__label">剩余：</span>{{ activityRemaining }}
        </span>
        <details v-if="pet" ref="walletMenu" class="pet-wallet-menu">
          <summary :aria-label="`查看活动道具余额，累计获得 ${pet.hunt.luckyStarTotal} 幸运星`">
            <img :src="luckyStars?.image || '/game-config/seed_images_named/seed_images/1029.png'" alt="">
            <strong>{{ luckyStars?.known ? Number(luckyStars.count).toLocaleString() : '—' }}</strong>
            <svg class="pet-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </summary>
          <div class="pet-wallet">
            <div v-for="item in pet.balances" :key="item.id" class="pet-wallet__row">
              <img :src="item.image" alt="">
              <span>{{ item.name }}<strong>{{ item.known ? Number(item.count).toLocaleString() : '待刷新' }}</strong></span>
            </div>
            <p>累计获得 {{ pet.hunt.luckyStarTotal }} 幸运星</p>
          </div>
        </details>
        <button v-if="pet" type="button" class="pet-refresh" :disabled="!!pending" :aria-label="pending === 'load' ? '刷新中' : '刷新活动'" @click="load">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" /><path d="M20 3.6v5h-5" /></svg>
        </button>
      </header>

      <div v-if="error || notice || pet?.warnings.length" class="pet-status">
        <p v-if="error" class="pet-message pet-message--error" role="alert">
          <span>{{ error }}</span>
          <button type="button" :disabled="!!pending" @click="load">
            重新刷新
          </button>
        </p>
        <p v-if="notice" class="pet-message pet-message--ok" role="status">
          {{ notice }}
        </p>
        <p v-for="warning in pet?.warnings || []" :key="warning" class="pet-message pet-message--warn">
          {{ warning }}
        </p>
      </div>

      <div ref="scrollViewport" class="pet-body" tabindex="0" :aria-label="`${tabs.find(entry => entry.id === tab)?.label}内容`">
        <div class="pet-content">
          <div v-if="!accountId()" class="pet-empty pet-empty--tall">
            请先选择账号
          </div>
          <div v-else-if="pending === 'load' && !pet" class="pet-empty pet-empty--tall" role="status">
            <span class="activity-spinner" />
            <strong>正在加载萌宠成长日记</strong>
          </div>

          <main v-if="pet && tab === 'home'" class="pet-home">
            <section class="pet-hero" aria-label="比熊之家">
              <div class="pet-hero__art">
                <PetMascot :stage="pet.nurture.adult ? 'adult' : 'puppy'" animated />
              </div>
              <div class="pet-hero__main">
                <div class="pet-hero__head">
                  <h2>比熊犬</h2>
                  <span class="pet-chip" :class="pet.nurture.adult ? 'pet-chip--gold' : 'pet-chip--blue'">{{ pet.nurture.adult ? '天工' : '稀有' }}</span>
                  <span class="pet-chip">{{ pet.nurture.adult ? '成年期' : '幼年期' }}</span>
                </div>
                <p class="pet-quote">
                  {{ pet.nurture.adult ? '我长大啦~以后这个家我来看着！' : '把我喂到成年，我就能去农场看家护院啦~' }}
                </p>
                <div class="pet-growth">
                  <div class="pet-growth__top">
                    <span>成长进度</span>
                    <b>{{ pet.nurture.adult ? '已达成' : `${pet.nurture.growth} / ${pet.nurture.adultGrowth}` }}</b>
                  </div>
                  <progress :value="pet.nurture.growth" :max="pet.nurture.adultGrowth" :aria-label="`成长进度 ${growthPercent.toFixed(0)}%`" />
                </div>
                <div class="pet-care">
                  <button v-if="!pet.nurture.initialized" type="button" class="pet-button pet-button--primary" :disabled="busy" @click="diary.operate('initialize')">
                    领养比熊
                  </button>
                  <button v-else-if="!pet.nurture.adult" type="button" class="pet-button pet-button--primary" :disabled="busy || !pet.nurture.canFeed" @click="diary.operate('feed')">
                    {{ pending === 'feed' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <button v-else-if="!pet.nurture.dogGranted" type="button" class="pet-button pet-button--primary" :disabled="busy" @click="diary.operate('claimDog')">
                    {{ pending === 'claimDog' ? '领取中…' : '领取永久比熊' }}
                  </button>
                  <button v-else type="button" class="pet-button pet-button--primary" :disabled="busy || !pet.hunt.canDraw" @click="diary.operate('draw')">
                    {{ pending === 'draw' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <span v-for="item in pet.nurture.adult ? pet.hunt.costs : pet.nurture.feedCosts" :key="item.id" class="pet-cost" :title="item.name">
                    <img :src="item.image" :alt="item.name">
                    <span>{{ feedBalance(item) }}</span>
                  </span>
                </div>
                <p class="pet-note">
                  {{ feedLabel }}
                </p>
                <p v-if="feedHint" class="pet-note pet-note--warning">
                  {{ feedHint }}
                </p>
                <div class="pet-quick">
                  <button type="button" class="pet-quick__item" :disabled="!!pending" @click="showRecords">
                    <PetPaw />互动记录
                  </button>
                  <button type="button" class="pet-quick__item" @click="scrollToGift">
                    <PetPaw />种子赠礼
                  </button>
                  <button v-if="pet.nurture.adult" type="button" class="pet-quick__item" @click="treasurePanel?.open()">
                    <PetPaw />宝藏护送
                    <em v-if="claimableTreasures">可领取</em>
                    <em v-else>护送中 {{ escortingCount }}</em>
                  </button>
                </div>
              </div>
            </section>

            <div class="pet-grid">
              <article id="pet-seed-gift" ref="giftPanel" class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>每日种子赠礼</span>
                  <small>{{ pet.seeds.canClaim ? '今日可领' : '今日已领' }}</small>
                </h3>
                <p class="pet-card__text">
                  每日赠送 1 份免费的稀有种子礼包，每日 0 点刷新；未领取的礼包可累计保留。
                </p>
                <div class="pet-rewards">
                  <div v-for="item in seedRewards" :key="item.id" class="pet-reward" :title="item.name">
                    <img :src="item.image" :alt="item.name">
                    <strong>× {{ item.count }}</strong>
                    <small>{{ item.name }}</small>
                  </div>
                </div>
                <button type="button" class="pet-button pet-button--primary pet-button--block" :disabled="busy || !pet.seeds.canClaim" @click="diary.operate('seeds')">
                  {{ pending === 'seeds' ? '领取中…' : pet.seeds.canClaim ? '领取种子礼包' : '今日礼包已领取' }}
                </button>
                <p v-if="pet.nurture.adult" class="pet-note">
                  {{ pet.nurture.dogGranted ? '比熊已永久加入你的农场' : '成年奖励：领取永久比熊' }}
                </p>
                <button v-if="pet.nurture.adult && !pet.nurture.dogGranted" type="button" class="pet-button pet-button--block" :disabled="busy" @click="diary.operate('claimDog')">
                  领取永久比熊
                </button>
              </article>

              <article class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>宝藏护送</span>
                  <small>护送中 {{ escortingCount }} · 待护送 {{ waitingCount }}</small>
                </h3>
                <p class="pet-card__text">
                  {{ pet.nurture.adult ? '查看宝藏价值、被挑战次数、护送日志和待领奖励。待护送宝藏会自动开始护送。' : '将比熊培育至成年后，可通过寻宝获取宝藏并自动护送。' }}
                </p>
                <p v-if="!pet.treasures.length" class="pet-empty pet-empty--inline">
                  暂无待护送宝藏
                </p>
                <button type="button" class="pet-button pet-button--block" :disabled="!pet.nurture.adult" @click="treasurePanel?.open()">
                  {{ claimableTreasures ? '查看并领取奖励' : '查看宝藏' }}
                </button>
              </article>

              <article class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>今日锦囊</span>
                </h3>
                <div v-for="charm in pet.charms.equipped" :key="charm.id" class="pet-charm">
                  <img :src="charm.image" :alt="charm.name">
                  <div>
                    <strong>{{ charm.name }} <small>已生效</small></strong>
                    <p>{{ charm.description }}</p>
                    <span v-if="charm.remaining.length">剩余生效次数：{{ charm.remaining.join(' / ') }}</span>
                  </div>
                </div>
                <p v-if="!pet.charms.equipped.length" class="pet-empty pet-empty--inline">
                  {{ pet.nurture.adult ? '进入宝藏护送挑选锦囊。' : '成年后可搭配锦囊参与宝藏护送。' }}
                </p>
                <small class="pet-note">{{ pet.charms.refreshNote }}</small>
                <button type="button" class="pet-button pet-button--block" :disabled="!pet.nurture.adult" @click="treasurePanel?.open('charms')">
                  查看锦囊总览
                </button>
              </article>

              <details open class="pet-card pet-card--wide">
                <summary class="pet-card__head">
                  <PetPaw />
                  <span>好友夺宝</span>
                  <small>今日 {{ pet.battleCount }}/{{ pet.battleLimit }}</small>
                  <span class="pet-card__toggle i-carbon-chevron-down" aria-hidden="true" />
                </summary>
                <p class="pet-card__text">
                  消耗一张挑战书参与夺宝，收益与可用挑战书以好友当前宝藏为准。
                </p>
                <div class="pet-steal">
                  <button type="button" class="pet-button pet-button--small" :disabled="!!pending || friends.loading" @click="loadFriends">
                    读取好友
                  </button>
                  <select v-model="friendId" aria-label="选择夺宝好友">
                    <option value="">
                      选择好友
                    </option>
                    <option v-for="f in friends.friends" :key="String(f.gid)" :value="String(f.gid)">
                      {{ f.name || f.gid }}
                    </option>
                  </select>
                  <button type="button" class="pet-button pet-button--small pet-button--primary" :disabled="!!pending || !friendId || !pet.hunt.canPlunder" @click="diary.readExtra('friend', friendId)">
                    查看宝藏
                  </button>
                </div>
                <p v-if="!pet.hunt.canPlunder" class="pet-note">
                  成年并满足活动条件后开放夺宝；每日最多 {{ pet.battleLimit }} 次。
                </p>
                <div v-if="friend" class="pet-steal__list">
                  <p v-if="!friend.treasures.length" class="pet-empty pet-empty--inline">
                    这位好友当前没有可查看的宝藏。
                  </p>
                  <article v-for="treasure in friend.treasures" :key="treasure.id" class="pet-steal__treasure">
                    <header>
                      <strong>{{ treasure.item.name }} ×{{ treasure.item.count }}</strong>
                      <span>{{ treasure.status === 2 ? remaining(treasure.endTime) : '当前不可夺宝' }}</span>
                    </header>
                    <div v-for="preview in treasure.previews" :key="preview.challengeId" class="pet-steal__preview">
                      <span>{{ pet.balances.find(i => i.id === preview.challengeId)?.name || '挑战书' }} ×1</span>
                      <span>最高收益 {{ preview.maxProfit.count }} · 最大损失 {{ preview.maxLoss.count }}</span>
                      <button type="button" class="pet-button pet-button--small" :disabled="busy || !preview.canStart || treasure.status !== 2 || !Number(pet.balances.find(i => i.id === preview.challengeId)?.count)" @click="diary.operate('battle', { gid: friend.gid, treasureId: treasure.id, challengeId: preview.challengeId })">
                        发起夺宝
                      </button>
                    </div>
                  </article>
                </div>
              </details>

              <details class="pet-card pet-card--wide">
                <summary class="pet-card__head">
                  <PetPaw />
                  <span>活动说明</span>
                  <span class="pet-card__toggle i-carbon-chevron-down" aria-hidden="true" />
                </summary>
                <p v-for="(rule, index) in pet.rules" :key="index" class="pet-card__text">
                  {{ rule }}
                </p>
              </details>
            </div>
          </main>

          <main v-else-if="pet && tab === 'stories'" class="pet-album" aria-label="爪印手记">
            <section class="pet-album__head">
              <div>
                <h2>爪印手记</h2>
                <p>多跟比熊互动可以解锁更多照片哦~</p>
              </div>
              <span class="pet-chip pet-chip--gold">已解锁 {{ unlocked }} / {{ pet.stories.length }}</span>
            </section>
            <div class="pet-album__bar" role="presentation">
              <i :style="{ width: `${albumPercent}%` }" />
            </div>
            <div class="pet-album__grid">
              <article v-for="story in pet.stories" :key="story.order" class="pet-photo" :class="{ 'pet-photo--locked': !story.unlocked }">
                <div class="pet-photo__frame">
                  <img v-if="story.unlocked && story.photo" :src="story.photo" :alt="`第 ${story.order} 则手记照片`" loading="lazy" decoding="async">
                  <span v-else class="pet-photo__empty">
                    <PetPaw />
                    <small>未解锁</small>
                  </span>
                </div>
                <div class="pet-photo__body">
                  <strong>第 {{ story.order }} 则</strong>
                </div>
                <button v-if="story.unlocked" type="button" class="pet-button pet-button--small pet-button--block" :disabled="busy || story.claimed" @click="diary.operate('story', { order: story.order })">
                  {{ story.claimed ? '已领取' : '领取奖励' }}
                </button>
              </article>
            </div>
          </main>

          <main v-else-if="pet && tab === 'shop'" class="pet-shop" aria-label="拾物小铺">
            <p class="pet-notice">
              <PetPaw />收集幸运星，可兑换游记限定奖励
            </p>
            <p v-if="!pet.shop.length" class="pet-empty">
              小铺目录暂未加载，请刷新重试。
            </p>
            <div class="pet-goods">
              <button v-for="goods in pet.shop" :key="goods.id" type="button" class="pet-goods__item" :class="{ 'pet-goods__item--sold': goods.remaining === '0' }" :aria-label="`查看${goods.name}兑换信息`" @click="openExchange(goods.id)">
                <span class="pet-goods__thumb">
                  <img :src="goods.image" :alt="goods.name" loading="lazy" decoding="async">
                </span>
                <strong>{{ goods.name }}</strong>
                <span class="pet-goods__price">
                  <span v-for="cost in goods.costs" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span>
                </span>
                <span v-if="goods.remaining === '0'" class="pet-goods__sold">已兑完</span>
              </button>
            </div>
          </main>

          <main v-else-if="pet" class="pet-solar" aria-label="节令小礼">
            <p v-if="!currentTerm" class="pet-empty">
              节令数据暂未加载，请刷新重试。
            </p>
            <template v-else>
              <div class="pet-terms" aria-label="选择节令">
                <button v-for="term in pet.solarTerms?.terms || []" :key="term.id" type="button" :class="{ 'is-active': currentTerm.id === term.id, 'is-locked': term.statusCode === '1' }" :aria-pressed="currentTerm.id === term.id" @click="selectedTermId = term.id">
                  {{ term.name }}<span v-if="term.statusCode === '1'" class="i-carbon-locked" aria-hidden="true" />
                </button>
              </div>
              <section class="pet-solar__card">
                <PetSolarScene :term="currentTerm.name" />
                <div class="pet-solar__info">
                  <h2>{{ currentTerm.name }} · 节令赠礼</h2>
                  <p class="pet-note">
                    {{ date(Number(currentTerm.startTime) * 1000) }} — {{ date(Number(currentTerm.endTime) * 1000) }}
                  </p>
                  <div class="pet-rewards">
                    <div v-for="item in currentTerm.rewards" :key="item.id" class="pet-reward" :title="item.name">
                      <img :src="item.image" :alt="item.name">
                      <strong>× {{ item.count }}</strong>
                      <small>{{ item.name }}</small>
                    </div>
                  </div>
                  <button type="button" class="pet-button pet-button--primary" :disabled="busy || !currentTerm.canClaim" @click="diary.operate('solar', { termId: currentTerm.id })">
                    {{ pending === 'solar' ? '领取中…' : currentTerm.canClaim ? '领取节令好礼' : currentTerm.statusCode === '3' ? '已领取' : '未到领取时间' }}
                  </button>
                </div>
              </section>
            </template>
          </main>
        </div>
      </div>

      <nav v-if="pet" class="pet-nav" aria-label="活动栏目">
        <div class="pet-nav__inner">
          <button v-for="entry in tabs" :key="entry.id" type="button" :class="{ 'is-active': tab === entry.id }" :aria-current="tab === entry.id ? 'page' : undefined" :aria-label="entry.label" @click="tab = entry.id">
            <PetPaw v-if="entry.id === 'home'" class="pet-nav__icon" />
            <span v-else class="pet-nav__icon" :class="entry.icon" aria-hidden="true" />
            <strong>{{ entry.label }}</strong>
            <i v-if="entry.id === 'stories' && pet.stories.some(story => story.unlocked && !story.claimed)" class="pet-nav__badge" aria-label="有可领取的手记奖励" />
          </button>
        </div>
      </nav>

      <dialog ref="exchangeDialog" class="pet-dialog" aria-labelledby="pet-exchange-title" @close="selectedGoodsId = ''" @click.self="exchangeDialog?.close()">
        <header class="pet-dialog__head">
          <h2 id="pet-exchange-title">
            兑换
          </h2>
          <button type="button" class="pet-dialog__close" aria-label="关闭兑换窗口" @click="exchangeDialog?.close()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div v-if="exchangeItem" class="pet-dialog__body">
          <div class="pet-dialog__product">
            <img :src="exchangeItem.image" :alt="exchangeItem.name">
            <div>
              <h3>{{ exchangeItem.name }}</h3>
              <p>{{ itemText(exchangeItem.rewards) }}</p>
            </div>
          </div>
          <label class="pet-field" for="pet-exchange-quantity">兑换数量</label>
          <div class="pet-quantity">
            <button type="button" :disabled="!!pending || exchangeQuantity <= 1" aria-label="减少兑换数量" @click="exchangeQuantity = Math.max(1, (Number(exchangeQuantity) || 1) - 1)">
              −
            </button>
            <input id="pet-exchange-quantity" v-model.number="exchangeQuantity" type="number" inputmode="numeric" min="1" :max="exchangeLimit" :disabled="!!pending">
            <button type="button" :disabled="!!pending || exchangeQuantity >= exchangeLimit" aria-label="增加兑换数量" @click="exchangeQuantity = Math.min(exchangeLimit, (Number(exchangeQuantity) || 0) + 1)">
              +
            </button>
            <button type="button" :disabled="!!pending || !affordableQuantity" @click="exchangeQuantity = affordableQuantity">
              最大
            </button>
          </div>
          <p class="pet-note">
            {{ exchangeItem.remaining === null ? '不限量' : `剩余可兑：${exchangeItem.remaining} / ${exchangeItem.limit}` }}
          </p>
          <div class="pet-costs" aria-live="polite">
            <span v-for="cost in exchangeCosts" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span>
          </div>
          <p v-if="exchangeHint" class="pet-note" role="status">
            {{ exchangeHint }}
          </p>
          <p v-if="error" class="pet-message pet-message--error" role="alert">
            {{ error }}
          </p>
          <button type="button" class="pet-button pet-button--primary pet-button--block" :disabled="!canExchange" @click="submitExchange">
            {{ pending === 'exchange' ? '兑换中…' : '兑换' }}
          </button>
        </div>
      </dialog>

      <dialog ref="recordDialog" class="pet-dialog" aria-labelledby="pet-record-title" @click.self="recordDialog?.close()">
        <header class="pet-dialog__head">
          <h2 id="pet-record-title">
            互动记录
          </h2>
          <button type="button" class="pet-dialog__close" aria-label="关闭互动记录" @click="recordDialog?.close()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div class="pet-dialog__body">
          <div class="pet-log__tabs" aria-label="记录类型">
            <button type="button" class="pet-button pet-button--small" :class="{ 'pet-button--primary': logKind === 'interact' }" :disabled="!!pending" @click="readLogs('interact')">
              互动记录
            </button>
            <button type="button" class="pet-button pet-button--small" :class="{ 'pet-button--primary': logKind === 'plunder' }" :disabled="!!pending" @click="readLogs('plunder')">
              被夺宝记录
            </button>
          </div>
          <p v-if="error" class="pet-message pet-message--error" role="alert">
            <span>{{ error }}</span>
            <button type="button" :disabled="!!pending" @click="readLogs(logKind)">
              重试
            </button>
          </p>
          <p v-if="pending === 'interact' || pending === 'plunder'" class="pet-empty pet-empty--inline" role="status">
            正在读取记录…
          </p>
          <p v-else-if="!error && !recordEntries?.length" class="pet-empty pet-empty--inline">
            暂无{{ logKind === 'interact' ? '互动' : '被夺宝' }}记录。
          </p>
          <div v-for="(entry, index) in recordEntries" :key="index" class="pet-log">
            <time>{{ time(entry.time) }}</time>
            <template v-if="logKind === 'interact'">
              <span>消耗：{{ itemText(entry.costs) || '无' }}</span>
              <strong>获得：{{ itemText(entry.rewards) || '无道具奖励' }}</strong>
            </template>
            <template v-else>
              <span>{{ entry.name }} · {{ entry.won ? '夺宝成功' : '夺宝失败' }}{{ entry.fake ? ' · 锦囊记录' : '' }}</span>
              <strong>损失 {{ itemText(entry.lost) || '无' }} · 注入 {{ itemText(entry.injected) || '无' }}</strong>
            </template>
          </div>
        </div>
      </dialog>

      <PetTreasurePanel v-if="pet" ref="treasurePanel" :now="now" />
    </div>
  </ActivityShell>
</template>

<style scoped src="./styles/pet-diary.css">
</style>
