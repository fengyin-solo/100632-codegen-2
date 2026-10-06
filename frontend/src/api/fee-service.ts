import { feeState, resetFeeState, saveFeeState } from '@/data/fee-store'
import type {
  Bill,
  FeeState,
  ImportBatch,
  LedgerItem,
  LedgerVersion,
  ReconcileRow,
  ReviewItem,
  ServiceContract,
} from '@/data/fee-types'
import type { CrewKey } from '@/stores/session'
import {
  addMonths,
  billDiff,
  billReceivable,
  comparePeriod,
  firstChargePeriod,
  money,
  nowStamp,
  parseAmount,
  parseCsv,
  periodLabel,
  round2,
  today,
  toCsv,
} from './fee-logic'
import { buildZip, downloadBlob, type ZipEntry } from './zip'

/** 越权统一拦截：不是本责任班组的写操作一律拒绝（页面只读 + 服务层兜底）。 */
function guard(crew: CrewKey, requireKey: CrewKey, entry: string): string {
  if (crew === requireKey) return ''
  const map: Record<CrewKey, string> = {
    billing: '收费结算班组',
    pipeline: '管线巡查班',
    maintenance: '机电维修班',
    viewer: '其他人员（只读）',
  }
  return `按归属驳回：「${entry}」只允许${map[requireKey]}提交，${map[crew]}在该入口只读`
}

function commit(state: FeeState): FeeState {
  saveFeeState(state)
  return feeState()
}

function nextId(state: FeeState, key: keyof FeeState['seq']): number {
  state.seq[key] += 1
  return state.seq[key]
}

function contracts(state: FeeState): ServiceContract[] {
  return state.contracts
}

function validBills(state: FeeState): Bill[] {
  return state.bills.filter((b) => b.状态 !== '已作废')
}

function latestBillFor(state: FeeState, contractNo: string, period: string): Bill | undefined {
  return validBills(state)
    .filter((b) => b.合同编号 === contractNo && b.计费周期 === period)
    .sort((a, b) => b.版次 - a.版次 || b.id - a.id)[0]
}

/* ------------------------------------------------------------------ 合同查询 */

export function listContracts(): ServiceContract[] {
  return contracts(feeState()).map((item) => ({ ...item, 管线编号列表: [...item.管线编号列表] }))
}

/* ------------------------------------------------------------------ 结算单 */

export function listBills(period = ''): Bill[] {
  const rows = [...feeState().bills].sort((a, b) =>
    comparePeriod(a.计费周期, b.计费周期) === 0
      ? a.合同编号.localeCompare(b.合同编号) || b.版次 - a.版次
      : -comparePeriod(a.计费周期, b.计费周期),
  )
  return period ? rows.filter((b) => b.计费周期 === period) : rows
}

export function billStats(period: string): { 结算单数: number; 应收合计: number; 已收合计: number; 欠费单数: number; 欠费合计: number } {
  const rows = validBills(feeState()).filter((b) => b.计费周期 === period)
  const arrears = rows.filter((b) => b.状态 === '欠费')
  return {
    结算单数: rows.length,
    应收合计: round2(rows.reduce((s, b) => s + billReceivable(b), 0)),
    已收合计: round2(rows.reduce((s, b) => s + b.已收金额, 0)),
    欠费单数: arrears.length,
    欠费合计: round2(arrears.reduce((s, b) => s + (billReceivable(b) - b.已收金额), 0)),
  }
}

/**
 * 按计费周期整批出账。
 * 同一个计费周期重复出账只认最后生成的那一版：旧版置「已作废」并记录被谁替代，金额不叠加；
 * 入廊费只在合同首费周期出现一次，其余周期仅服务费。
 */
export function generateBills(
  period: string,
  crew: CrewKey,
  operator: string,
): { ok: boolean; message: string; created: number; superseded: number } {
  const denied = guard(crew, 'billing', '结算单出账')
  if (denied) return { ok: false, message: denied, created: 0, superseded: 0 }

  const state: FeeState = JSON.parse(JSON.stringify(feeState()))
  const stamp = nowStamp()
  let created = 0
  let superseded = 0
  let seqNo = validBills(state).filter((b) => b.计费周期 === period).length

  for (const contract of contracts(state)) {
    if (comparePeriod(period, firstChargePeriod(contract.签订日期)) < 0) continue
    const lines =
      period === firstChargePeriod(contract.签订日期)
        ? [
            ...(contract.入廊费 > 0
              ? [{ 费目: '入廊费' as const, 说明: `${periodLabel(period)} 一次性入廊费（${contract.管线编号列表.join('、')}）`, 金额: contract.入廊费 }]
              : []),
            { 费目: '服务费' as const, 说明: `${periodLabel(period)} 入廊管线日常运维服务费`, 金额: contract.单周期服务费 },
          ]
        : [
            { 费目: '服务费' as const, 说明: `${periodLabel(period)} 入廊管线日常运维服务费`, 金额: contract.单周期服务费 },
          ]

    const previous = latestBillFor(state, contract.合同编号, period)
    const version = previous ? previous.版次 + 1 : 1
    if (previous) {
      previous.状态 = '已作废'
      previous.被谁替代 = state.seq.bill + 1
      previous.备注 = `${stamp} 同周期重新出账，本版被 v${version} 替代，金额不叠加`
      superseded += 1
    }
    const id = nextId(state, 'bill')
    seqNo += 1
    const seq = String(seqNo).padStart(3, '0')
    state.bills.push({
      id,
      结算单号: `JS-${period}-${seq}${version > 1 ? `-v${version}` : ''}`,
      合同编号: contract.合同编号,
      权属单位: contract.权属单位,
      计费周期: period,
      版次: version,
      状态: '待对账',
      明细: lines,
      对方确认金额: 0,
      已收金额: 0,
      生成时间: stamp,
    })
    created += 1
  }

  commit(state)
  return {
    ok: true,
    message: `${periodLabel(period)}出账完成：生成 ${created} 张结算单${
      superseded ? `，旧版作废 ${superseded} 张（不叠加，以最后一版为准）` : ''
    }；操作人 ${operator}`,
    created,
    superseded,
  }
}

/* ------------------------------------------------------------------ 导出结算单 */

const BILL_EXPORT_HEADER = ['结算单号', '合同编号', '权属单位', '计费周期', '版次', '费目', '账列金额', '对方确认金额', '已收金额', '状态']

function billExportLines(bills: Bill[]): unknown[][] {
  const lines: unknown[][] = []
  for (const b of bills) {
    if (b.明细.length === 0) {
      lines.push([b.结算单号, b.合同编号, b.权属单位, b.计费周期, `v${b.版次}`, '', billReceivable(b), b.对方确认金额, b.已收金额, b.状态])
    }
    b.明细.forEach((line) => {
      lines.push([b.结算单号, b.合同编号, b.权属单位, b.计费周期, `v${b.版次}`, line.费目, line.金额, b.对方确认金额, b.已收金额, b.状态])
    })
  }
  return lines
}

/** 结算单费用明细导出（交给权属单位对账的那份）：只导有效版。 */
export function exportBillsCsv(period: string): { filename: string; content: string } {
  const rows = validBills(feeState()).filter((b) => b.计费周期 === period)
  return {
    filename: `入廊费服务费结算单-${period}.csv`,
    content: toCsv(BILL_EXPORT_HEADER, billExportLines(rows)),
  }
}

export function downloadBillsCsv(period: string, crew: CrewKey): { ok: boolean; message: string } {
  const denied = guard(crew, 'billing', '结算单导出')
  if (denied) return { ok: false, message: denied }
  const { filename, content } = exportBillsCsv(period)
  downloadBlob(filename, new Blob([content], { type: 'text/csv;charset=utf-8' }))
  return { ok: true, message: `已导出 ${filename}` }
}

/** 对账回函模板：预填合同/周期/账列金额，对方只需回填确认、已缴与备注。 */
export function downloadReconcileTemplate(period: string): void {
  const bills = validBills(feeState()).filter((b) => b.计费周期 === period)
  const header = ['合同编号', '计费周期', '费目', '账列金额', '回函确认金额', '回函已缴金额', '对方备注']
  const lines = billExportLines(bills).map((line) => [line[1], line[3], line[5], line[6], '', '', ''])
  downloadBlob(
    `对账回函模板-${period}.csv`,
    new Blob([toCsv(header, lines)], { type: 'text/csv;charset=utf-8' }),
  )
}

/* ------------------------------------------------------------------ 欠费联动复核清单 */

/** 欠费金额在该合同管线上均摊（列表与详情同源，随结算单金额实时回算）。 */
function arrearsShare(bill: Bill, count: number): number {
  const rest = billReceivable(bill) - bill.已收金额
  return round2(rest / Math.max(count, 1))
}

/**
 * 结算单状态变化后同步复核清单：
 * 欠费 → 按该合同下在廊管线逐条挂待复核；已结清 → 解除未处理的复核项（已复核的留痕）。
 */
function syncReviews(state: FeeState, bill: Bill): void {
  const contract = contracts(state).find((item) => item.合同编号 === bill.合同编号)
  const existing = state.reviews.filter((r) => r.结算单 === bill.id)
  if (bill.状态 === '欠费' && contract) {
    const share = arrearsShare(bill, contract.管线编号列表.length)
    for (const pipeNo of contract.管线编号列表) {
      const found = existing.find((r) => r.管线编号 === pipeNo)
      if (found) {
        found.欠费分摊 = share
        found.更新时间 = nowStamp()
      } else {
        const id = nextId(state, 'review')
        state.reviews.push({
          id,
          复核编号: `FH-2026-${String(id).padStart(4, '0')}`,
          管线编号: pipeNo,
          所属舱室: contract.所属舱室,
          权属单位: bill.权属单位,
          合同编号: bill.合同编号,
          结算单: bill.id,
          结算单号: bill.结算单号,
          计费周期: bill.计费周期,
          欠费分摊: share,
          状态: '待复核',
          责任班组: '管线巡查班',
          创建时间: nowStamp(),
          更新时间: nowStamp(),
        })
      }
    }
  } else if (bill.状态 === '已结清') {
    for (const item of existing) {
      if (item.状态 !== '已复核') {
        item.状态 = '已解除'
        item.复核结论 = item.复核结论 ? `${item.复核结论}；欠费结清，复核解除` : '欠费结清，复核解除'
        item.更新时间 = nowStamp()
      }
    }
  }
}

/* ------------------------------------------------------------------ 对账导入 */

export interface ImportOutcome {
  ok: boolean
  message: string
  批次: number
  匹配入账: number
  未匹配: number
  新增欠费: number
  结清: number
  rows: ReconcileRow[]
  unmatched: ReconcileRow[]
}

/**
 * 导入对方回传的对账文件，按「合同编号 + 计费周期」匹配有效版结算单，逐行核对：
 * 匹配上的照常入账（汇总确认/已缴金额，回写结算单状态并牵动复核清单）；
 * 匹配不上的那一行单独列出并写明原因，不影响其他行；指向作废旧版的也算未匹配。
 */
export function importReconcileFile(
  filename: string,
  text: string,
  operator: string,
  crew: CrewKey,
): ImportOutcome {
  const denied = guard(crew, 'billing', '对账文件导入')
  if (denied) return { ok: false, message: denied, 批次: 0, 匹配入账: 0, 未匹配: 0, 新增欠费: 0, 结清: 0, rows: [], unmatched: [] }

  const state: FeeState = JSON.parse(JSON.stringify(feeState()))
  const batchId = nextId(state, 'batch')
  const batch: ImportBatch = { id: batchId, 文件名: filename, 导入时间: nowStamp(), 计费周期: '', 操作人: operator }
  const records = parseCsv(text)
  const rows: ReconcileRow[] = []
  const affectedBills = new Map<number, { confirmed: number; paid: number }>()

  if (records.length === 0) {
    state.seq.batch -= 1
    commit(state)
    return { ok: false, message: '文件没有可导入的数据行（首行须为表头）', 批次: 0, 匹配入账: 0, 未匹配: 0, 新增欠费: 0, 结清: 0, rows: [], unmatched: [] }
  }

  records.forEach((rec, idx) => {
    const lineNo = idx + 2
    const contractNo = (rec['合同编号'] ?? '').trim()
    const period = (rec['计费周期'] ?? '').trim()
    const feeName = (rec['费目'] ?? '').trim()
    const confirmed = parseAmount(rec['回函确认金额'] ?? '0')
    const paid = parseAmount(rec['回函已缴金额'] ?? '0')
    const note = (rec['对方备注'] ?? '').trim()
    const ledgerAmount = parseAmount(rec['账列金额'] ?? '0')
    if (!batch.计费周期) batch.计费周期 = period

    const base: ReconcileRow = {
      id: nextId(state, 'recon'),
      批次: batchId,
      文件行号: lineNo,
      合同编号: contractNo,
      计费周期: period,
      费目: feeName,
      账列金额: Number.isFinite(ledgerAmount) ? ledgerAmount : 0,
      回函确认金额: Number.isFinite(confirmed) ? confirmed : 0,
      回函已缴金额: Number.isFinite(paid) ? paid : 0,
      对方备注: note,
      是否匹配: false,
      原因: '',
      核对结论: '',
    }

    const contract = contracts(state).find((item) => item.合同编号 === contractNo)
    const target = contract ? latestBillFor(state, contractNo, period) : undefined
    if (!contract) {
      base.原因 = `合同编号 ${contractNo || '（空）'} 在入廊服务合同台账中不存在，无法按「合同编号+计费周期」匹配`
      base.核对结论 = '未入账；退回对方核实合同编号后重传'
    } else if (!target) {
      if (comparePeriod(period, firstChargePeriod(contract.签订日期)) < 0) {
        base.原因 = `合同 ${contractNo} 首费周期为 ${firstChargePeriod(contract.签订日期)}，${period} 在合同签订之前，无结算单可匹配`
      } else {
        base.原因 = `合同 ${contractNo} 在 ${period} 没有有效结算单（可能尚未出账）`
      }
      base.核对结论 = '未入账；挂「待核销来款」，与本周期出账后再核销'
    } else {
      const voided = state.bills.find(
        (b) => b.合同编号 === contractNo && b.计费周期 === period && b.状态 === '已作废',
      )
      const receivable = billReceivable(target)
      base.是否匹配 = true
      base.结算单 = target.id
      const agg = affectedBills.get(target.id) ?? { confirmed: 0, paid: 0 }
      agg.confirmed = round2(agg.confirmed + base.回函确认金额)
      agg.paid = round2(agg.paid + base.回函已缴金额)
      affectedBills.set(target.id, agg)
      const issues: string[] = []
      if (voided) issues.push('该周期旧版已作废，金额已按最后一版核对（旧版不叠加）')
      if (Math.abs(base.回函确认金额 - receivable) > 0.001 && feeName !== '') {
        // 多行汇总后再判定最终差额，这里先记录逐行差异
        issues.push(`本行确认 ${money(base.回函确认金额)} 与账列 ${money(receivable)} 不一致`)
      }
      base.核对结论 = `已匹配结算单 ${target.结算单号}${issues.length ? '；' + issues.join('；') : ''}`
    }
    rows.push(base)
  })

  // 汇总回写结算单
  let arrearsCount = 0
  let settledCount = 0
  for (const [billId, agg] of affectedBills) {
    const target = state.bills.find((b) => b.id === billId)
    if (!target) continue
    target.对方确认金额 = agg.confirmed
    target.已收金额 = agg.paid
    target.对账批次 = batchId
    target.对账时间 = nowStamp()
    if (agg.paid + 0.001 >= billReceivable(target)) {
      target.状态 = '已结清'
      target.备注 = '回函金额与账列相符且已足额缴纳'
      settledCount += 1
    } else {
      target.状态 = '欠费'
      target.备注 = `回函确认 ${money(agg.confirmed)}，已缴 ${money(agg.paid)}，差额 ${money(billReceivable(target) - agg.paid)} 元挂欠费`
      arrearsCount += 1
    }
    syncReviews(state, target)
  }

  state.batches.push(batch)
  state.reconRows.push(...rows)
  commit(state)
  const unmatched = rows.filter((r) => !r.是否匹配)
  return {
    ok: true,
    批次: batchId,
    匹配入账: rows.length - unmatched.length,
    未匹配: unmatched.length,
    新增欠费: arrearsCount,
    结清: settledCount,
    rows,
    unmatched,
    message: `批次 #${batchId} 导入完成：匹配入账 ${rows.length - unmatched.length} 行，未匹配 ${unmatched.length} 行（已单列原因）；新增欠费单 ${arrearsCount} 张、结清 ${settledCount} 张`,
  }
}

export function listReconcileRows(batchId = 0): ReconcileRow[] {
  const rows = feeState().reconRows
  return batchId ? rows.filter((r) => r.批次 === batchId) : [...rows]
}

export function listBatches(): ImportBatch[] {
  return [...feeState().batches].sort((a, b) => b.id - a.id)
}

/* ------------------------------------------------------------------ 复核清单（另一个入口） */

export function listReviews(status = ''): ReviewItem[] {
  const rows = feeState().reviews.filter((r) => (status ? r.状态 === status : true))
  // 欠费分摊实时回算，保证列表数字与结算单详情一致
  return rows.map((r) => {
    const bill = feeState().bills.find((b) => b.id === r.结算单)
    if (bill && bill.状态 === '欠费') {
      const contract = feeState().contracts.find((c) => c.合同编号 === bill.合同编号)
      if (contract) return { ...r, 欠费分摊: arrearsShare(bill, contract.管线编号列表.length) }
    }
    return { ...r }
  })
}

export interface ReviewSubmit {
  管线编号: string
  现场实测值: string
  台账申报值: string
  实测时间: string
  复核结论: string
  本次保养日期: string
  保养周期月: number
  责任班组: string
}

/**
 * 管线责任人提交复核：只有「管线巡查班」能提交。
 * 结论落到保养台账——已有同编号台账照原编号登记；早年没登记的另起新行（BY-NEW-…）并说明。
 * 两路取值不一致时按现场实测统一，下次保养日以本次保养日按周期回算；两版均留痕。
 */
export function submitReview(id: number, input: ReviewSubmit, crew: CrewKey): { ok: boolean; message: string; 台账编号?: string } {
  const denied = guard(crew, 'pipeline', '管线复核提交')
  if (denied) return { ok: false, message: denied }

  const state: FeeState = JSON.parse(JSON.stringify(feeState()))
  const review = state.reviews.find((r) => r.id === id)
  if (!review) return { ok: false, message: `没有找到复核项 #${id}` }
  if (review.状态 === '已复核') return { ok: false, message: '该复核项已提交，不能重复登记' }
  if (review.状态 === '已解除') return { ok: false, message: '欠费已结清，复核项已解除，无需提交' }

  const nextDate = addMonths(input.本次保养日期, input.保养周期月)
  const useMeasured = input.现场实测值.trim() !== input.台账申报值.trim()
  const chosen = '现场实测版'
  const reason = useMeasured
    ? `两路取值不一致，按现场实测值统一：实测「${input.现场实测值}」/ 台账申报「${input.台账申报值}」；下次保养日按本次保养日 ${input.本次保养日期} + ${input.保养周期月} 个月回算`
    : '两路取值一致，按实测登记'

  const existing = state.ledger.find((l) => l.保养对象编号 === review.管线编号)
  const version: LedgerVersion = {
    取值版本: chosen,
    现场实测值: input.现场实测值,
    台账申报值: input.台账申报值,
    本次保养日期: input.本次保养日期,
    下次保养日期: nextDate,
    变更时间: nowStamp(),
    变更原因: reason,
  }

  let ledgerId: number
  let ledgerNo: string
  if (existing) {
    existing.上次保养日期 = existing.本次保养日期
    existing.本次保养日期 = input.本次保养日期
    existing.现场实测值 = input.现场实测值
    existing.台账申报值 = input.台账申报值
    existing.取值版本 = chosen
    existing.下次保养日期 = nextDate
    existing.数据来源 = '复核登记'
    existing.来源单号 = review.复核编号
    existing.备注 = `复核登记（${review.复核编号}）：${reason}`
    existing.历史.push(version)
    existing.更新时间 = nowStamp()
    ledgerId = existing.id
    ledgerNo = existing.台账编号
  } else {
    ledgerId = nextId(state, 'ledger')
    ledgerNo = `BY-NEW-${String(ledgerId).padStart(4, '0')}`
    const contract = state.contracts.find((c) => c.合同编号 === review.合同编号)
    const item: LedgerItem = {
      id: ledgerId,
      台账编号: ledgerNo,
      保养对象编号: review.管线编号,
      保养对象名称: `${review.管线编号}（${contract?.管线类型 ?? '入廊管线'}）`,
      所属舱室: review.所属舱室,
      责任班组: input.责任班组,
      保养周期月: input.保养周期月,
      上次保养日期: '',
      本次保养日期: input.本次保养日期,
      现场实测值: input.现场实测值,
      台账申报值: input.台账申报值,
      取值版本: chosen,
      下次保养日期: nextDate,
      数据来源: '复核登记',
      来源单号: review.复核编号,
      备注: `早年未登记，复核结论另起一行补录（${review.复核编号}）；${reason}`,
      历史: [version],
      更新时间: nowStamp(),
    }
    state.ledger.push(item)
  }

  review.状态 = '已复核'
  review.实测时间 = input.实测时间
  review.现场实测值 = input.现场实测值
  review.复核结论 = input.复核结论
  review.登记台账编号 = ledgerNo
  review.更新时间 = nowStamp()

  commit(state)
  return {
    ok: true,
    台账编号: ledgerNo,
    message: `复核已提交并登记保养台账 ${ledgerNo}（${existing ? '照原编号登记' : '早年未登记，另起新行'}）：${reason}`,
  }
}

/* ------------------------------------------------------------------ 保养台账（别的入口） */

export function listLedger(): LedgerItem[] {
  return [...feeState().ledger].sort((a, b) => a.台账编号.localeCompare(b.台账编号, 'zh-CN', { numeric: true }))
}

export function ledgerAlignmentSummary(): {
  待复核管线: number
  未登记管线: string[]
  已对齐: number
  待对齐: ReviewItem[]
  两版不一致: number
} {
  const state = feeState()
  const open = state.reviews.filter((r) => r.状态 === '待复核' || r.状态 === '复核中')
  const ledgerPipes = new Set(state.ledger.map((l) => l.保养对象编号))
  const contracts = state.contracts
  const allPipes = new Set<string>()
  contracts.forEach((c) => c.管线编号列表.forEach((p) => allPipes.add(p)))
  const missing = [...allPipes].filter((p) => !ledgerPipes.has(p))
  const conflict = state.ledger.filter(
    (l) => l.台账申报值 && l.现场实测值 && l.台账申报值 !== l.现场实测值,
  ).length
  return {
    待复核管线: open.length,
    未登记管线: missing,
    已对齐: open.filter((r) => r.登记台账编号).length,
    待对齐: open,
    两版不一致: conflict,
  }
}

const LEDGER_HEADER = ['台账编号', '保养对象编号', '保养对象名称', '所属舱室', '责任班组', '保养周期月', '上次保养日期', '本次保养日期', '现场实测值', '台账申报值', '下次保养日期', '数据来源', '备注']

export function exportLedgerCsv(): { filename: string; content: string } {
  const lines = listLedger().map((l) => [
    l.台账编号, l.保养对象编号, l.保养对象名称, l.所属舱室, l.责任班组, l.保养周期月,
    l.上次保养日期, l.本次保养日期, l.现场实测值, l.台账申报值, l.下次保养日期, l.数据来源, l.备注,
  ])
  return { filename: '入廊设施保养台账.csv', content: toCsv(LEDGER_HEADER, lines) }
}

export interface LedgerImportOutcome {
  ok: boolean
  message: string
  更新: number
  新增: number
  rows: { 台账编号: string; 保养对象编号: string; 结论: string }[]
}

/**
 * 先导进来的外部保养文件处理：按保养对象编号匹配——
 * 既有台账照原编号更新；早年没登记的一律另起新行（BY-NEW-…）说明原因；
 * 两路取值互不相同时按现场实测那份统一，下次保养日照周期回算，旧版进历史。
 */
export function importLedgerFile(filename: string, text: string, crew: CrewKey): LedgerImportOutcome {
  const denied = guard(crew, 'maintenance', '保养台账导入')
  if (denied) return { ok: false, message: denied, 更新: 0, 新增: 0, rows: [] }

  const state: FeeState = JSON.parse(JSON.stringify(feeState()))
  const records = parseCsv(text)
  if (records.length === 0) {
    return { ok: false, message: '文件没有可导入的数据行（首行须为表头）', 更新: 0, 新增: 0, rows: [] }
  }
  let updated = 0
  let created = 0
  const summary: LedgerImportOutcome['rows'] = []

  records.forEach((rec) => {
    const objectNo = (rec['保养对象编号'] ?? '').trim()
    const measured = (rec['现场实测值'] ?? '').trim()
    const declared = (rec['台账申报值'] ?? '').trim()
    const careDate = (rec['本次保养日期'] ?? '').trim() || today()
    const months = Number(rec['保养周期月'] ?? '3')
    const existing = state.ledger.find((l) => l.保养对象编号 === objectNo)
    const useMeasured = measured !== declared && measured !== ''
    const reason = useMeasured
      ? `外部文件导入：两路取值不一致，按现场实测值统一（实测「${measured}」/ 台账「${declared}」）；下次保养日按周期回算`
      : '外部文件导入：取值一致，照登记更新'
    const version: LedgerVersion = {
      取值版本: '现场实测版',
      现场实测值: measured,
      台账申报值: declared,
      本次保养日期: careDate,
      下次保养日期: addMonths(careDate, Number.isFinite(months) ? months : 3),
      变更时间: nowStamp(),
      变更原因: reason,
    }
    if (existing) {
      existing.上次保养日期 = existing.本次保养日期
      existing.本次保养日期 = careDate
      existing.现场实测值 = measured || existing.现场实测值
      existing.台账申报值 = declared
      existing.取值版本 = '现场实测版'
      existing.下次保养日期 = version.下次保养日期
      existing.历史.push(version)
      existing.数据来源 = '外部导入'
      existing.备注 = `${filename} 导入，照原编号 ${existing.台账编号} 更新；${reason}`
      existing.更新时间 = nowStamp()
      updated += 1
      summary.push({ 台账编号: existing.台账编号, 保养对象编号: objectNo, 结论: `照原编号更新；${useMeasured ? '以实测为准' : '账实一致'}` })
    } else {
      const id = nextId(state, 'ledger')
      const no = `BY-NEW-${String(id).padStart(4, '0')}`
      state.ledger.push({
        id,
        台账编号: no,
        保养对象编号: objectNo,
        保养对象名称: (rec['保养对象名称'] ?? '').trim() || `${objectNo}（外部补录）`,
        所属舱室: (rec['所属舱室'] ?? '').trim(),
        责任班组: (rec['责任班组'] ?? '').trim() || '机电维修班',
        保养周期月: Number.isFinite(months) ? months : 3,
        上次保养日期: '',
        本次保养日期: careDate,
        现场实测值: measured,
        台账申报值: declared,
        取值版本: '现场实测版',
        下次保养日期: version.下次保养日期,
        数据来源: '外部导入',
        来源单号: filename,
        备注: `早年未登记，外部文件导入另起一行（原文件无台账编号）；${reason}`,
        历史: [version],
        更新时间: nowStamp(),
      })
      created += 1
      summary.push({ 台账编号: no, 保养对象编号: objectNo, 结论: '早年未登记，另起新行；以实测为准' })
    }
  })

  commit(state)
  return {
    ok: true,
    更新: updated,
    新增: created,
    rows: summary,
    message: `外部保养台账处理完成：照原编号更新 ${updated} 行，早年未登记另起新行 ${created} 行；取值冲突一律按现场实测统一并回算下次保养日`,
  }
}

/* ------------------------------------------------------------------ 整批打包另存 */

export function packageAll(period: string, crew: CrewKey): { ok: boolean; message: string } {
  const denied = guard(crew, 'billing', '结算批次打包')
  if (denied) return { ok: false, message: denied }

  const state = feeState()
  const bills = validBills(state).filter((b) => b.计费周期 === period)
  const batchIds = new Set(bills.map((b) => b.对账批次).filter((x): x is number => typeof x === 'number'))
  const reconRows = state.reconRows.filter((r) => batchIds.has(r.批次) || r.计费周期 === period)
  const reviews = state.reviews.filter((r) => r.计费周期 === period)
  const openReviews = reviews.filter((r) => r.状态 !== '已解除')
  const stamp = today()

  const entries: ZipEntry[] = [
    { filename: `结算单费用明细-${period}.csv`, content: exportBillsCsv(period).content },
    {
      filename: `对账核对结果-${period}.csv`,
      content: toCsv(
        ['批次', '文件行号', '合同编号', '计费周期', '费目', '账列金额', '回函确认金额', '回函已缴金额', '是否匹配', '原因', '核对结论', '对方备注'],
        reconRows.map((r) => [r.批次, r.文件行号, r.合同编号, r.计费周期, r.费目, r.账列金额, r.回函确认金额, r.回函已缴金额, r.是否匹配 ? '匹配' : '不匹配', r.原因, r.核对结论, r.对方备注]),
      ),
    },
    {
      filename: `欠费管线复核清单-${period}.csv`,
      content: toCsv(
        ['复核编号', '管线编号', '所属舱室', '权属单位', '合同编号', '结算单号', '欠费分摊', '状态', '实测时间', '现场实测值', '登记台账编号', '复核结论'],
        openReviews.map((r) => [r.复核编号, r.管线编号, r.所属舱室, r.权属单位, r.合同编号, r.结算单号, r.欠费分摊, r.状态, r.实测时间 ?? '', r.现场实测值 ?? '', r.登记台账编号 ?? '', r.复核结论 ?? '']),
      ),
    },
    { filename: '入廊设施保养台账.csv', content: exportLedgerCsv().content },
  ]

  const readme = [
    `入廊费与服务费结算批次另存包`,
    `计费周期：${period}（${periodLabel(period)}）`,
    `打包时间：${nowStamp()}`,
    ``,
    `1. 结算单费用明细-${period}.csv：本周期有效版结算单（重复出账只保留最后一版，作废旧版不叠加）。`,
    `2. 对账核对结果-${period}.csv：对账回函逐行核对结果；匹配不上的行已单列原因，不影响其余行入账。`,
    `3. 欠费管线复核清单-${period}.csv：欠费牵动的入廊管线复核项，管线责任人在「欠费管线复核」入口处理，结论落到保养台账。`,
    `4. 入廊设施保养台账.csv：与保养台账入口同源，既有项照原编号，早年未登记项编号 BY-NEW- 另起一行。`,
    ``,
    `口径裁决：`,
    `一、早年口头约定入廊无书面合同的，补录为事实合同（编号 HT-BL-），按双方确认的实际占用日回填，标「待补签」，补签前正常出账、欠费照挂。理由：费用不因手续缺失灭失，先挂账可避免漏收，待补签后按正式合同多退少补、可追溯。`,
    `二、同合同同周期重复出账以最后生成的一版为准，旧版标作废、金额不叠加。理由：对同一债务重复计费会虚增应收，按「后行为覆盖先行为」最贴近实际交易。`,
    `三、现场实测与台账/申报两路取值不一致时，保留现场实测版，下次保养日等以本次保养日按保养周期回算，旧版留痕。理由：实测反映真实状态，台账值可能滞后或填报失真；回算保证两入口的保养排期一致。`,
    `四、存量数据按原编号迁入；早年没登记的一律另起新行并注明原因，不占用既有号段。理由：原编号延续可保住历史引用关系，新号段隔离避免与存量台账串号。`,
    `五、写操作按班组归属拦截：结算归收费结算班组、复核归管线巡查班、保养台账归机电维修班，其他入口只读，越权改动一律驳回。`,
  ].join('\n')
  entries.push({ filename: '批次说明与裁决口径.txt', content: readme })

  downloadBlob(`入廊结算批次-${period}-${stamp}.zip`, buildZip(entries))
  return { ok: true, message: `批次已打包另存：${period}，含 ${entries.length} 个文件（结算明细/对账结果/复核清单/保养台账/裁决说明）` }
}

export function resetFeeLedger(): { ok: boolean; message: string } {
  resetFeeState()
  return { ok: true, message: '结算专项数据已恢复为播种数据' }
}

export { billReceivable, billDiff, money }
