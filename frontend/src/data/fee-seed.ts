import type {
  ArrearsRecord,
  BillingStatement,
  ImportBatch,
  MaintenanceLedgerItem,
  PendingSupplementUnit,
  PipelineReviewItem,
  ServiceContract,
} from './fee-types'

/**
 * 结算域示例数据（首次打开播种，之后 localStorage 优先）。
 * 费用班组为「廊位费结算班」，管线/保养入口的责任班组为「管线运维一班」，
 * 用来演示「不是本责任班组的提交一律拒绝、其他人的入口只读」。
 */
export const FEE_TEAM = '廊位费结算班'
export const PIPELINE_TEAM = '管线运维一班'
export const OTHER_TEAM = '巡检班'

export const SEED_CONTRACTS: ServiceContract[] = [
  {
    id: 1,
    contractNo: 'HT-RL-2021-007',
    owner: '城燃燃气集团',
    contact: '周慕云',
    signDate: '2021-05-18',
    kind: '书面合同',
    status: '履行中',
    entryFeeRate: 120,
    serviceFeeRate: 9600,
    feeBasis: '入廊费 元/米；服务费 元/季',
    occupiedLength: 1800,
    legacyNote: '',
    ownerTeam: FEE_TEAM,
  },
  {
    id: 2,
    contractNo: 'HT-SD-2019-003',
    owner: '市供水公司',
    contact: '梁志远',
    signDate: '2019-03-02',
    kind: '书面合同',
    status: '履行中',
    entryFeeRate: 110,
    serviceFeeRate: 8400,
    feeBasis: '入廊费 元/米；服务费 元/季',
    occupiedLength: 2200,
    legacyNote: '',
    ownerTeam: FEE_TEAM,
  },
  {
    id: 3,
    contractNo: 'HT-GD-2017-011',
    owner: '广电网络公司',
    contact: '白素琴',
    signDate: '2017-09-21',
    kind: '书面合同',
    status: '履行中',
    entryFeeRate: 90,
    serviceFeeRate: 6000,
    feeBasis: '入廊费 元/米；服务费 元/季',
    occupiedLength: 1600,
    legacyNote: '存量合同，按签订日期回填历史计费周期。',
    ownerTeam: FEE_TEAM,
  },
  {
    id: 4,
    contractNo: 'HT-LD-2026-002',
    owner: '绿电热力公司',
    contact: '高志航',
    signDate: '2026-01-15',
    kind: '补签合同',
    status: '履行中',
    entryFeeRate: 100,
    serviceFeeRate: 7200,
    feeBasis: '入廊费 元/米；服务费 元/季',
    occupiedLength: 1300,
    legacyNote: '早年口头约定入廊，2026-01 补签书面合同；补签前不追挂应收，自补签周期起出账。',
    ownerTeam: FEE_TEAM,
  },
]

export const SEED_PENDING_UNITS: PendingSupplementUnit[] = [
  {
    id: 1,
    owner: '恒通弱电公司',
    contact: '秦若兰',
    oralEntryDate: '2016-06-10',
    occupiedLength: 900,
    note: '当年口头约定入廊，无书面合同、未补签；暂不出账，补签后按补签合同回填。',
    status: '待补签',
    ownerTeam: FEE_TEAM,
  },
]

export const SEED_STATEMENTS: BillingStatement[] = [
  {
    id: 1,
    statementNo: 'JS-2026Q3-HT-RL-2021-007',
    contractId: 1,
    contractNo: 'HT-RL-2021-007',
    owner: '城燃燃气集团',
    period: '2026Q3',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    version: 1,
    superseded: false,
    status: '已结清',
    items: [
      { id: 1, kind: '入廊费', name: '2026Q3 入廊费（占用 1800 米）', quantity: 1800, unitPrice: 120, amount: 216000, remark: '按合同单价计列' },
      { id: 2, kind: '服务费', name: '2026Q3 日常运维服务费', quantity: 1, unitPrice: 9600, amount: 9600, remark: '季度服务费' },
    ],
    totalAmount: 225600,
    confirmedAmount: 225600,
    generatedAt: '2026-07-01 09:20',
    generatedBy: '值班管理员',
    reconcileNote: '对方回传对账一致，已结清。',
    arrearsFlagged: false,
    ownerTeam: FEE_TEAM,
  },
  {
    id: 2,
    statementNo: 'JS-2026Q3-HT-SD-2019-003',
    contractId: 2,
    contractNo: 'HT-SD-2019-003',
    owner: '市供水公司',
    period: '2026Q3',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    version: 1,
    superseded: false,
    status: '待对账',
    items: [
      { id: 3, kind: '入廊费', name: '2026Q3 入廊费（占用 2200 米）', quantity: 2200, unitPrice: 110, amount: 242000, remark: '按合同单价计列' },
      { id: 4, kind: '服务费', name: '2026Q3 日常运维服务费', quantity: 1, unitPrice: 8400, amount: 8400, remark: '季度服务费' },
    ],
    totalAmount: 250400,
    confirmedAmount: null,
    generatedAt: '2026-07-01 09:25',
    generatedBy: '值班管理员',
    reconcileNote: '',
    arrearsFlagged: false,
    ownerTeam: FEE_TEAM,
  },
  {
    id: 3,
    statementNo: 'JS-2026Q3-HT-GD-2017-011',
    contractId: 3,
    contractNo: 'HT-GD-2017-011',
    owner: '广电网络公司',
    period: '2026Q3',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    version: 1,
    superseded: false,
    status: '有差异',
    items: [
      { id: 5, kind: '入廊费', name: '2026Q3 入廊费（占用 1600 米）', quantity: 1600, unitPrice: 90, amount: 144000, remark: '按合同单价计列' },
      { id: 6, kind: '服务费', name: '2026Q3 日常运维服务费', quantity: 1, unitPrice: 6000, amount: 6000, remark: '季度服务费' },
    ],
    totalAmount: 150000,
    confirmedAmount: 138000,
    generatedAt: '2026-07-01 09:30',
    generatedBy: '值班管理员',
    reconcileNote: '对方回传认可 138000 元，与应收 150000 元相差 12000 元，待挂欠费。',
    arrearsFlagged: false,
    ownerTeam: FEE_TEAM,
  },
]

export const SEED_ARREARS: ArrearsRecord[] = []

export const SEED_PIPELINE_REVIEWS: PipelineReviewItem[] = []

export const SEED_MAINTENANCE_LEDGER: MaintenanceLedgerItem[] = [
  {
    id: 1,
    refNo: 'BY-2019-0142',
    pipelineNo: 'PIPE-SD-0220',
    owner: '市供水公司',
    subject: '给水管支架间距复核',
    ledgerValue: 3.2,
    measuredValue: 2.8,
    adoptedValue: 2.8,
    unit: '米',
    adoptReason: '台账登记 3.2 米与现场实测 2.8 米不一致，按现场实测统一，台账照实测回算。',
    isBackfilled: false,
    sourceStatementNo: '',
    status: '已保养',
    ownerTeam: PIPELINE_TEAM,
  },
  {
    id: 2,
    refNo: 'BY-2021-0088',
    pipelineNo: 'PIPE-RL-0180',
    owner: '城燃燃气集团',
    subject: '燃气舱阀门井密封性保养',
    ledgerValue: null,
    measuredValue: 1,
    adoptedValue: 1,
    unit: '次',
    adoptReason: '早年口头约定段未登记保养项，另起一行补录；以现场实测记录为准。',
    isBackfilled: true,
    sourceStatementNo: '',
    status: '已保养',
    ownerTeam: PIPELINE_TEAM,
  },
]

export const SEED_IMPORT_BATCHES: ImportBatch[] = []

/** 各权属单位在廊管线名册：欠费挂出后，按这个名册生成管线复核清单。编号与通用台账原编号保持一致。 */
export interface RosterLine {
  pipelineNo: string
  owner: string
  cabin: string
  pipelineType: string
  responsible: string
}

export const PIPELINE_ROSTER: RosterLine[] = [
  { pipelineNo: 'PIPE-RL-0180', owner: '城燃燃气集团', cabin: '燃气舱 A 段', pipelineType: '高压燃气', responsible: '林管线' },
  { pipelineNo: 'PIPE-RL-0181', owner: '城燃燃气集团', cabin: '燃气舱 B 段', pipelineType: '中压燃气', responsible: '林管线' },
  { pipelineNo: 'PIPE-SD-0220', owner: '市供水公司', cabin: '水电舱 C 段', pipelineType: '给水干管', responsible: '林管线' },
  { pipelineNo: 'PIPE-SD-0221', owner: '市供水公司', cabin: '水电舱 D 段', pipelineType: '给水支管', responsible: '林管线' },
  { pipelineNo: 'PIPE-GD-0310', owner: '广电网络公司', cabin: '电信舱 E 段', pipelineType: '通信光缆', responsible: '林管线' },
  { pipelineNo: 'PIPE-GD-0311', owner: '广电网络公司', cabin: '电信舱 F 段', pipelineType: '通信光缆', responsible: '林管线' },
  { pipelineNo: 'PIPE-LD-0066', owner: '绿电热力公司', cabin: '热力舱 G 段', pipelineType: '热力管道', responsible: '林管线' },
  { pipelineNo: 'PIPE-HT-0009', owner: '恒通弱电公司', cabin: '电信舱 H 段', pipelineType: '弱电电缆', responsible: '林管线' },
]
