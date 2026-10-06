import {
  SEED_ARREARS,
  SEED_CONTRACTS,
  SEED_IMPORT_BATCHES,
  SEED_MAINTENANCE_LEDGER,
  SEED_PENDING_UNITS,
  SEED_PIPELINE_REVIEWS,
  SEED_STATEMENTS,
} from './fee-seed'
import type {
  ArrearsRecord,
  BillingStatement,
  ImportBatch,
  MaintenanceLedgerItem,
  PendingSupplementUnit,
  PipelineReviewItem,
  ServiceContract,
} from './fee-types'

// 结算域单独存一份 localStorage，键与通用台账隔离。
const STORE_KEY = 'urban-utility-tunnel:fee-ledger'

interface FeeStoreShape {
  contracts: ServiceContract[]
  pendingUnits: PendingSupplementUnit[]
  statements: BillingStatement[]
  arrears: ArrearsRecord[]
  pipelineReviews: PipelineReviewItem[]
  maintenance: MaintenanceLedgerItem[]
  batches: ImportBatch[]
  seq: Record<string, number>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seed(): FeeStoreShape {
  return {
    contracts: clone(SEED_CONTRACTS),
    pendingUnits: clone(SEED_PENDING_UNITS),
    statements: clone(SEED_STATEMENTS),
    arrears: clone(SEED_ARREARS),
    pipelineReviews: clone(SEED_PIPELINE_REVIEWS),
    maintenance: clone(SEED_MAINTENANCE_LEDGER),
    batches: clone(SEED_IMPORT_BATCHES),
    seq: {
      contracts: 5,
      pendingUnits: 2,
      statements: 4,
      arrears: 1,
      pipelineReviews: 1,
      maintenance: 3,
      batches: 1,
      feeItems: 7,
    },
  }
}

function read(): FeeStoreShape {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seed()
  }
  const raw = window.localStorage.getItem(STORE_KEY)
  if (!raw) {
    const fallback = seed()
    window.localStorage.setItem(STORE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as FeeStoreShape
  } catch {
    const fallback = seed()
    window.localStorage.setItem(STORE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: FeeStoreShape | null = null

function store(): FeeStoreShape {
  if (cache === null) {
    cache = read()
  }
  return cache
}

function persist() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store()))
  }
}

export function nextId(kind: keyof FeeStoreShape['seq']): number {
  const seq = store().seq
  seq[kind] = (seq[kind] ?? 0) + 1
  persist()
  return seq[kind]
}

export function resetFeeStore(): FeeStoreShape {
  cache = seed()
  persist()
  return cache
}

// ---------- 合同 ----------
export function listContracts(): ServiceContract[] {
  return store().contracts
}

export function saveContract(row: ServiceContract): void {
  const data = store()
  const index = data.contracts.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.contracts[index] = row
  } else {
    data.contracts.push(row)
  }
  persist()
}

export function findContractByNo(contractNo: string): ServiceContract | undefined {
  return store().contracts.find(
    (item) => item.contractNo.trim() === contractNo.trim(),
  )
}

// ---------- 待补签权属单位 ----------
export function listPendingUnits(): PendingSupplementUnit[] {
  return store().pendingUnits
}

export function savePendingUnit(row: PendingSupplementUnit): void {
  const data = store()
  const index = data.pendingUnits.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.pendingUnits[index] = row
  } else {
    data.pendingUnits.push(row)
  }
  persist()
}

// ---------- 结算单 ----------
export function listStatements(): BillingStatement[] {
  return store().statements
}

export function findStatement(id: number): BillingStatement | undefined {
  return store().statements.find((item) => item.id === id)
}

export function saveStatement(row: BillingStatement): void {
  const data = store()
  const index = data.statements.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.statements[index] = row
  } else {
    data.statements.push(row)
  }
  persist()
}

/**
 * 同一合同 + 同一计费周期只认最后一版：
 * 重新出账时把同键的旧版全部置为 superseded，新版本号 +1。
 */
export function supersedeSameKey(contractNo: string, period: string): number {
  const data = store()
  let maxVersion = 0
  for (const item of data.statements) {
    if (item.contractNo === contractNo && item.period === period) {
      maxVersion = Math.max(maxVersion, item.version)
      item.superseded = true
      item.status = '待对账'
      item.confirmedAmount = null
      item.reconcileNote = `已被 v${maxVersion + 1} 取代，旧版不叠加、不入账。`
    }
  }
  persist()
  return maxVersion + 1
}

/** 当前生效（未被取代）的结算单，列表与统计都只看这里。 */
export function activeStatements(): BillingStatement[] {
  return store().statements.filter((item) => !item.superseded)
}

// ---------- 欠费 ----------
export function listArrears(): ArrearsRecord[] {
  return store().arrears
}

export function saveArrears(row: ArrearsRecord): void {
  const data = store()
  const index = data.arrears.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.arrears[index] = row
  } else {
    data.arrears.push(row)
  }
  persist()
}

// ---------- 管线复核清单 ----------
export function listPipelineReviews(): PipelineReviewItem[] {
  return store().pipelineReviews
}

export function savePipelineReview(row: PipelineReviewItem): void {
  const data = store()
  const index = data.pipelineReviews.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.pipelineReviews[index] = row
  } else {
    data.pipelineReviews.push(row)
  }
  persist()
}

// ---------- 保养台账 ----------
export function listMaintenance(): MaintenanceLedgerItem[] {
  return store().maintenance
}

export function saveMaintenance(row: MaintenanceLedgerItem): void {
  const data = store()
  const index = data.maintenance.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.maintenance[index] = row
  } else {
    data.maintenance.push(row)
  }
  persist()
}

export function findMaintenanceByRef(refNo: string): MaintenanceLedgerItem | undefined {
  return store().maintenance.find((item) => item.refNo === refNo)
}

// ---------- 外部文件批次 ----------
export function listBatches(): ImportBatch[] {
  return store().batches
}

export function saveBatch(row: ImportBatch): void {
  const data = store()
  const index = data.batches.findIndex((item) => item.id === row.id)
  if (index >= 0) {
    data.batches[index] = row
  } else {
    data.batches.push(row)
  }
  persist()
}
