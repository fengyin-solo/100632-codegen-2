<template>
  <section class="page" data-module="review">
    <header class="page-head">
      <div>
        <h2>欠费管线复核清单</h2>
        <p class="page-desc">
          结算单对不上账挂欠费后，欠费牵动这里的入廊管线复核清单，由管线责任人逐条复核；
          复核结论直接落到「保养台账对齐」入口，两边登记对齐。本入口只有管线巡查班能提交。
        </p>
      </div>
    </header>

    <div class="perm-banner" :class="canWrite ? 'ok' : 'lock'">
      当前身份：<strong>{{ store.crewName }}</strong>
      <template v-if="canWrite">— 本入口可提交复核结论</template>
      <template v-else>— 不是管线巡查班，本入口只读，提交按归属驳回</template>
    </div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">待复核</span><strong class="stat-value">{{ count('待复核') }}</strong></article>
      <article class="stat-card"><span class="stat-label">复核中</span><strong class="stat-value">{{ count('复核中') }}</strong></article>
      <article class="stat-card"><span class="stat-label">已复核（已落台账）</span><strong class="stat-value">{{ count('已复核') }}</strong></article>
      <article class="stat-card"><span class="stat-label">已解除（欠费结清）</span><strong class="stat-value">{{ count('已解除') }}</strong></article>
    </div>

    <div class="filter-bar">
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option>待复核</option>
          <option>复核中</option>
          <option>已复核</option>
          <option>已解除</option>
        </select>
      </label>
    </div>

    <p v-if="message" class="result-banner" :class="lastOk ? 'ok' : 'err'">{{ message }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th>复核编号</th><th>管线编号</th><th>所属舱室</th><th>权属单位</th><th>合同编号</th>
          <th>结算单号</th><th>计费周期</th><th class="num">欠费分摊</th><th>状态</th><th>已登记台账</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in shown" :key="r.id" :class="{ done: r.状态 === '已复核', released: r.状态 === '已解除' }">
          <td>{{ r.复核编号 }}</td>
          <td>{{ r.管线编号 }}</td>
          <td>{{ r.所属舱室 }}</td>
          <td>{{ r.权属单位 }}</td>
          <td>{{ r.合同编号 }}</td>
          <td>{{ r.结算单号 }}</td>
          <td>{{ r.计费周期 }}</td>
          <td class="num">{{ money(r.欠费分摊) }}</td>
          <td><span class="tag" :class="statusTag(r.状态)">{{ r.状态 }}</span></td>
          <td>{{ r.登记台账编号 ?? '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(r)">详情</button>
            <button
              v-if="r.状态 === '待复核' || r.状态 === '复核中'"
              class="link"
              type="button"
              :disabled="!canWrite"
              @click="openSubmit(r)"
            >
              提交复核结论
            </button>
          </td>
        </tr>
        <tr v-if="shown.length === 0">
          <td colspan="11" class="empty-state">当前没有{{ statusFilter || '任何状态的' }}复核项；欠费结算单会自动挂出清单</td>
        </tr>
      </tbody>
    </table>
    <p class="hint">欠费分摊按该合同在廊管线数均摊，并随结算单已收金额实时回算，列表与结算单详情取同一个数。</p>

    <!-- 详情 -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal">
        <header class="modal-head">
          <h3>复核详情 {{ detail.复核编号 }}</h3>
          <button class="link" type="button" @click="detail = null">关闭</button>
        </header>
        <dl class="detail-grid">
          <div><dt>管线编号 / 舱室</dt><dd>{{ detail.管线编号 }} · {{ detail.所属舱室 }}</dd></div>
          <div><dt>权属单位 / 合同</dt><dd>{{ detail.权属单位 }} · {{ detail.合同编号 }}</dd></div>
          <div><dt>结算单 / 周期</dt><dd>{{ detail.结算单号 }} · {{ detail.计费周期 }}</dd></div>
          <div><dt>欠费分摊</dt><dd>{{ money(detail.欠费分摊) }} 元（随结算单实时回算）</dd></div>
          <div><dt>责任班组</dt><dd>{{ detail.责任班组 }}</dd></div>
          <div><dt>状态</dt><dd>{{ detail.状态 }}</dd></div>
          <div><dt>实测时间</dt><dd>{{ detail.实测时间 ?? '—' }}</dd></div>
          <div><dt>现场实测值</dt><dd>{{ detail.现场实测值 ?? '—' }}</dd></div>
          <div class="full"><dt>复核结论</dt><dd>{{ detail.复核结论 ?? '—' }}</dd></div>
          <div><dt>已登记台账</dt><dd>{{ detail.登记台账编号 ?? '—' }}（与保养台账入口同源）</dd></div>
        </dl>
      </div>
    </div>

    <!-- 提交复核结论：同时是保养登记 -->
    <div v-if="form" class="modal-mask" @click.self="form = null">
      <div class="modal wide">
        <header class="modal-head">
          <h3>提交复核结论 · {{ form.复核编号 }}（{{ form.管线编号 }}）</h3>
          <button class="link" type="button" @click="form = null">关闭</button>
        </header>
        <div class="form-grid">
          <label><span>现场实测值 *</span><textarea v-model="input.现场实测值" rows="2" placeholder="如：阀组无泄漏，压力 0.34MPa，支架完好"></textarea></label>
          <label><span>台账/申报值 *</span><textarea v-model="input.台账申报值" rows="2" placeholder="另一路取值；与实测不一致时按实测统一"></textarea></label>
          <label><span>实测时间 *</span><input v-model="input.实测时间" type="date" /></label>
          <label><span>本次保养日期 *</span><input v-model="input.本次保养日期" type="date" /></label>
          <label><span>保养周期（月）</span><input v-model.number="input.保养周期月" type="number" min="1" /></label>
          <label><span>保养责任班组</span><input v-model="input.责任班组" /></label>
          <label class="full"><span>复核结论 *</span><textarea v-model="input.复核结论" rows="2" placeholder="如：现场运行正常，已通知权属单位补缴欠费"></textarea></label>
        </div>
        <p class="hint">
          提交后：该管线在保养台账照原编号登记；早年没登记的另起 BY-NEW- 新行并说明。
          实测与台账两路取值不一致时按实测统一，下次保养日按「本次保养日期+周期」回算，两版留痕。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="form = null">取消</button>
          <button class="btn primary" type="button" @click="submit">提交并登记台账</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listReviews, submitReview } from '@/api/fee-service'
import type { ReviewItem } from '@/data/fee-types'
import { money, today } from '@/api/fee-logic'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.crew === 'pipeline')

const rows = ref<ReviewItem[]>([])
const statusFilter = ref('待复核')
const message = ref('')
const lastOk = ref(true)
const detail = ref<ReviewItem | null>(null)
const form = ref<ReviewItem | null>(null)
const input = ref({
  现场实测值: '',
  台账申报值: '',
  实测时间: today(),
  本次保养日期: today(),
  保养周期月: 3,
  责任班组: '机电维修班',
  复核结论: '',
})

const shown = computed(() =>
  statusFilter.value ? rows.value.filter((r) => r.状态 === statusFilter.value) : rows.value,
)

function count(status: string): number {
  return rows.value.filter((r) => r.状态 === status).length
}

function statusTag(status: string): string {
  if (status === '已复核') return '已结清'
  if (status === '已解除') return '已作废'
  return '欠费'
}

function flash(ok: boolean, text: string) {
  lastOk.value = ok
  message.value = text
}

function openDetail(r: ReviewItem) {
  detail.value = r
}

function openSubmit(r: ReviewItem) {
  form.value = r
  input.value = {
    现场实测值: '',
    台账申报值: '',
    实测时间: today(),
    本次保养日期: today(),
    保养周期月: 3,
    责任班组: '机电维修班',
    复核结论: '',
  }
}

function submit() {
  if (!form.value) return
  if (!input.value.现场实测值 || !input.value.台账申报值 || !input.value.复核结论) {
    flash(false, '请填齐现场实测值、台账申报值与复核结论')
    return
  }
  const result = submitReview(
    form.value.id,
    { 管线编号: form.value.管线编号, ...input.value },
    store.crew,
  )
  flash(result.ok, result.message)
  if (result.ok) form.value = null
  reload()
}

function reload() {
  rows.value = listReviews()
}

onMounted(reload)
</script>
