<template>
  <section class="page" data-module="contract">
    <header class="page-head">
      <div>
        <h2>入廊服务合同</h2>
        <p class="page-desc">
          结算出账的依据。存量书面合同按签订日期回填，可据此补历史周期出账；早年口头约定、没有书面合同的，
          先挂「待补签」，补签后登记为补签合同，自补签周期起出账，补签前不追挂应收。
        </p>
      </div>
    </header>

    <p v-if="!canWrite" class="readonly-banner">
      当前班组「{{ store.team }}」不是本入口责任班组，页面只读。
    </p>

    <h3>合同台账</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>合同编号</th><th>权属单位</th><th>联系人</th><th>签订日期</th><th>性质</th>
          <th>占用长度(米)</th><th>入廊费单价</th><th>服务费/周期</th><th>状态</th><th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in contracts" :key="c.id">
          <td>{{ c.contractNo }}</td>
          <td>{{ c.owner }}</td>
          <td>{{ c.contact }}</td>
          <td>{{ c.signDate }}</td>
          <td><span :class="['tag', c.kind === '补签合同' ? 'st-warn' : 'st-ok']">{{ c.kind }}</span></td>
          <td class="num">{{ c.occupiedLength }}</td>
          <td class="num">{{ c.entryFeeRate }}</td>
          <td class="num">{{ c.serviceFeeRate }}</td>
          <td>{{ c.status }}</td>
          <td class="note">{{ c.legacyNote || '—' }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-gap">早年口头约定、待补签的权属单位</h3>
    <p class="ruling">
      裁决：不替口头约定造历史应收。未补签前一律不出账、不挂欠费；权属单位补签书面合同后在此办理补签登记，
      合同性质记为「补签合同」，自补签日期所在计费周期起正常出账。
    </p>
    <table class="data-table">
      <thead>
        <tr><th>权属单位</th><th>联系人</th><th>口头入廊日</th><th>占用长度(米)</th><th>状态</th><th>说明</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="u in pending" :key="u.id">
          <td>{{ u.owner }}</td>
          <td>{{ u.contact }}</td>
          <td>{{ u.oralEntryDate }}</td>
          <td class="num">{{ u.occupiedLength }}</td>
          <td><span :class="['tag', u.status === '待补签' ? 'st-warn' : 'st-ok']">{{ u.status }}</span></td>
          <td class="note">{{ u.note }}</td>
          <td>
            <button
              v-if="u.status === '待补签'"
              class="btn"
              type="button"
              :disabled="!canWrite"
              @click="openSupplement(u.id)"
            >
              办理补签
            </button>
            <span v-else>已转合同台账</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="supplement" class="modal-mask" @click.self="supplement = null">
      <div class="modal">
        <h3>补签合同登记（{{ supplement.owner }}）</h3>
        <form class="form-grid" @submit.prevent="doSupplement">
          <label><span>补签合同编号</span><input v-model="form.contractNo" placeholder="如 HT-HT-2026-005" required /></label>
          <label><span>补签日期</span><input v-model="form.signDate" type="date" required /></label>
          <label><span>入廊费单价(元/米)</span><input v-model.number="form.entryFeeRate" type="number" min="0" required /></label>
          <label><span>服务费(元/周期)</span><input v-model.number="form.serviceFeeRate" type="number" min="0" required /></label>
          <p class="hint span2">
            原口头入廊日 {{ supplement.oralEntryDate }}；补签前不追挂应收，仅自 {{ form.signDate || '补签日' }}
            所在周期起出账。
          </p>
          <div class="modal-actions span2">
            <button class="btn" type="button" @click="supplement = null">取消</button>
            <button class="btn primary" type="submit">确认补签并入台账</button>
          </div>
        </form>
      </div>
    </div>

    <footer class="page-foot">
      <span>存量合同按签订日期回填；补签合同单独标注性质与口径，保证账实可追溯。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { supplementContract } from '@/api/fee-service'
import { listContracts, listPendingUnits } from '@/data/fee-store'
import type { PendingSupplementUnit } from '@/data/fee-types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite('contract'))

const contracts = ref(listContracts())
const pending = ref(listPendingUnits())
const supplement = ref<PendingSupplementUnit | null>(null)
const message = ref('')
const messageOk = ref(true)
const form = ref({ contractNo: '', signDate: '2026-10-06', entryFeeRate: 90, serviceFeeRate: 5400 })

function openSupplement(id: number) {
  supplement.value = listPendingUnits().find((item) => item.id === id) ?? null
  message.value = ''
}

function doSupplement() {
  if (!supplement.value) return
  try {
    const c = supplementContract({
      pendingId: supplement.value.id,
      contractNo: form.value.contractNo.trim(),
      signDate: form.value.signDate,
      entryFeeRate: Number(form.value.entryFeeRate),
      serviceFeeRate: Number(form.value.serviceFeeRate),
      operator: store.operator,
    })
    contracts.value = listContracts()
    pending.value = listPendingUnits()
    supplement.value = null
    message.value = `${c.owner} 已补签 ${c.contractNo}，可按补签周期出账`
    messageOk.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : '补签失败'
    messageOk.value = false
  }
}
</script>

<style scoped>
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
.st-warn {
  background: #fff4e0;
  color: #b54708;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.note {
  color: var(--muted);
  font-size: 12px;
  max-width: 260px;
}
.section-gap {
  margin-top: 18px;
}
.ruling {
  background: #eef4ff;
  border: 1px solid #c7d7fe;
  color: #1e3a8a;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.readonly-banner {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
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
  width: min(560px, 92vw);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
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
  grid-column: span 2;
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
