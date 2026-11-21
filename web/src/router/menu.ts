export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  meta?: {
    fullBleed?: boolean
    /** 牧场页面分区（ranch 页面按此切换面板） */
    ranchSection?: 'overview' | 'personal' | 'illustrated' | 'mall' | 'friends' | 'activity'
  }
  /** 不在侧边栏展示（仍是合法路由，如牧场分区子页） */
  hidden?: boolean
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-dashboard',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-sprout',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    label: '图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'activity',
    name: 'activity-center',
    label: '活动',
    icon: 'i-carbon-gift',
    component: () => import('@/views/ActivityCenter.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'ranch',
    name: 'ranch',
    label: '牧场',
    icon: 'i-tabler-horse',
    component: () => import('@/views/Ranch.vue'),
    meta: { ranchSection: 'overview' },
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-chart-line',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'solar-calendar',
    name: 'solar-calendar',
    label: '节令日历',
    icon: 'i-carbon-calendar',
    component: () => import('@/views/SolarCalendar.vue'),
  },
  {
    path: 'game-mall',
    name: 'game-mall',
    label: '游戏商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/GameMall.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
]

/**
 * 牧场分区子页：牧场页面内部切换面板用，侧边栏只保留一个「牧场」入口。
 * 面板内容由 Ranch.vue 根据 meta.ranchSection 决定。
 */
export const ranchSectionRoutes: MenuItem[] = [
  { path: 'ranch/personal', name: 'ranch-personal', label: '牧场 · 牧家', icon: 'i-carbon-sprout', component: () => import('@/views/Ranch.vue'), meta: { ranchSection: 'personal' }, hidden: true },
  { path: 'ranch/illustrated', name: 'ranch-illustrated', label: '牧场 · 图鉴', icon: 'i-carbon-book', component: () => import('@/views/Ranch.vue'), meta: { ranchSection: 'illustrated' }, hidden: true },
  { path: 'ranch/game-mall', name: 'ranch-game-mall', label: '牧场 · 商城', icon: 'i-carbon-shopping-cart', component: () => import('@/views/Ranch.vue'), meta: { ranchSection: 'mall' }, hidden: true },
  { path: 'ranch/friends', name: 'ranch-friends', label: '牧场 · 好友', icon: 'i-carbon-user-multiple', component: () => import('@/views/Ranch.vue'), meta: { ranchSection: 'friends' }, hidden: true },
  { path: 'ranch/activity', name: 'ranch-activity', label: '牧场 · 活动', icon: 'i-carbon-gift', component: () => import('@/views/Ranch.vue'), meta: { ranchSection: 'activity' }, hidden: true },
]

export const allMenuRoutes: MenuItem[] = [...menuRoutes, ...ranchSectionRoutes]

/** 侧边栏只展示非隐藏项 */
export const visibleMenuRoutes: MenuItem[] = allMenuRoutes.filter(item => !item.hidden)
