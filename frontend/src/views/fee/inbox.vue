<template>
  <section class="page" data-module="fee">
    <header class="page-head">
      <div>
        <h2>外部文件进出（先导进来，处理完再打包另存）</h2>
        <p class="page-desc">
          权属单位回传的对账文件先整批导入暂存，再统一逐行核对、入账；处理完成后把「原始文件 + 核对结果 +
          入账清单 + 处理说明」打成一个 zip 另存留档。
        </p>
      </div>
    </header>

    <p v-if="!canWrite" class="readonly-banner">
      当前班组「{{ store.team }}」不是本入口责任班组，仅可查看，导入/处理/打包已禁用。
    </p>

    <div class="panel">
      <h3>第一步：导入外部文件（暂存，不直接入账）</h3>
      <div class="row">
        <input ref="fileInput" type="file" accept=".csv,text/csv" :disabled="!canWrite" @change="onFile" />
        <select v-model="kind" :disabled="!canWrite">
          <option value="权属单位对账文件">权属单位对账文件</option>
          <option value="现场实测回传表">现场实测回传表</option>
        </select>
        <button class="btn primary" type="button" :disabled="!canWrite || !pending" @click="doStage">
          先导进来（暂存）
        </button>
      </div>
      <p class="hint">对账文件列：合同编号、计费周期、对方认可金额。导入只暂存与解析，不改动结算账。</p>
    </div>

    <h3>第二步：批次处理与打包另存</h3>
    <table class="data-table">
      <thead>
        <tr><th>批次</th><th>文件名</th><th>类型</th><th>导入时间/人</th><th>解析行数</th><th>状态</th><th>处理摘要</th><th>另存包</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in batches" :key="b.id">
          <td>#{{ b.id }}</td>
          <td>{{ b.fileName }}</td>
          <td>{{ b.kind }}</td>
          <td>{{ b.importedAt }}<br />{{ b.importedBy }}</td>
          <td class="num">{{ b.rows.length }}</td>
          <td><span :class="['tag', b.status === '已处理已打包' ? 'st-ok' : 'st-wait']">{{ b.status }}</span></td>
          <td class="note">{{ b.summary }}</td>
          <td>{{ b.packageName || '—' }}</td>
          <td>
            <button
              v-if="b.status === '已导入待处理'"
              class="link"
              type="button"
              :disabled="!canWrite"
              @click="doProcess(b.id)"
            >
              处理并打包
            </button>
            <button class="link" type="button" @click="preview = b">查看内容</button>
          </td>
        </tr>
        <tr v-if="!batches.length"><td colspan="9" class="empty-state">还没有导入任何外部文件</td></tr>
      </tbody>
    </table>

    <div v-if="preview" class="modal-mask" @click.self="preview = null">
      <div class="modal wide">
        <h3>#{{ preview.id }} {{ preview.fileName }}（{{ preview.rows.length }} 行）</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr><th v-for="h in previewHeaders" :key="h">{{ h }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in preview.rows.slice(0, 50)" :key="i">
                <td v-for="h in previewHeaders" :key="h">{{ row[h] ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="preview.rows.length > 50" class="hint">仅预览前 50 行。</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="preview = null">关闭</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>处理顺序受控：必须先导入暂存，再逐行核对入账，最后生成 zip 另存；已打包批次不可重复处理。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { processAndPack, stageImport } from '@/api/fee-service'
import { listBatches } from '@/data/fee-store'
import type { ImportBatch } from '@/data/fee-types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite('fee'))

const batches = ref(listBatches())
const kind = ref('权属单位对账文件')
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<{ name: string; text: string } | null>(null)
const preview = ref<ImportBatch | null>(null)
const message = ref('')
const messageOk = ref(true)

const previewHeaders = computed(() =>
  preview.value && preview.value.rows.length ? Object.keys(preview.value.rows[0]) : [],
)

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  file.text().then((text) => {
    pending.value = { name: file.name, text }
    message.value = `已暂存文件内容：${file.name}（尚未入账）`
    messageOk.value = true
  })
}

function doStage() {
  if (!pending.value) return
  try {
    const batch = stageImport({
      fileName: pending.value.name,
      text: pending.value.text,
      kind: kind.value,
      team: store.team,
      operator: store.operator,
    })
    batches.value = listBatches()
    pending.value = null
    if (fileInput.value) fileInput.value.value = ''
    message.value = `批次 #${batch.id} 已导入暂存，共 ${batch.rows.length} 行，等待处理`
    messageOk.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : '导入失败'
    messageOk.value = false
  }
}

function doProcess(id: number) {
  try {
    const { packageName, result } = processAndPack(id)
    batches.value = listBatches()
    const detail =
      'lines' in result
        ? `入账 ${result.bookedCount} 行，差异 ${result.diffCount} 行，匹配不上 ${result.unmatchedCount} 行`
        : `按实测取值 ${result.applied} 行，匹配不上 ${result.unmatched.length} 行`
    const unmatched = 'lines' in result ? result.unmatchedCount : result.unmatched.length
    message.value = `已处理并另存 ${packageName}；${detail}`
    messageOk.value = unmatched === 0
  } catch (error) {
    message.value = error instanceof Error ? error.message : '处理失败'
    messageOk.value = false
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
.row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0 0;
}
.num {
  text-align: right;
}
.note {
  font-size: 12px;
  color: var(--muted);
  max-width: 280px;
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
.st-wait {
  background: #eef2f7;
  color: #475569;
}
.readonly-banner {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.btn:disabled,
.link:disabled {
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
  width: min(680px, 92vw);
  max-height: 86vh;
  overflow: auto;
}
.modal.wide {
  width: min(900px, 94vw);
}
.table-scroll {
  overflow: auto;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.ok-text {
  color: #1a7f37;
}
.error-text {
  color: #b42318;
}
</style>
