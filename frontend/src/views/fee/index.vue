<template>
  <section class="page" data-module="fee">
    <header class="page-head">
      <div>
        <h2>入廊费与服务费结算</h2>
        <p class="page-desc">
          按入廊服务合同和计费周期整批出账，费用明细导出交权属单位，回传对账文件按「合同编号+计费周期」逐行核对；
          重复出账只认最后一版，差额挂欠费并牵动欠费管线复核清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="downloadTemplate">下载对账回函模板</button>
        <button class="btn" type="button" @click="resetAll" :disabled="!canWrite">恢复演示数据</button>
      </div>
    </header>

    <div class="perm-banner" :class="canWrite ? 'ok' : 'lock'">
      当前身份：<strong>{{ store.crewName }}</strong>
      <template v-if="canWrite">— 本入口可写：出账 / 导入对账 / 导出打包</template>
      <template v-else>— 不是收费结算班组，本入口只读，写操作按归属驳回</template>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">{{ period }} 有效结算单</span>
        <strong class="stat-value">{{ stats.结算单数 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">应收合计（元）</span>
        <strong class="stat-value">{{ money(stats.应收合计) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已收合计（元）</span>
        <strong class="stat-value">{{ money(stats.已收合计) }}</strong>
      </article>
      <article class="stat-card" :class="{ alert: stats.欠费合计 > 0 }">
        <span class="stat-label">欠费合计（元）</span>
        <strong class="stat-value">{{ money(stats.欠费合计) }}（{{ stats.欠费单数 }}单）</strong>
      </article>
    </div>

    <div class="workbench">
      <section class="panel">
        <h3>① 整批出账</h3>
        <form class="inline-form" @submit.prevent="doGenerate">
          <label class="filter-item">
            <span>计费周期</span>
            <input v-model="period" placeholder="如 2026-Q3" style="width:120px" />
          </label>
          <button class="btn primary" type="submit" :disabled="!canWrite">按合同整批出账</button>
          <span class="hint">同周期重复出账：旧版自动作废，只认最后一版，金额不叠加</span>
        </form>
      </section>

      <section class="panel">
        <h3>② 导出 / 导入对账文件</h3>
        <div class="inline-form">
          <button class="btn" type="button" @click="doExport" :disabled="!canWrite">导出本周期结算单明细（交权属单位）</button>
          <label class="btn file-btn" :class="{ disabled: !canWrite }">
            导入对方回传对账文件
            <input ref="reconFile" type="file" accept=".csv,text/csv" :disabled="!canWrite" @change="onReconFile" />
          </label>
          <button class="btn primary" type="button" @click="doPackage" :disabled="!canWrite">整批打包另存（ZIP）</button>
        </div>
        <p class="hint">外部文件先导进来处理，结果再与结算明细、复核清单、保养台账一起打包成一份另存。</p>
      </section>
    </div>

    <p v-if="message" class="result-banner" :class="lastOk ? 'ok' : 'err'">{{ message }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>③ 结算单（费用明细）</h3>
        <div class="legend">
          <span class="tag 待对账">待对账</span>
          <span class="tag 已结清">已结清</span>
          <span class="tag 欠费">欠费</span>
          <span class="tag 已作废">已作废（被新版替代）</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>结算单号</th><th>合同编号</th><th>权属单位</th><th>计费周期</th><th>版次</th>
            <th>费用明细</th><th class="num">应收</th><th class="num">对方确认</th><th class="num">已收</th>
            <th class="num">差额</th><th>状态</th><th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bills" :key="b.id" :class="{ voided: b.状态 === '已作废', arrears: b.状态 === '欠费' }">
            <td>{{ b.结算单号 }}</td>
            <td>{{ b.合同编号 }}</td>
            <td>{{ b.权属单位 }}</td>
            <td>{{ b.计费周期 }}</td>
            <td>v{{ b.版次 }}</td>
            <td>
              <span v-for="(line, i) in b.明细" :key="i" class="fee-chip">
                {{ line.费目 }} {{ money(line.金额) }}
              </span>
            </td>
            <td class="num">{{ money(receivable(b)) }}</td>
            <td class="num">{{ money(b.对方确认金额) }}</td>
            <td class="num">{{ money(b.已收金额) }}</td>
            <td class="num" :class="{ diff: diff(b) !== 0 && b.状态 !== '已作废' }">{{ money(diff(b)) }}</td>
            <td><span class="tag" :class="b.状态">{{ b.状态 }}</span></td>
            <td><button class="link" type="button" @click="openBill(b)">查看</button></td>
          </tr>
        </tbody>
      </table>
      <p class="hint">应收 = 明细金额合计，与详情页同源；作废单应收为 0，不叠加。</p>
    </section>

    <section class="panel">
      <h3>④ 对账文件逐行核对（匹配不上的行单列原因，其余照常入账）</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>对账批次</span>
          <select v-model.number="batchFilter">
            <option :value="0">全部批次</option>
            <option v-for="batch in batches" :key="batch.id" :value="batch.id">#{{ batch.id }} {{ batch.文件名 }}</option>
          </select>
        </label>
        <label class="checkline">
          <input v-model="onlyUnmatched" type="checkbox" /> 只看未匹配行
        </label>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次</th><th>行号</th><th>合同编号</th><th>计费周期</th><th>费目</th>
            <th class="num">账列金额</th><th class="num">回函确认</th><th class="num">回函已缴</th>
            <th>核对</th><th>原因 / 结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shownReconRows" :key="r.id" :class="{ unmatched: !r.是否匹配 }">
            <td>#{{ r.批次 }}</td>
            <td>{{ r.文件行号 }}</td>
            <td>{{ r.合同编号 }}</td>
            <td>{{ r.计费周期 }}</td>
            <td>{{ r.费目 }}</td>
            <td class="num">{{ money(r.账列金额) }}</td>
            <td class="num">{{ money(r.回函确认金额) }}</td>
            <td class="num">{{ money(r.回函已缴金额) }}</td>
            <td><span class="tag" :class="r.是否匹配 ? '已结清' : '欠费'">{{ r.是否匹配 ? '匹配入账' : '未匹配' }}</span></td>
            <td class="reason-cell">
              <template v-if="!r.是否匹配"><strong>{{ r.原因 }}</strong><br /></template>
              {{ r.核对结论 }}
            </td>
          </tr>
          <tr v-if="shownReconRows.length === 0">
            <td colspan="10" class="empty-state">暂无对账记录，可先导入对方回传的对账 CSV</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>⑤ 存量入廊服务合同（按签订日期回填；口头入廊补录为事实合同）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>合同编号</th><th>权属单位</th><th>管线类型</th><th>在廊管线</th><th>所属舱室</th>
            <th>签订/占用日期</th><th class="num">入廊费</th><th class="num">季度服务费</th>
            <th>性质</th><th>状态</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ct in contractList" :key="ct.合同编号" :class="{ fact: ct.合同性质 === '口头补录' }">
            <td>{{ ct.合同编号 }}</td>
            <td>{{ ct.权属单位 }}</td>
            <td>{{ ct.管线类型 }}</td>
            <td>{{ ct.管线编号列表.join('、') }}</td>
            <td>{{ ct.所属舱室 }}</td>
            <td>{{ ct.签订日期 }}</td>
            <td class="num">{{ money(ct.入廊费) }}</td>
            <td class="num">{{ money(ct.单周期服务费) }}</td>
            <td>{{ ct.合同性质 }}</td>
            <td><span class="tag" :class="ct.合同状态 === '正式' ? '已结清' : '欠费'">{{ ct.合同状态 }}</span></td>
            <td class="reason-cell">{{ ct.备注 }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 结算单详情抽屉：数字与列表同源 -->
    <div v-if="currentBill" class="modal-mask" @click.self="currentBill = null">
      <div class="modal">
        <header class="modal-head">
          <h3>结算单详情 {{ currentBill.结算单号 }}</h3>
          <button class="link" type="button" @click="currentBill = null">关闭</button>
        </header>
        <dl class="detail-grid">
          <div><dt>合同编号</dt><dd>{{ currentBill.合同编号 }}</dd></div>
          <div><dt>权属单位</dt><dd>{{ currentBill.权属单位 }}</dd></div>
          <div><dt>计费周期</dt><dd>{{ currentBill.计费周期 }}</dd></div>
          <div><dt>版次</dt><dd>v{{ currentBill.版次 }}（{{ currentBill.状态 === '已作废' ? '已作废，不叠加' : '有效版' }}）</dd></div>
          <div><dt>生成时间</dt><dd>{{ currentBill.生成时间 }}</dd></div>
          <div><dt>对账时间</dt><dd>{{ currentBill.对账时间 ?? '—' }}</dd></div>
        </dl>
        <table class="data-table">
          <thead><tr><th>费目</th><th>说明</th><th class="num">金额</th></tr></thead>
          <tbody>
            <tr v-for="(line, i) in currentBill.明细" :key="i">
              <td>{{ line.费目 }}</td><td>{{ line.说明 }}</td><td class="num">{{ money(line.金额) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colspan="2">应收合计</td><td class="num"><strong>{{ money(receivable(currentBill)) }}</strong></td></tr>
            <tr><td colspan="2">对方确认 / 已收 / 差额</td><td class="num">{{ money(currentBill.对方确认金额) }} / {{ money(currentBill.已收金额) }} / {{ money(diff(currentBill)) }}</td></tr>
          </tfoot>
        </table>
        <p v-if="currentBill.备注" class="reason-cell">备注：{{ currentBill.备注 }}</p>
        <div v-if="linkedReviews.length" class="linked-box">
          <strong>欠费牵动复核清单（{{ linkedReviews.length }} 条）：</strong>
          <ul>
            <li v-for="r in linkedReviews" :key="r.id">{{ r.复核编号 }} · {{ r.管线编号 }} · 分摊欠费 {{ money(r.欠费分摊) }} · {{ r.状态 }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  billDiff,
  billReceivable,
  downloadBillsCsv,
  downloadReconcileTemplate,
  generateBills,
  importReconcileFile,
  listBatches,
  listBills,
  listContracts,
  listReconcileRows,
  listReviews,
  packageAll,
  resetFeeLedger,
} from '@/api/fee-service'
import type { Bill, ReconcileRow, ReviewItem, ServiceContract } from '@/data/fee-types'
import { money } from '@/api/fee-logic'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.crew === 'billing')

const period = ref('2026-Q3')
const bills = ref<Bill[]>([])
const contractList = ref<ServiceContract[]>([])
const batches = ref(listBatches())
const reconRows = ref<ReconcileRow[]>([])
const reviews = ref<ReviewItem[]>([])
const batchFilter = ref(0)
const onlyUnmatched = ref(false)
const message = ref('')
const lastOk = ref(true)
const currentBill = ref<Bill | null>(null)
const reconFile = ref<HTMLInputElement | null>(null)

const stats = computed(() => {
  const rows = bills.value.filter((b) => b.状态 !== '已作废' && b.计费周期 === period.value)
  const arrears = rows.filter((b) => b.状态 === '欠费')
  return {
    结算单数: rows.length,
    应收合计: rows.reduce((s, b) => s + billReceivable(b), 0),
    已收合计: rows.reduce((s, b) => s + b.已收金额, 0),
    欠费单数: arrears.length,
    欠费合计: arrears.reduce((s, b) => s + (billReceivable(b) - b.已收金额), 0),
  }
})

const shownReconRows = computed(() => {
  let rows = reconRows.value
  if (batchFilter.value) rows = rows.filter((r) => r.批次 === batchFilter.value)
  if (onlyUnmatched.value) rows = rows.filter((r) => !r.是否匹配)
  return [...rows].sort((a, b) => b.批次 - a.批次 || a.文件行号 - b.文件行号)
})

const linkedReviews = computed(() =>
  currentBill.value ? reviews.value.filter((r) => r.结算单 === currentBill.value?.id) : [],
)

function receivable(b: Bill): number {
  return billReceivable(b)
}
function diff(b: Bill): number {
  return billDiff(b)
}

function flash(ok: boolean, text: string) {
  lastOk.value = ok
  message.value = text
}

function reload() {
  bills.value = listBills()
  contractList.value = listContracts()
  batches.value = listBatches()
  reconRows.value = listReconcileRows()
  reviews.value = listReviews()
}

function doGenerate() {
  const result = generateBills(period.value.trim(), store.crew, store.operator)
  flash(result.ok, result.message)
  reload()
}

function doExport() {
  const result = downloadBillsCsv(period.value.trim(), store.crew)
  flash(result.ok, result.message)
}

function downloadTemplate() {
  downloadReconcileTemplate(period.value.trim())
}

async function onReconFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const outcome = importReconcileFile(file.name, text, store.operator, store.crew)
  flash(outcome.ok, outcome.message)
  if (outcome.ok && outcome.批次) batchFilter.value = outcome.批次
  reload()
  input.value = ''
}

function doPackage() {
  const result = packageAll(period.value.trim(), store.crew)
  flash(result.ok, result.message)
}

function resetAll() {
  const result = resetFeeLedger()
  flash(result.ok, result.message)
  reload()
}

function openBill(b: Bill) {
  currentBill.value = b
}

onMounted(reload)
</script>
