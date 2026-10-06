<template>
  <section class="page" data-module="fee">
    <header class="page-head">
      <div>
        <h2>入廊费与服务费结算</h2>
        <p class="page-desc">
          按入廊服务合同与计费周期出账；费用明细导出交权属单位，回传对账文件导入后按「合同编号 +
          计费周期」逐行核对。同周期重复出账只认最后一版；对不上账挂欠费并联动管线复核。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!canWrite" @click="showGenerate = true">
          按合同出账
        </button>
      </div>
    </header>

    <p v-if="!canWrite" class="readonly-banner">
      当前班组「{{ store.team }}」不是本入口责任班组，页面只读；提交类操作已按归属禁用。
    </p>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value" :class="card.cls">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 出账 -->
    <div v-if="showGenerate" class="panel">
      <h3>按合同与计费周期出账</h3>
      <form class="filter-bar" @submit.prevent="doGenerate">
        <label class="filter-item">
          <span>入廊服务合同</span>
          <select v-model="genForm.contractId" required>
            <option value="" disabled>选择合同</option>
            <option v-for="c in contracts" :key="c.id" :value="c.id">
              {{ c.contractNo }} · {{ c.owner }}（{{ c.kind }}）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>计费周期</span>
          <input v-model="genForm.period" placeholder="如 2026Q4" required />
        </label>
        <label class="filter-item">
          <span>周期起</span>
          <input v-model="genForm.periodStart" type="date" required />
        </label>
        <label class="filter-item">
          <span>周期止</span>
          <input v-model="genForm.periodEnd" type="date" required />
        </label>
        <label class="filter-item checkbox">
          <input v-model="genForm.includeEntryFee" type="checkbox" />
          <span>本周期计列入廊费</span>
        </label>
        <button class="btn primary" type="submit">生成结算单</button>
        <button class="btn ghost" type="button" @click="showGenerate = false">取消</button>
      </form>
      <p class="hint">同一合同同一周期再次出账，旧版自动作废、只认最后一版，金额不叠加。</p>
    </div>

    <!-- 结算单列表 -->
    <h3>结算单（仅显示各周期最新生效版本）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>结算单编号</th>
          <th>合同编号</th>
          <th>权属单位</th>
          <th>计费周期</th>
          <th>版本</th>
          <th>应收合计(元)</th>
          <th>对方认可(元)</th>
          <th>状态</th>
          <th>欠费</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in active" :key="s.id" :class="{ row_diff: s.status === '有差异' }">
          <td><button class="link" type="button" @click="openDetail(s)">{{ s.statementNo }}</button></td>
          <td>{{ s.contractNo }}</td>
          <td>{{ s.owner }}</td>
          <td>{{ s.period }}</td>
          <td>v{{ s.version }}</td>
          <td class="num">{{ fmt(s.totalAmount) }}</td>
          <td class="num">{{ s.confirmedAmount === null ? '—' : fmt(s.confirmedAmount) }}</td>
          <td><span :class="['tag', statusCls(s.status)]">{{ s.status }}</span></td>
          <td>{{ s.arrearsFlagged ? '已挂' : '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(s)">明细</button>
            <button class="link" type="button" @click="exportDetail(s)">导出明细</button>
            <button
              v-if="s.status === '有差异' && !s.arrearsFlagged"
              class="link danger"
              type="button"
              :disabled="!canWrite"
              @click="doFlag(s)"
            >
              挂欠费
            </button>
          </td>
        </tr>
        <tr v-if="!active.length">
          <td colspan="10" class="empty-state">暂无生效结算单，先按合同出账</td>
        </tr>
      </tbody>
    </table>

    <p class="hint">
      作废版本（{{ supersededCount }} 张）不入账、不参与统计与对账：
      <button class="link" type="button" @click="showOld = !showOld">
        {{ showOld ? '隐藏' : '查看' }}作废版本
      </button>
    </p>
    <table v-if="showOld" class="data-table old-table">
      <thead>
        <tr><th>结算单编号</th><th>合同编号</th><th>周期</th><th>版本</th><th>金额(元)</th><th>作废说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in oldOnes" :key="s.id">
          <td>{{ s.statementNo }}</td>
          <td>{{ s.contractNo }}</td>
          <td>{{ s.period }}</td>
          <td>v{{ s.version }}</td>
          <td class="num">{{ fmt(s.totalAmount) }}</td>
          <td>{{ s.reconcileNote }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 导入对账 -->
    <h3 class="section-gap">对方回传对账文件导入</h3>
    <div class="panel">
      <input ref="fileInput" type="file" accept=".csv,text/csv" @change="onFile" :disabled="!canWrite" />
      <button class="btn primary" type="button" :disabled="!canWrite || !pendingText" @click="doImport">
        导入并逐行核对
      </button>
      <span class="hint">CSV 列：合同编号、计费周期、对方认可金额（也支持权属单位/备注等列）</span>
    </div>

    <!-- 核对结果 -->
    <template v-if="reconcile">
      <h3 class="section-gap">逐行核对结果</h3>
      <p class="hint">
        入账 {{ reconcile.bookedCount }} 行，其中金额有差异 {{ reconcile.diffCount }} 行，匹配不上
        {{ reconcile.unmatchedCount }} 行（单独列原因，未入账）。
        <button class="btn" type="button" @click="downloadReconcile">另存核对结果</button>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>文件行号</th><th>合同编号</th><th>计费周期</th><th>结算单编号</th>
            <th>应收(元)</th><th>认可(元)</th><th>结果</th><th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in reconcile.lines" :key="line.rowNo" :class="{ row_unmatched: line.match === '匹配不上', row_diff: line.match === '金额有差异' }">
            <td>{{ line.rowNo }}</td>
            <td>{{ line.contractNo || '—' }}</td>
            <td>{{ line.period || '—' }}</td>
            <td>{{ line.statementNo || '—' }}</td>
            <td class="num">{{ line.billedAmount === null ? '—' : fmt(line.billedAmount) }}</td>
            <td class="num">{{ line.confirmedAmount === null ? '—' : fmt(line.confirmedAmount) }}</td>
            <td><span :class="['tag', matchCls(line.match)]">{{ line.match }}</span></td>
            <td>{{ line.reason }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 欠费清单 -->
    <h3 class="section-gap">欠费清单（牵动入廊管线复核）</h3>
    <table class="data-table">
      <thead>
        <tr><th>结算单</th><th>合同编号</th><th>权属单位</th><th>周期</th><th>欠费金额(元)</th><th>联动管线</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="a in arrears" :key="a.id">
          <td>{{ a.statementNo }}</td>
          <td>{{ a.contractNo }}</td>
          <td>{{ a.owner }}</td>
          <td>{{ a.period }}</td>
          <td class="num strong danger-text">{{ fmt(a.amount) }}</td>
          <td>{{ a.pipelineRefs.join('、') || '—' }}</td>
          <td><span :class="['tag', a.status === '欠费中' ? 'st-bad' : 'st-ok']">{{ a.status }}</span></td>
          <td>
            <button v-if="a.status === '欠费中'" class="link" type="button" :disabled="!canWrite" @click="doClear(a.id)">
              补缴核销
            </button>
          </td>
        </tr>
        <tr v-if="!arrears.length"><td colspan="8" class="empty-state">暂无欠费</td></tr>
      </tbody>
    </table>

    <!-- 明细弹层 -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal">
        <h3>{{ detail.statementNo }} 费用明细</h3>
        <p class="hint">
          {{ detail.owner }} · {{ detail.contractNo }} · {{ detail.period }}（{{ detail.periodStart }} 至
          {{ detail.periodEnd }}）· 版本 v{{ detail.version }} · 制单 {{ detail.generatedBy }}
          {{ detail.generatedAt }}
        </p>
        <table class="data-table">
          <thead>
            <tr><th>类别</th><th>费用名称</th><th>计费量</th><th>单价</th><th>金额(元)</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in detail.items" :key="item.id">
              <td>{{ item.kind }}</td><td>{{ item.name }}</td><td class="num">{{ item.quantity }}</td>
              <td class="num">{{ fmt(item.unitPrice) }}</td><td class="num strong">{{ fmt(item.amount) }}</td><td>{{ item.remark }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colspan="4" class="num">合计</td><td class="num strong">{{ fmt(detail.totalAmount) }}</td><td></td></tr>
          </tfoot>
        </table>
        <p v-if="detail.reconcileNote" class="hint">对账说明：{{ detail.reconcileNote }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="exportDetail(detail)">导出明细文件</button>
          <button class="btn primary" type="button" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>列表金额、统计卡片与明细弹层取自同一份结算单数据；数据保存在本机浏览器。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { parseCsv } from '@/api/csv'
import {
  billingStats,
  clearArrears,
  exportStatementCsv,
  flagArrears,
  generateStatement,
  importReconcileFile,
  reconcileResultCsv,
} from '@/api/fee-service'
import { downloadBlob } from '@/api/zip'
import { listArrears, listContracts, listStatements } from '@/data/fee-store'
import type { ArrearsRecord, BillingStatement } from '@/data/fee-types'
import type { ReconcileResult } from '@/api/fee-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite('fee'))

const contracts = ref(listContracts())
const statements = ref(listStatements())
const arrears = ref<ArrearsRecord[]>(listArrears())
const detail = ref<BillingStatement | null>(null)
const showGenerate = ref(false)
const showOld = ref(false)
const message = ref('')
const messageOk = ref(true)
const reconcile = ref<ReconcileResult | null>(null)

const genForm = ref({
  contractId: '',
  period: '2026Q4',
  periodStart: '2026-10-01',
  periodEnd: '2026-12-31',
  includeEntryFee: true,
})

const active = computed(() =>
  [...statements.value]
    .filter((s) => !s.superseded)
    .sort((a, b) => b.id - a.id),
)
const oldOnes = computed(() => statements.value.filter((s) => s.superseded))
const supersededCount = computed(() => oldOnes.value.length)

const cards = computed(() => {
  const s = billingStats()
  return [
    { label: '生效结算单', value: s.total, cls: '' },
    { label: '待对账', value: s.pending, cls: '' },
    { label: '有差异', value: s.diff, cls: 'danger-text' },
    { label: '已结清/通过', value: s.settled, cls: 'ok-text' },
    { label: '欠费笔数', value: s.arrearsCount, cls: 'danger-text' },
    { label: '欠费合计(元)', value: fmt(s.arrearsAmount), cls: 'danger-text' },
  ]
})

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function statusCls(status: string): string {
  if (status === '有差异') return 'st-bad'
  if (status === '已结清' || status === '对账通过') return 'st-ok'
  return 'st-wait'
}
function matchCls(match: string): string {
  if (match === '匹配一致') return 'st-ok'
  if (match === '金额有差异') return 'st-bad'
  return 'st-wait'
}

function refresh() {
  statements.value = listStatements()
  arrears.value = listArrears()
  contracts.value = listContracts()
}
function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function doGenerate() {
  try {
    const s = generateStatement({
      contractId: Number(genForm.value.contractId),
      period: genForm.value.period.trim(),
      periodStart: genForm.value.periodStart,
      periodEnd: genForm.value.periodEnd,
      includeEntryFee: genForm.value.includeEntryFee,
      operator: store.operator,
    })
    refresh()
    showGenerate.value = false
    notify(`已生成 ${s.statementNo}（v${s.version}），同周期旧版已作废`, true)
  } catch (error) {
    notify(error instanceof Error ? error.message : '出账失败', false)
  }
}

function openDetail(s: BillingStatement) {
  detail.value = s
}
function exportDetail(s: BillingStatement) {
  const { filename, content } = exportStatementCsv(s)
  downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), filename)
}

const fileInput = ref<HTMLInputElement | null>(null)
const pendingText = ref('')
const pendingName = ref('')
function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  pendingName.value = file.name
  file.text().then((text) => {
    pendingText.value = text
    notify(`已读取 ${file.name}，可导入核对`, true)
  })
}

function doImport() {
  try {
    // 先确认能解析，避免把坏文件送进业务逻辑。
    parseCsv(pendingText.value)
    reconcile.value = importReconcileFile(pendingText.value)
    refresh()
    const r = reconcile.value
    notify(
      `导入完成：入账 ${r.bookedCount} 行，差异 ${r.diffCount} 行，匹配不上 ${r.unmatchedCount} 行`,
      r.unmatchedCount === 0,
    )
  } catch (error) {
    notify(error instanceof Error ? error.message : '对账文件解析失败', false)
  } finally {
    pendingText.value = ''
    if (fileInput.value) fileInput.value.value = ''
  }
}

function downloadReconcile() {
  if (!reconcile.value) return
  const blob = new Blob([reconcileResultCsv(reconcile.value)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `对账核对结果-${Date.now()}.csv`)
}

function doFlag(s: BillingStatement) {
  try {
    const a = flagArrears(s.id, store.operator)
    refresh()
    detail.value = null
    notify(`已对 ${a.owner} 挂欠费 ${fmt(a.amount)} 元，并联动管线复核清单与保养台账`, true)
  } catch (error) {
    notify(error instanceof Error ? error.message : '挂欠费失败', false)
  }
}

function doClear(id: number) {
  try {
    clearArrears(id)
    refresh()
    notify('欠费已核销，结算单结清，管线复核解除待复核', true)
  } catch (error) {
    notify(error instanceof Error ? error.message : '核销失败', false)
  }
}
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0;
}
.section-gap {
  margin-top: 18px;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.strong {
  font-weight: 600;
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
.st-wait {
  background: #eef2f7;
  color: #475569;
}
.row_diff {
  background: #fff8f8;
}
.row_unmatched {
  background: #f7f7f8;
}
.old-table {
  opacity: 0.75;
}
.readonly-banner {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.danger-text {
  color: #b42318;
}
.ok-text {
  color: #1a7f37;
}
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
  width: min(860px, 92vw);
  max-height: 86vh;
  overflow: auto;
}
.modal h3 {
  margin: 0 0 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.filter-item.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-item.checkbox span {
  margin: 0;
}
</style>
