<script setup lang="ts">
/**
 * 农场土地页与牧场动物页共享的外层卡片壳。
 *
 * 只统一卡片材质与插槽位置，不碰任何业务状态：
 *   - head    吸顶标题/操作区（农场批量入口、牧场一键操作）
 *   - summary 状态统计区（农场只读统计、牧场可点击筛选）
 *   - default 内容区（各自的网格与空态）
 */
</script>

<template>
  <div class="personal-panel__card cartoon-card farm-card rounded-2xl bg-white shadow-lg dark:bg-gray-800 !p-0">
    <slot name="head" />
    <slot name="summary" />
    <slot />
  </div>
</template>
