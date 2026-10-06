<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>入廊管线欠费复核清单</h2>
        <p class="page-desc">
          费用结算那边挂了欠费的权属单位，其在廊管线自动进本清单，供管线责任人复核。
          本入口归「{{ TEAM_PIPELINE }}」，其他班组只读；费用班组不能在此提交。
        </p>
      </div>
    </header>

    <p v-if="!canWrite" class="readonly-banner">
      当前班组「{{ store.team }}」非本清单责任班组，只读；越权提交会按归属拒绝。
    </p>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待复核管线</span>
        <strong class="stat-value danger-text">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已复核</span>
        <strong class="stat-value ok-text">{{ passedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">牵动欠费单位</span>
        <strong class="stat-value">{{ ownerSet.size }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>管线编号</th><th>权属单位</th><th>舱室</th><th>类型</th><th>责任人</th>
          <th>来源结算单</th><th>欠费金额(元)</th><th>复核状态</th><th>原因</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in reviews" :key="r.id" :class="{ row_wait: r.status === '待复核' }">
          <td>{{ r.pipelineNo }}</td>
          <td>{{ r.owner }}</td>
          <td>{{ r.cabin }}</td>
          <td>{{ r.pipelineType }}</td>
          <td>{{ r.responsible }}</td>
          <td>{{ r.sourceStatementNo }}</td>
          <td class="num danger-text">{{ fmt(r.arrearsAmount) }}</td>
          <td><span :class="['tag', r.status === '待复核' ? 'st-bad' : 'st-ok']">{{ r.status }}</span></td>
          <td class="note">{{ r.reason }}</td>
          <td>
            <button
              v-if="r.status === '待复核'"
              class="link"
              type="button"
              :disabled="!canWrite"
              @click="confirmReview(r.id)"
            >
              复核通过
            </button>
          </td>
        </tr>
        <tr v-if="!reviews.length">
          <td colspan="10" class="empty-state">暂无欠费牵动的管线复核项；费用结算挂欠费后会自动出现。</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>清单数据与费用结算欠费记录同源；数字与详情取值一致。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { listPipelineReviews, savePipelineReview } from '@/data/fee-store'
import { TEAM_PIPELINE, useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite('pipeline'))

const reviews = ref(listPipelineReviews())
const message = ref('')
const messageOk = ref(true)

const pendingCount = computed(() => reviews.value.filter((r) => r.status === '待复核').length)
const passedCount = computed(() => reviews.value.filter((r) => r.status === '复核通过').length)
const ownerSet = computed(() => new Set(reviews.value.filter((r) => r.status === '待复核').map((r) => r.owner)))

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function confirmReview(id: number) {
  // 归属兜底：非责任班组即便绕过 disabled 触发，也在数据写入处拒绝。
  if (!canWrite.value) {
    message.value = `提交被驳回：本清单归 ${TEAM_PIPELINE}，当前班组 ${store.team} 只读`
    messageOk.value = false
    return
  }
  const row = reviews.value.find((r) => r.id === id)
  if (!row) return
  row.status = '复核通过'
  savePipelineReview(row)
  reviews.value = listPipelineReviews()
  message.value = `${row.pipelineNo} 已复核通过（责任人 ${store.operator}）`
  messageOk.value = true
}
</script>

<style scoped>
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.note {
  font-size: 12px;
  color: var(--muted);
  max-width: 260px;
}
.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.st-ok {
  background: #e7f6ec;
  color: #1a7f37;
}
.st-bad {
  background: #fdecec;
  color: #b42318;
}
.row_wait {
  background: #fffafa;
}
.danger-text {
  color: #b42318;
}
.ok-text {
  color: #1a7f37;
}
.readonly-banner {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.link:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.error-text {
  color: #b42318;
}
</style>
