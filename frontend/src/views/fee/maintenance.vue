<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>保养台账（与结算结论对齐）</h2>
        <p class="page-desc">
          结算挂欠费联动生成的保养/复核项在此登记。既有台账照原编号搬迁；早年没登记的项另起一行并注明。
          台账值与现场实测不一致时，一律以现场实测为准，其余照它回算。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportCsv">导出保养台账</button>
      </div>
    </header>

    <p v-if="!canWrite" class="readonly-banner">
      当前班组「{{ store.team }}」非保养台账责任班组，只读；回填提交将按归属拒绝。
    </p>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">登记条目</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待保养/复核</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">早年缺项补录</span>
        <strong class="stat-value">{{ backfilledCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">两路取值不一致已按实测统一</span>
        <strong class="stat-value">{{ conflictCount }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>原/新编号</th><th>管线编号</th><th>权属单位</th><th>保养对象</th>
          <th>台账值</th><th>现场实测</th><th>最终采用</th><th>单位</th>
          <th>来源结算单</th><th>登记性质</th><th>状态</th><th>取值依据/理由</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" :class="{ row_new: r.isBackfilled }">
          <td>{{ r.refNo }}</td>
          <td>{{ r.pipelineNo }}</td>
          <td>{{ r.owner }}</td>
          <td>{{ r.subject }}</td>
          <td class="num">{{ r.ledgerValue ?? '—' }}</td>
          <td class="num">{{ r.measuredValue ?? '—' }}</td>
          <td class="num strong">{{ r.adoptedValue ?? '—' }}</td>
          <td>{{ r.unit }}</td>
          <td>{{ r.sourceStatementNo || '—' }}</td>
          <td>
            <span :class="['tag', r.isBackfilled ? 'st-warn' : 'st-ok']">
              {{ r.isBackfilled ? '另起补录' : '原编号搬迁' }}
            </span>
          </td>
          <td><span :class="['tag', r.status === '已保养' ? 'st-ok' : 'st-wait']">{{ r.status }}</span></td>
          <td class="note">{{ r.adoptReason }}</td>
          <td>
            <button class="link" type="button" :disabled="!canWrite" @click="openMeasure(r.refNo)">现场实测回填</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="measureRef" class="modal-mask" @click.self="measureRef = ''">
      <div class="modal">
        <h3>现场实测回填（{{ measureRef }}）</h3>
        <form class="form-grid" @submit.prevent="doMeasure">
          <label class="span2">
            <span>现场实测取值</span>
            <input v-model.number="measureValue" type="number" step="0.01" required />
          </label>
          <p class="hint span2">
            提交后系统自动比较台账值与实测值：不一致时采用现场实测并回算，理由会写入该行「取值依据」。
          </p>
          <div class="modal-actions span2">
            <button class="btn" type="button" @click="measureRef = ''">取消</button>
            <button class="btn primary" type="submit">按实测统一</button>
          </div>
        </form>
      </div>
    </div>

    <section class="decision section-gap">
      <h3>两版取值的取舍规则（已定稿）</h3>
      <ol>
        <li>台账值与现场实测一致：维持原值，记录核对人与时间。</li>
        <li>两路取值不同：<strong>保留现场实测版</strong>，台账值仅留痕，最终采用值与下游统计一律照实测回算。理由：现场实测反映管线当前真实状态，纸质/历史台账存在滞后与誊抄误差。</li>
        <li>台账原本无值（早年口头约定段）：另起一行补录，编号以 <code>BY-LX-</code> 开头并标注「另起补录」，采用实测值，不伪造历史登记。</li>
      </ol>
    </section>

    <footer class="page-foot">
      <span>列表「最终采用」列与详情弹层、统计卡片取同一份字段，确保对得上。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { toCsv } from '@/api/csv'
import { adoptMeasuredValue } from '@/api/fee-service'
import { downloadBlob } from '@/api/zip'
import { listMaintenance } from '@/data/fee-store'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite('maintenance'))

const rows = ref(listMaintenance())
const measureRef = ref('')
const measureValue = ref<number | null>(null)
const message = ref('')
const messageOk = ref(true)

const pendingCount = computed(() => rows.value.filter((r) => r.status === '待保养').length)
const backfilledCount = computed(() => rows.value.filter((r) => r.isBackfilled).length)
const conflictCount = computed(
  () =>
    rows.value.filter(
      (r) =>
        r.ledgerValue !== null &&
        r.measuredValue !== null &&
        Math.abs(Number(r.ledgerValue) - Number(r.measuredValue)) > 1e-9,
    ).length,
)

function openMeasure(refNo: string) {
  if (!canWrite.value) {
    message.value = `提交被驳回：保养台账归 ${store.team === '管线运维一班' ? store.team : '管线运维一班'}，当前班组只读`
    messageOk.value = false
    return
  }
  measureRef.value = refNo
  const row = rows.value.find((r) => r.refNo === refNo)
  measureValue.value = row?.measuredValue ?? null
  message.value = ''
}

function doMeasure() {
  if (measureValue.value === null) return
  try {
    const updated = adoptMeasuredValue({
      refNo: measureRef.value,
      measuredValue: Number(measureValue.value),
      operator: store.operator,
    })
    rows.value = listMaintenance()
    measureRef.value = ''
    message.value = `${updated.refNo} 已按现场实测 ${updated.adoptedValue} ${updated.unit} 统一取值`
    messageOk.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : '回填失败'
    messageOk.value = false
  }
}

function exportCsv() {
  const header = ['编号', '管线编号', '权属单位', '保养对象', '台账值', '现场实测', '最终采用', '单位', '来源结算单', '登记性质', '状态', '取值依据']
  const data = rows.value.map((r) => ({
    编号: r.refNo,
    管线编号: r.pipelineNo,
    权属单位: r.owner,
    保养对象: r.subject,
    台账值: r.ledgerValue ?? '',
    现场实测: r.measuredValue ?? '',
    最终采用: r.adoptedValue ?? '',
    单位: r.unit,
    来源结算单: r.sourceStatementNo,
    登记性质: r.isBackfilled ? '另起补录' : '原编号搬迁',
    状态: r.status,
    取值依据: r.adoptReason,
  }))
  downloadBlob(new Blob([toCsv(header, data)], { type: 'text/csv;charset=utf-8' }), '保养台账.csv')
}
</script>

<style scoped>
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.strong {
  font-weight: 600;
}
.note {
  font-size: 12px;
  color: var(--muted);
  max-width: 300px;
}
.row_new {
  background: #fffdf5;
}
.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
}
.st-ok {
  background: #e7f6ec;
  color: #1a7f37;
}
.st-warn {
  background: #fff4e0;
  color: #b54708;
}
.st-wait {
  background: #eef2f7;
  color: #475569;
}
.section-gap {
  margin-top: 18px;
}
.decision {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
}
.decision h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
.decision ol {
  margin: 0;
  padding-left: 18px;
}
.decision li {
  margin: 4px 0;
}
.readonly-banner {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.link:disabled,
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: min(480px, 92vw);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
.form-grid label span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.form-grid input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.span2 {
  grid-column: span 1;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
}
.ok-text {
  color: #1a7f37;
}
.error-text {
  color: #b42318;
}
</style>
