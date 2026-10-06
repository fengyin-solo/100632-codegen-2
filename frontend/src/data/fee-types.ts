/**
 * 入廊费 / 服务费结算域的类型定义。
 * 与通用台账（EntryRow）分开存：结算账有合同、版本、对账、欠费这些概念，
 * 直接套通用行结构会把业务规则埋进页面里，所以单独建一层。
 */

/** 合同补录性质：存量合同按签订日期回填；早年口头约定无书面合同的，补签后登记为补签。 */
export type ContractKind = '书面合同' | '补签合同'

export type ContractStatus = '履行中' | '已终止'

/** 入廊服务合同：一家权属单位在一个计费周期内出账的依据。 */
export interface ServiceContract {
  id: number
  /** 合同编号，出账与对账都靠它匹配，全局唯一 */
  contractNo: string
  /** 管线权属单位 */
  owner: string
  /** 对接联系人 */
  contact: string
  /** 签订日期（ISO 日期） */
  signDate: string
  kind: ContractKind
  status: ContractStatus
  /** 入廊费：按占用长度一次性/周期性计收的基准 */
  entryFeeRate: number
  /** 服务费：按计费周期计收的基准 */
  serviceFeeRate: number
  /** 计费口径说明，例如「元/米·次」「元/季」 */
  feeBasis: string
  /** 占用管廊长度（米），入廊费 = 长度 × 单价 */
  occupiedLength: number
  /** 早年口头约定时的说明；书面合同留空 */
  legacyNote: string
  /** 责任班组（权限归属，只有本班组能提交写操作） */
  ownerTeam: string
}

export type FeeKind = '入廊费' | '服务费'

/** 结算单内的一行费用明细。 */
export interface FeeItem {
  id: number
  kind: FeeKind
  /** 费用项名称，例如「2026年三季度入廊费」 */
  name: string
  /** 计费量（长度或周期数） */
  quantity: number
  /** 单价 */
  unitPrice: number
  /** 应收金额 = quantity × unitPrice */
  amount: number
  remark: string
}

export type BillingStatus = '待对账' | '对账通过' | '有差异' | '已结清'

/**
 * 结算单：同一合同 + 同一计费周期只认最后生成的一版。
 * version 从 1 起递增，旧版 superseded=true 不参与入账、不叠加金额。
 */
export interface BillingStatement {
  id: number
  /** 结算单编号 */
  statementNo: string
  contractId: number
  contractNo: string
  owner: string
  /** 计费周期，例如 2026Q3 */
  period: string
  /** 周期开始/结束日 */
  periodStart: string
  periodEnd: string
  version: number
  superseded: boolean
  status: BillingStatus
  items: FeeItem[]
  /** 应收合计（以本版明细为准） */
  totalAmount: number
  /** 对方回传认可的合计，未导入对账文件时为 null */
  confirmedAmount: number | null
  generatedAt: string
  generatedBy: string
  /** 最近一次对账说明（含差异摘要） */
  reconcileNote: string
  /** 是否已挂欠费 */
  arrearsFlagged: boolean
  ownerTeam: string
}

/** 对账文件逐行核对后的匹配结果。 */
export type ReconcileMatch = '匹配一致' | '金额有差异' | '匹配不上'

export interface ReconcileLine {
  rowNo: number
  contractNo: string
  period: string
  /** 对方回传认可金额 */
  confirmedAmount: number | null
  match: ReconcileMatch
  /** 匹配不上或有差异时的逐行原因 */
  reason: string
  /** 匹配到的结算单编号（匹配不上为空） */
  statementNo: string
  billedAmount: number | null
}

/** 欠费记录：对不上账的结算单挂欠费。 */
export interface ArrearsRecord {
  id: number
  statementId: number
  statementNo: string
  contractNo: string
  owner: string
  period: string
  /** 欠费金额 = 应收 - 对方认可（对方未认可时按应收全额挂） */
  amount: number
  /** 牵动到的入廊管线复核清单（按权属单位聚合的管线编号） */
  pipelineRefs: string[]
  status: '欠费中' | '已核销'
  flaggedAt: string
  clearedAt: string | null
  reason: string
  ownerTeam: string
}

/** 入廊管线复核清单项：欠费单位的管线进这里，给管线责任人看。 */
export interface PipelineReviewItem {
  id: number
  pipelineNo: string
  owner: string
  cabin: string
  pipelineType: string
  responsible: string
  status: '待复核' | '复核通过'
  sourceStatementNo: string
  arrearsAmount: number
  reason: string
  ownerTeam: string
}

/** 保养台账条目：结算结论要落到这里，两边登记对齐。 */
export interface MaintenanceLedgerItem {
  id: number
  /** 既有台账照原编号搬过来；早年没登记的另起新编号 */
  refNo: string
  pipelineNo: string
  owner: string
  /** 保养内容/对象 */
  subject: string
  /** 台账侧（既有登记）取值 */
  ledgerValue: number | null
  /** 现场实测取值 */
  measuredValue: number | null
  /** 最终采用值：两路取值不同时按现场实测统一，其余照它回算 */
  adoptedValue: number | null
  unit: string
  /** 取值依据说明，以及两版取舍理由 */
  adoptReason: string
  /** 是否为早年没登记、另起一行补录的项 */
  isBackfilled: boolean
  /** 关联结算单（结论落到保养台账的出处） */
  sourceStatementNo: string
  status: '待保养' | '已保养'
  ownerTeam: string
}

/** 外部文件处理结果：先导进来，处理完再打包另存。 */
export interface ImportBatch {
  id: number
  fileName: string
  kind: string
  importedAt: string
  importedBy: string
  /** 原始文件解析出的行（已脱敏/规整为对象数组） */
  rows: Record<string, string>[]
  /** 处理结论摘要 */
  summary: string
  /** 处理完另存的打包文件名 */
  packageName: string | null
  status: '已导入待处理' | '已处理已打包'
  ownerTeam: string
}

/** 提交动作的鉴权结果。 */
export interface AuthResult {
  ok: boolean
  message: string
}

/**
 * 早年按口头约定入廊、没有书面合同、也尚未补签的权属单位。
 * 裁决：不出账、不挂应收，先在此挂账，补签书面合同（登记为「补签合同」）后再回填出账。
 */
export interface PendingSupplementUnit {
  id: number
  owner: string
  contact: string
  /** 当年口头约定入廊的日期 */
  oralEntryDate: string
  occupiedLength: number
  note: string
  status: '待补签' | '已补签'
  ownerTeam: string
}
