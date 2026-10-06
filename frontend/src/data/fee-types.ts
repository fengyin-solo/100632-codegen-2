/** 入廊费/服务费结算专项的类型：与通用台账的 EntryRow 分开，这一块带出账、对账、欠费联动等行为。 */

export type BillStatus = '待对账' | '已结清' | '欠费' | '已作废'

/** 结算单费用明细行 */
export interface FeeLine {
  费目: '入廊费' | '服务费'
  说明: string
  金额: number
}

/** 入廊服务合同（含早年口头约定补录的事实合同） */
export interface ServiceContract {
  合同编号: string
  权属单位: string
  管线类型: string
  管线编号列表: string[]
  所属舱室: string
  签订日期: string
  入廊费: number
  单周期服务费: number
  合同性质: '书面合同' | '口头补录'
  合同状态: '正式' | '待补签'
  存量回填: boolean
  备注: string
}

/** 结算单（同一合同+周期可有多个版次，只有最后一版有效） */
export interface Bill {
  id: number
  结算单号: string
  合同编号: string
  权属单位: string
  计费周期: string
  版次: number
  状态: BillStatus
  被谁替代?: number
  明细: FeeLine[]
  对方确认金额: number
  已收金额: number
  对账批次?: number
  对账时间?: string
  备注?: string
  生成时间: string
}

/** 对账回传文件逐行核对结果（含未匹配行及原因） */
export interface ReconcileRow {
  id: number
  批次: number
  文件行号: number
  合同编号: string
  计费周期: string
  费目: string
  账列金额: number
  回函确认金额: number
  回函已缴金额: number
  对方备注: string
  是否匹配: boolean
  原因: string
  结算单?: number
  核对结论: string
}

/** 对账导入批次 */
export interface ImportBatch {
  id: number
  文件名: string
  导入时间: string
  计费周期: string
  操作人: string
}

export type ReviewStatus = '待复核' | '复核中' | '已复核' | '已解除'

/** 欠费牵动的入廊管线复核清单项（管线责任人在另一个入口处理） */
export interface ReviewItem {
  id: number
  复核编号: string
  管线编号: string
  所属舱室: string
  权属单位: string
  合同编号: string
  结算单: number
  结算单号: string
  计费周期: string
  欠费分摊: number
  状态: ReviewStatus
  责任班组: string
  实测时间?: string
  现场实测值?: string
  复核结论?: string
  登记台账编号?: string
  创建时间: string
 更新时间: string
}

/** 保养台账取值版本留痕 */
export interface LedgerVersion {
  取值版本: string
  现场实测值: string
  台账申报值: string
  本次保养日期: string
  下次保养日期: string
  变更时间: string
  变更原因: string
}

/** 入廊设施保养台账（别的入口，结算/复核结论往这里落） */
export interface LedgerItem {
  id: number
  台账编号: string
  保养对象编号: string
  保养对象名称: string
  所属舱室: string
  责任班组: string
  保养周期月: number
  上次保养日期: string
  本次保养日期: string
  现场实测值: string
  台账申报值: string
  取值版本: '现场实测版' | '台账申报版'
  下次保养日期: string
  数据来源: '既有台账迁入' | '复核登记' | '外部导入'
  来源单号?: string
  备注: string
  历史: LedgerVersion[]
  更新时间: string
}

export interface FeeState {
  contracts: ServiceContract[]
  bills: Bill[]
  batches: ImportBatch[]
  reconRows: ReconcileRow[]
  reviews: ReviewItem[]
  ledger: LedgerItem[]
  seq: { bill: number; batch: number; recon: number; review: number; ledger: number }
}
