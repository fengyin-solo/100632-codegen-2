import { parseAmount, parseCsv, toCsv } from './csv'
import { buildZip, downloadBlob } from './zip'
import type { ZipEntry } from './zip'
import { PIPELINE_ROSTER } from '@/data/fee-seed'
import {
  findContractByNo,
  findStatement,
  listArrears,
  listBatches,
  listContracts,
  listMaintenance,
  listPendingUnits,
  listPipelineReviews,
  listStatements,
  nextId,
  saveArrears,
  saveBatch,
  saveContract,
  saveMaintenance,
  savePendingUnit,
  savePipelineReview,
  saveStatement,
  supersedeSameKey,
} from '@/data/fee-store'
import type {
  ArrearsRecord,
  BillingStatement,
  FeeItem,
  ImportBatch,
  MaintenanceLedgerItem,
  ReconcileLine,
  ServiceContract,
} from '@/data/fee-types'

// ================= 出账 =================

export interface GenerateBillingInput {
  contractId: number
  period: string
  periodStart: string
  periodEnd: string
  operator: string
  /** 本周期入廊费是否计列（入廊费通常一次性，但按合同约定也可按周期续计） */
  includeEntryFee: boolean
}

/**
 * 按入廊服务合同 + 计费周期出账。
 * 同一合同同一周期重复出账：旧版置为 superseded，只认最后一版，金额不叠加。
 */
export function generateStatement(input: GenerateBillingInput): BillingStatement {
  const contract = listContracts().find((item) => item.id === input.contractId)
  if (!contract) {
    throw new Error('没有找到对应的入廊服务合同，无法出账')
  }
  if (contract.status !== '履行中') {
    throw new Error(`合同 ${contract.contractNo} 已终止，不能出账`)
  }

  const version = supersedeSameKey(contract.contractNo, input.period)
  const items: FeeItem[] = []
  if (input.includeEntryFee) {
    items.push({
      id: nextId('feeItems'),
      kind: '入廊费',
      name: `${input.period} 入廊费（占用 ${contract.occupiedLength} 米）`,
      quantity: contract.occupiedLength,
      unitPrice: contract.entryFeeRate,
      amount: round2(contract.occupiedLength * contract.entryFeeRate),
      remark: '按合同单价计列',
    })
  }
  items.push({
    id: nextId('feeItems'),
    kind: '服务费',
    name: `${input.period} 日常运维服务费`,
    quantity: 1,
    unitPrice: contract.serviceFeeRate,
    amount: round2(contract.serviceFeeRate),
    remark: '周期服务费',
  })

  const statement: BillingStatement = {
    id: nextId('statements'),
    statementNo: `JS-${input.period}-${contract.contractNo}${version > 1 ? `-v${version}` : ''}`,
    contractId: contract.id,
    contractNo: contract.contractNo,
    owner: contract.owner,
    period: input.period,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    version,
    superseded: false,
    status: '待对账',
    items,
    totalAmount: round2(items.reduce((sum, item) => sum + item.amount, 0)),
    confirmedAmount: null,
    generatedAt: nowText(),
    generatedBy: input.operator,
    reconcileNote: version > 1 ? `重复出账，本版为 v${version}，旧版已作废不叠加。` : '',
    arrearsFlagged: false,
    ownerTeam: contract.ownerTeam,
  }
  saveStatement(statement)
  return statement
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// ================= 导出 / 导入对账文件 =================

/** 导出结算单费用明细为 CSV，交给权属单位对账。 */
export function exportStatementCsv(statement: BillingStatement): { filename: string; content: string } {
  const rows: Record<string, unknown>[] = statement.items.map((item) => ({
    结算单编号: statement.statementNo,
    合同编号: statement.contractNo,
    计费周期: statement.period,
    权属单位: statement.owner,
    费用类别: item.kind,
    费用名称: item.name,
    计费量: item.quantity,
    单价: item.unitPrice,
    金额: item.amount,
    备注: item.remark,
  }))
  const header = ['结算单编号', '合同编号', '计费周期', '权属单位', '费用类别', '费用名称', '计费量', '单价', '金额', '备注']
  return {
    filename: `${statement.statementNo}-费用明细.csv`,
    content: toCsv(header, rows),
  }
}

export interface ReconcileResult {
  lines: ReconcileLine[]
  /** 实际入账（匹配到生效结算单）的行数 */
  bookedCount: number
  unmatchedCount: number
  diffCount: number
}

/**
 * 导入对方回传的对账文件，按「合同编号 + 计费周期」逐行核对。
 * 匹配不上的行单列原因，其余照常入账（回写 confirmedAmount、状态）。
 * 旧版结算单不作为入账目标，避免对到作废版本。
 */
export function importReconcileFile(text: string): ReconcileResult {
  const records = parseCsv(text)
  const lines: ReconcileLine[] = []
  let bookedCount = 0
  let unmatchedCount = 0
  let diffCount = 0

  records.forEach((record, index) => {
    const rowNo = index + 2 // CSV 里第 1 行是表头
    const contractNo = record['合同编号'] ?? ''
    const period = record['计费周期'] ?? ''
    const confirmed = parseAmount(record['对方认可金额'] ?? record['认可金额'])

    const base: ReconcileLine = {
      rowNo,
      contractNo,
      period,
      confirmedAmount: confirmed,
      match: '匹配不上',
      reason: '',
      statementNo: '',
      billedAmount: null,
    }

    if (!contractNo || !period) {
      base.reason = '合同编号或计费周期为空，无法按「合同编号 + 计费周期」匹配'
      unmatchedCount += 1
      lines.push(base)
      return
    }

    const contract = findContractByNo(contractNo)
    if (!contract) {
      base.reason = `合同编号 ${contractNo} 在入廊服务合同台账中不存在`
      unmatchedCount += 1
      lines.push(base)
      return
    }

    const target = listStatements().find(
      (item) =>
        !item.superseded &&
        item.contractNo === contractNo &&
        item.period === period,
    )
    if (!target) {
      const oldVersion = listStatements().find(
        (item) => item.contractNo === contractNo && item.period === period,
      )
      base.reason = oldVersion
        ? `计费周期 ${period} 的结算单已有新版（v${oldVersion.version} 已作废），请按最新版本回传`
        : `合同 ${contractNo} 在 ${period} 没有生效结算单（尚未出账）`
      unmatchedCount += 1
      lines.push(base)
      return
    }

    base.statementNo = target.statementNo
    base.billedAmount = target.totalAmount
    if (confirmed === null) {
      base.match = '匹配不上'
      base.reason = '对方认可金额为空或不是数字，无法核对'
      unmatchedCount += 1
      lines.push(base)
      return
    }

    if (Math.abs(confirmed - target.totalAmount) < 0.01) {
      base.match = '匹配一致'
      base.reason = '应收与对方认可一致'
      applyReconcile(target, confirmed, '对账通过', '对方回传对账一致。')
      bookedCount += 1
    } else {
      base.match = '金额有差异'
      const gap = round2(target.totalAmount - confirmed)
      base.reason = `应收 ${target.totalAmount} 元，对方认可 ${confirmed} 元，差异 ${gap} 元（应收−认可）`
      applyReconcile(
        target,
        confirmed,
        '有差异',
        `对方回传认可 ${confirmed} 元，与应收 ${target.totalAmount} 元相差 ${gap} 元，待挂欠费。`,
      )
      bookedCount += 1
      diffCount += 1
    }
    lines.push(base)
  })

  return { lines, bookedCount, unmatchedCount, diffCount }
}

function applyReconcile(
  target: BillingStatement,
  confirmed: number,
  status: BillingStatement['status'],
  note: string,
): void {
  const latest = findStatement(target.id)
  if (!latest || latest.superseded) return
  latest.confirmedAmount = confirmed
  latest.status = status
  latest.reconcileNote = note
  saveStatement(latest)
}

/** 对账结果（含匹配不上原因）导出，供另存/留档。 */
export function reconcileResultCsv(result: ReconcileResult): string {
  const rows = result.lines.map((line) => ({
    文件行号: line.rowNo,
    合同编号: line.contractNo,
    计费周期: line.period,
    结算单编号: line.statementNo,
    应收金额: line.billedAmount ?? '',
    对方认可金额: line.confirmedAmount ?? '',
    核对结果: line.match,
    原因说明: line.reason,
  }))
  return toCsv(
    ['文件行号', '合同编号', '计费周期', '结算单编号', '应收金额', '对方认可金额', '核对结果', '原因说明'],
    rows,
  )
}

// ================= 挂欠费 → 管线复核清单 =================

/**
 * 对不上账（有差异）的结算单挂欠费：
 * 欠费额 = 应收 − 对方认可（未认可时按应收全额挂）。
 * 同时按权属单位把其在廊管线推进「入廊管线复核清单」，让管线责任人在另一入口看到。
 */
export function flagArrears(statementId: number, operator: string): ArrearsRecord {
  const statement = findStatement(statementId)
  if (!statement) throw new Error('结算单不存在')
  if (statement.superseded) throw new Error('该版本已作废，不能挂欠费')
  if (statement.status !== '有差异') {
    throw new Error('只有对账「有差异」的结算单才挂欠费')
  }

  const confirmed = statement.confirmedAmount ?? 0
  const amount = round2(statement.totalAmount - confirmed)
  if (amount <= 0) throw new Error('差异金额不大于 0，无需挂欠费')

  const roster = PIPELINE_ROSTER.filter((line) => line.owner === statement.owner)
  const pipelineRefs = roster.map((line) => line.pipelineNo)

  // 同一结算单重复挂欠：更新既有欠费记录，不重复生成。
  const existing = listArrears().find((item) => item.statementId === statementId && item.status === '欠费中')
  let arrears: ArrearsRecord
  if (existing) {
    existing.amount = amount
    existing.pipelineRefs = pipelineRefs
    existing.reason = statement.reconcileNote
    arrears = existing
  } else {
    arrears = {
      id: nextId('arrears'),
      statementId: statement.id,
      statementNo: statement.statementNo,
      contractNo: statement.contractNo,
      owner: statement.owner,
      period: statement.period,
      amount,
      pipelineRefs,
      status: '欠费中',
      flaggedAt: nowText(),
      clearedAt: null,
      reason: statement.reconcileNote,
      ownerTeam: statement.ownerTeam,
    }
  }
  saveArrears(arrears)

  statement.arrearsFlagged = true
  saveStatement(statement)

  // 牵动入廊管线复核清单：按管线逐条生成（已存在的不重复）。
  for (const line of roster) {
    const duplicated = listPipelineReviews().some(
      (item) => item.sourceStatementNo === statement.statementNo && item.pipelineNo === line.pipelineNo,
    )
    if (duplicated) continue
    savePipelineReview({
      id: nextId('pipelineReviews'),
      pipelineNo: line.pipelineNo,
      owner: line.owner,
      cabin: line.cabin,
      pipelineType: line.pipelineType,
      responsible: line.responsible,
      status: '待复核',
      sourceStatementNo: statement.statementNo,
      arrearsAmount: amount,
      reason: `${statement.owner} ${statement.period} 欠费 ${amount} 元，费用结算挂账联动复核`,
      ownerTeam: '管线运维一班',
    })
  }

  // 同步把欠费结算结论落到保养台账（两边登记对齐）。
  syncArrearsToMaintenance(statement, amount, operator)

  return arrears
}

/** 欠费结清：核销欠费并把对应复核清单解除待复核。 */
export function clearArrears(arrearsId: number): void {
  const arrears = listArrears().find((item) => item.id === arrearsId)
  if (!arrears) throw new Error('欠费记录不存在')
  arrears.status = '已核销'
  arrears.clearedAt = nowText()
  saveArrears(arrears)

  const statement = findStatement(arrears.statementId)
  if (statement) {
    statement.status = '已结清'
    statement.arrearsFlagged = false
    statement.reconcileNote = '欠费已补缴核销，结算单结清。'
    saveStatement(statement)
  }

  for (const review of listPipelineReviews()) {
    if (review.sourceStatementNo === arrears.statementNo && review.status === '待复核') {
      review.status = '复核通过'
      savePipelineReview(review)
    }
  }
}

// ================= 保养台账对齐 =================

/**
 * 把结算结论落到保养台账：按结算单为欠费单位管线补一条保养/复核登记。
 * 既有台账照原编号；这里新增的联动项另起编号并说明出处。
 */
function syncArrearsToMaintenance(statement: BillingStatement, amount: number, operator: string): void {
  const roster = PIPELINE_ROSTER.filter((line) => line.owner === statement.owner)
  roster.forEach((line, index) => {
    const duplicated = listMaintenance().some(
      (item) => item.sourceStatementNo === statement.statementNo && item.pipelineNo === line.pipelineNo,
    )
    if (duplicated) return
    const seq = String(listMaintenance().length + index + 1).padStart(4, '0')
    saveMaintenance({
      id: nextId('maintenance'),
      refNo: `BY-LX-${seq}`,
      pipelineNo: line.pipelineNo,
      owner: line.owner,
      subject: '欠费联动管线保养复核',
      ledgerValue: null,
      measuredValue: null,
      adoptedValue: null,
      unit: '项',
      adoptReason: `结算单 ${statement.statementNo} 挂欠费 ${amount} 元，联动入廊管线复核；以现场复核结果回填，取实测为准。登记人 ${operator}。`,
      isBackfilled: true,
      sourceStatementNo: statement.statementNo,
      status: '待保养',
      ownerTeam: '管线运维一班',
    })
  })
}

export interface MeasureInput {
  refNo: string
  measuredValue: number
  operator: string
}

/**
 * 现场实测回填：两路（台账 vs 实测）取值不同时，按现场实测统一，其余照它回算。
 * 既有台账按原编号更新；早年没登记的项在别处另起一行。
 */
export function adoptMeasuredValue(input: MeasureInput): MaintenanceLedgerItem {
  const item = listMaintenance().find((row) => row.refNo === input.refNo)
  if (!item) throw new Error(`保养台账没有编号 ${input.refNo} 的记录`)
  const ledger = item.ledgerValue
  item.measuredValue = input.measuredValue
  item.adoptedValue = input.measuredValue
  if (ledger === null) {
    item.adoptReason = `原台账无登记值，按现场实测 ${input.measuredValue} ${item.unit} 统一取值并回算。回填人 ${input.operator}。`
  } else if (Math.abs(ledger - input.measuredValue) < 1e-9) {
    item.adoptReason = `台账值与现场实测一致（${ledger} ${item.unit}），维持原取值。核对人 ${input.operator}。`
  } else {
    item.adoptReason = `台账 ${ledger} ${item.unit} 与现场实测 ${input.measuredValue} ${item.unit} 不一致，按现场实测统一，台账照实测回算。回填人 ${input.operator}。`
  }
  item.status = '已保养'
  saveMaintenance(item)
  return item
}

// ================= 早年口头约定：补签裁决 =================

export interface SupplementInput {
  pendingId: number
  contractNo: string
  signDate: string
  entryFeeRate: number
  serviceFeeRate: number
  operator: string
}

/**
 * 裁决补录方式：早年口头约定、没有书面合同的，不替它造历史应收，
 * 先在「待补签」挂账；权属单位补签书面合同后，登记为「补签合同」，
 * 自补签日期所在周期起正常出账（补签前不追挂）。
 */
export function supplementContract(input: SupplementInput): ServiceContract {
  const pending = listPendingUnits().find((item) => item.id === input.pendingId && item.status === '待补签')
  if (!pending) throw new Error('没有待补签的权属单位')
  if (findContractByNo(input.contractNo)) {
    throw new Error(`合同编号 ${input.contractNo} 已存在，不能重复登记`)
  }

  const contract: ServiceContract = {
    id: nextId('contracts'),
    contractNo: input.contractNo,
    owner: pending.owner,
    contact: pending.contact,
    signDate: input.signDate,
    kind: '补签合同',
    status: '履行中',
    entryFeeRate: input.entryFeeRate,
    serviceFeeRate: input.serviceFeeRate,
    feeBasis: '入廊费 元/米；服务费 元/季',
    occupiedLength: pending.occupiedLength,
    legacyNote: `原口头约定入廊日 ${pending.oralEntryDate}，${input.signDate} 补签；补签前不追挂应收，自补签周期起出账。经办人 ${input.operator}。`,
    ownerTeam: '廊位费结算班',
  }
  saveContract(contract)

  pending.status = '已补签'
  pending.note = `已于 ${input.signDate} 补签合同 ${input.contractNo}，转正常出账。`
  savePendingUnit(pending)
  return contract
}

// ================= 外部文件批次：先导进来，处理完打包另存 =================

export interface ImportedFile {
  fileName: string
  text: string
  kind: string
  team: string
  operator: string
}

/** 登记一个已导入、待处理的外部文件批次。 */
export function stageImport(file: ImportedFile): ImportBatch {
  const records = parseCsv(file.text)
  const batch: ImportBatch = {
    id: nextId('batches'),
    fileName: file.fileName,
    kind: file.kind,
    importedAt: nowText(),
    importedBy: file.operator,
    rows: records,
    summary: `已解析 ${records.length} 行，待处理。`,
    packageName: null,
    status: '已导入待处理',
    ownerTeam: file.team,
  }
  saveBatch(batch)
  return batch
}

/**
 * 现场实测回传表批量处理：按「管线编号」匹配保养台账条目，
 * 台账值与实测不同时按实测统一并回算；匹配不上的行单独列原因，不写入。
 * 约定列：编号（原/新编号）或 管线编号、现场实测、单位（可选）。
 */
export interface MeasureResult {
  total: number
  applied: number
  appliedRefs: string[]
  unmatched: { rowNo: number; pipelineNo: string; reason: string }[]
}

export function importMeasureFile(text: string, operator: string): MeasureResult {
  const records = parseCsv(text)
  const result: MeasureResult = { total: records.length, applied: 0, appliedRefs: [], unmatched: [] }

  records.forEach((record, index) => {
    const rowNo = index + 2
    const refNo = record['编号'] ?? record['原/新编号'] ?? ''
    const pipelineNo = record['管线编号'] ?? ''
    const measured = parseAmount(record['现场实测'] ?? record['实测值'])

    const ledger = listMaintenance()
    const target =
      ledger.find((row) => row.refNo === refNo.trim()) ??
      ledger.find((row) => row.pipelineNo === pipelineNo.trim())

    if (!target) {
      result.unmatched.push({
        rowNo,
        pipelineNo: pipelineNo || refNo,
        reason: `管线编号/编号 ${pipelineNo || refNo} 在保养台账中不存在，另起一行请在保养台账页补录`,
      })
      return
    }
    if (measured === null) {
      result.unmatched.push({ rowNo, pipelineNo: target.pipelineNo, reason: '现场实测值为空或不是数字' })
      return
    }
    adoptMeasuredValue({ refNo: target.refNo, measuredValue: measured, operator })
    result.applied += 1
    result.appliedRefs.push(target.refNo)
  })

  return result
}

function measureResultCsv(result: MeasureResult): string {
  const appliedRows = listMaintenance()
    .filter((item) => result.appliedRefs.includes(item.refNo))
    .map((item) => ({
      编号: item.refNo,
      管线编号: item.pipelineNo,
      台账值: item.ledgerValue ?? '',
      现场实测: item.measuredValue ?? '',
      最终采用: item.adoptedValue ?? '',
      单位: item.unit,
      取值依据: item.adoptReason,
    }))
  const unmatchedRows = result.unmatched.map((line) => ({
    文件行号: line.rowNo,
    管线编号: line.pipelineNo,
    核对结果: '匹配不上',
    原因说明: line.reason,
  }))
  return (
    toCsv(['编号', '管线编号', '台账值', '现场实测', '最终采用', '单位', '取值依据'], appliedRows) +
    '\n\n匹配不上明细\n' +
    toCsv(['文件行号', '管线编号', '核对结果', '原因说明'], unmatchedRows)
  )
}

/**
 * 处理已导入的外部文件批次并打包另存。
 * 对账文件 → 逐行核对入账；现场实测表 → 按管线匹配、按实测统一取值。
 * 处理完成统一把「原始文件 + 结果 + 入账/取值清单 + 说明」打成 zip。
 */
export function processAndPack(batchId: number): { packageName: string; result: ReconcileResult | MeasureResult } {
  // 批次里存的是规整后的对象，这里重新拼回 CSV 文本走统一核对逻辑。
  const batch = listBatches().find((item) => item.id === batchId)
  if (!batch) throw new Error('导入批次不存在')
  if (batch.status === '已处理已打包') throw new Error('该批次已处理并打包，勿重复处理')

  const text = toCsv(
    batch.rows.length ? Object.keys(batch.rows[0]) : [],
    batch.rows as unknown as Record<string, unknown>[],
  )

  const stamp = batchId
  const packageName =
    batch.kind === '现场实测回传表'
      ? `实测批次-${stamp}-处理结果.zip`
      : `对账批次-${stamp}-处理结果.zip`

  let result: ReconcileResult | MeasureResult
  let entries: ZipEntry[]
  if (batch.kind === '现场实测回传表') {
    const measureResult = importMeasureFile(text, batch.importedBy)
    result = measureResult
    entries = [
      { name: `01-原始文件-${batch.fileName}`, content: text },
      { name: '02-实测取值结果.csv', content: measureResultCsv(measureResult) },
      { name: '03-处理说明.txt', content: measureNote(batch, measureResult) },
    ]
    batch.summary = `实测回填 ${measureResult.applied} 行，匹配不上 ${measureResult.unmatched.length} 行；已打包另存 ${packageName}。`
  } else {
    const reconcileResult = importReconcileFile(text)
    result = reconcileResult
    entries = [
      { name: `01-原始文件-${batch.fileName}`, content: text },
      { name: '02-逐行核对结果.csv', content: reconcileResultCsv(reconcileResult) },
      { name: '03-入账结算单.csv', content: bookedStatementsCsv(reconcileResult) },
      { name: '04-处理说明.txt', content: processingNote(batch, reconcileResult) },
    ]
    batch.summary = `入账 ${reconcileResult.bookedCount} 行，差异 ${reconcileResult.diffCount} 行，匹配不上 ${reconcileResult.unmatchedCount} 行；已打包另存 ${packageName}。`
  }

  const blob = buildZip(entries)
  downloadBlob(blob, packageName)

  batch.packageName = packageName
  batch.status = '已处理已打包'
  saveBatch(batch)

  return { packageName, result }
}

function bookedStatementsCsv(result: ReconcileResult): string {
  const rows = result.lines
    .filter((line) => line.statementNo)
    .map((line) => ({
      结算单编号: line.statementNo,
      合同编号: line.contractNo,
      计费周期: line.period,
      应收金额: line.billedAmount ?? '',
      对方认可金额: line.confirmedAmount ?? '',
      核对结果: line.match,
    }))
  return toCsv(['结算单编号', '合同编号', '计费周期', '应收金额', '对方认可金额', '核对结果'], rows)
}

function processingNote(batch: ImportBatch, result: ReconcileResult): string {
  return [
    `外部文件处理说明`,
    `源文件：${batch.fileName}`,
    `导入时间：${batch.importedAt}`,
    `处理时间：${nowText()}`,
    `总行数：${batch.rows.length}`,
    `正常入账：${result.bookedCount} 行（其中金额一致 ${result.bookedCount - result.diffCount} 行，有差异 ${result.diffCount} 行）`,
    `匹配不上：${result.unmatchedCount} 行（已逐行列原因，未入账）`,
    ``,
    `口径：按合同编号 + 计费周期匹配；同一周期重复出账只认最后一版，旧版不叠加；`,
    `有差异的结算单需在费用结算入口挂欠费，欠费会联动入廊管线复核清单与保养台账。`,
  ].join('\n')
}

function measureNote(batch: ImportBatch, result: MeasureResult): string {
  const lines = [
    '现场实测文件处理说明',
    `源文件：${batch.fileName}`,
    `导入时间：${batch.importedAt}`,
    `处理时间：${nowText()}`,
    `总行数：${result.total}`,
    `按实测取值：${result.applied} 行`,
    `匹配不上：${result.unmatched.length} 行（已逐行列原因，未写入）`,
    '',
    '取值口径：台账值与现场实测不一致时，保留现场实测版，台账值留痕，最终采用值与下游照实测回算；',
    '早年没登记的项在保养台账另起一行（BY-LX- 前缀），不伪造历史编号。',
  ]
  for (const u of result.unmatched) {
    lines.push(`  · 第 ${u.rowNo} 行 ${u.pipelineNo}：${u.reason}`)
  }
  return lines.join('\n')
}

function nowText(): string {
  const d = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ================= 统计（列表数字与详情取同一份数据） =================

export function billingStats() {
  const active = listStatements().filter((item) => !item.superseded)
  const arrears = listArrears().filter((item) => item.status === '欠费中')
  return {
    total: active.length,
    pending: active.filter((item) => item.status === '待对账').length,
    diff: active.filter((item) => item.status === '有差异').length,
    settled: active.filter((item) => item.status === '已结清' || item.status === '对账通过').length,
    arrearsAmount: round2(arrears.reduce((sum, item) => sum + item.amount, 0)),
    arrearsCount: arrears.length,
    receivable: round2(active.reduce((sum, item) => sum + item.totalAmount, 0)),
  }
}
