<template>
  <section class="page" data-module="careledger">
    <header class="page-head">
      <div>
        <h2>保养台账对齐</h2>
        <p class="page-desc">
          欠费管线复核结论往这里落，与复核入口两边登记对齐；外部保养文件先导进来再处理：
          既有项照原编号更新，早年未登记项另起新行，两路取值不一致时按现场实测那份统一、其余照它回算。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="downloadSample">下载外部台账样例文件</button>
        <label class="btn file-btn" :class="{ disabled: !canWrite }">
          导入外部保养台账
          <input type="file" accept=".csv,text/csv" :disabled="!canWrite" @change="onFile" />
        </label>
        <button class="btn" type="button" @click="doExport">导出台账 CSV</button>
      </div>
    </header>

    <div class="perm-banner" :class="canWrite ? 'ok' : 'lock'">
      当前身份：<strong>{{ store.crewName }}</strong>
      <template v-if="canWrite">— 本入口可写：外部文件导入处理</template>
      <template v-else>— 不是机电维修班，本入口只读（复核结论由管线巡查班在复核入口提交，系统自动登记到此）</template>
    </div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">台账条目</span><strong class="stat-value">{{ ledger.length }}</strong></article>
      <article class="stat-card"><span class="stat-label">待对齐复核项</span><strong class="stat-value">{{ summary.待对齐.length }}</strong></article>
      <article class="stat-card" :class="{ alert: summary.未登记管线.length }">
        <span class="stat-label">未在台账登记的管线</span>
        <strong class="stat-value">{{ summary.未登记管线.length }}</strong>
      </article>
      <article class="stat-card"><span class="stat-label">两版取值不一致（已按实测统一）</span><strong class="stat-value">{{ summary.两版不一致 }}</strong></article>
    </div>

    <section v-if="summary.未登记管线.length" class="panel warn">
      <strong>早年未登记管线：</strong>
      <span v-for="p in summary.未登记管线" :key="p" class="fee-chip warn">{{ p }}（复核时另起 BY-NEW- 新行）</span>
    </section>

    <p v-if="message" class="result-banner" :class="lastOk ? 'ok' : 'err'">{{ message }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th>台账编号</th><th>保养对象</th><th>所属舱室</th><th>责任班组</th><th class="num">周期(月)</th>
          <th>上次保养</th><th>本次保养</th><th>现场实测值</th><th>台账申报值</th><th>采用版本</th>
          <th>下次保养（回算）</th><th>来源</th><th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in ledger" :key="l.id" :class="{ newrow: l.台账编号.startsWith('BY-NEW-') }">
          <td>{{ l.台账编号 }}</td>
          <td>{{ l.保养对象编号 }} {{ l.保养对象名称 }}</td>
          <td>{{ l.所属舱室 }}</td>
          <td>{{ l.责任班组 }}</td>
          <td class="num">{{ l.保养周期月 }}</td>
          <td>{{ l.上次保养日期 || '—' }}</td>
          <td>{{ l.本次保养日期 }}</td>
          <td>{{ l.现场实测值 }}</td>
          <td>{{ l.台账申报值 || '—' }}</td>
          <td><span class="tag 已结清">{{ l.取值版本 }}</span></td>
          <td>{{ l.下次保养日期 }}</td>
          <td>{{ l.数据来源 }}<template v-if="l.来源单号"><br />{{ l.来源单号 }}</template></td>
          <td><button class="link" type="button" @click="openDetail(l)">版本留痕</button></td>
        </tr>
      </tbody>
    </table>
    <p class="hint">
      编号口径：既有台账照原编号（DEVI-…）迁入；早年没登记的一律另起 BY-NEW- 新行并在备注说明原因。
      列表里的现场实测值、下次保养日期与详情版本记录同源。
    </p>

    <div v-if="current" class="modal-mask" @click.self="current = null">
      <div class="modal wide">
        <header class="modal-head">
          <h3>{{ current.台账编号 }} · 版本留痕与取值裁决</h3>
          <button class="link" type="button" @click="current = null">关闭</button>
        </header>
        <dl class="detail-grid">
          <div><dt>保养对象</dt><dd>{{ current.保养对象编号 }} {{ current.保养对象名称 }}</dd></div>
          <div><dt>所属舱室 / 班组</dt><dd>{{ current.所属舱室 }} / {{ current.责任班组 }}</dd></div>
          <div class="full"><dt>备注</dt><dd>{{ current.备注 }}</dd></div>
        </dl>
        <table class="data-table">
          <thead>
            <tr><th>变更时间</th><th>采用版本</th><th>现场实测值</th><th>台账申报值</th><th>本次保养</th><th>下次保养</th><th>裁决理由</th></tr>
          </thead>
          <tbody>
            <tr v-for="(v, i) in [...current.历史].reverse()" :key="i">
              <td>{{ v.变更时间 }}</td>
              <td>{{ v.取值版本 }}</td>
              <td>{{ v.现场实测值 }}</td>
              <td>{{ v.台账申报值 || '—' }}</td>
              <td>{{ v.本次保养日期 }}</td>
              <td>{{ v.下次保养日期 }}</td>
              <td class="reason-cell">{{ v.变更原因 }}</td>
            </tr>
            <tr v-if="current.历史.length === 0"><td colspan="7" class="empty-state">暂无版本记录（迁入时未带回双路取值）</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { exportLedgerCsv, importLedgerFile, ledgerAlignmentSummary, listLedger } from '@/api/fee-service'
import type { LedgerItem } from '@/data/fee-types'
import { toCsv } from '@/api/fee-logic'
import { downloadBlob } from '@/api/zip'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.crew === 'maintenance')

const ledger = ref<LedgerItem[]>([])
const summary = ref(ledgerAlignmentSummary())
const message = ref('')
const lastOk = ref(true)
const current = ref<LedgerItem | null>(null)

function reload() {
  ledger.value = listLedger()
  summary.value = ledgerAlignmentSummary()
}

function flash(ok: boolean, text: string) {
  lastOk.value = ok
  message.value = text
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const outcome = importLedgerFile(file.name, text, store.crew)
  flash(outcome.ok, outcome.message)
  reload()
  input.value = ''
}

function doExport() {
  const { filename, content } = exportLedgerCsv()
  downloadBlob(filename, new Blob([content], { type: 'text/csv;charset=utf-8' }))
}

function downloadSample() {
  const header = ['保养对象编号', '保养对象名称', '所属舱室', '责任班组', '保养周期月', '本次保养日期', '现场实测值', '台账申报值']
  const lines = [
    ['PIPE-0008', '燃气管线一（调压阀组）', '燃气舱D', '机电维修班', '3', '2026-10-05', '阀组无泄漏，实测压力 0.35MPa，支架完好', '阀组无泄漏，压力 0.30MPa'],
    ['PIPE-0005', '热力管线（补偿器）', '热力舱C', '机电维修班', '6', '2026-10-05', '补偿器位移正常，保温层完好', '补偿器位移正常，保温层完好'],
    ['PIPE-0020', '早年漏登中水管线', '综合舱A', '机电维修班', '3', '2026-10-05', '阀门启闭正常，法兰轻微渗水已紧固', '（无台账）'],
  ]
  downloadBlob('外部保养台账-样例.csv', new Blob([toCsv(header, lines)], { type: 'text/csv;charset=utf-8' }))
}

function openDetail(l: LedgerItem) {
  current.value = l
}

onMounted(reload)
</script>
