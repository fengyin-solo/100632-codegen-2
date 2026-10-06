/** 结算专项纯逻辑：周期换算、金额计算、CSV 解析与拼装、金额/日期格式化，不碰存储与 DOM。 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 计费周期统一用「YYYY-Q?」表示季度；另兼容「YYYY-MM」月周期。 */
export function periodStart(period: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(period.trim())
  if (m) {
    return `${m[1]}-${pad2((Number(m[2]) - 1) * 3 + 1)}-01`
  }
  const mm = /^(\d{4})-(\d{2})$/.exec(period.trim())
  if (mm) {
    return `${mm[1]}-${mm[2]}-01`
  }
  return period
}

/** 周期先后比较：a<b 返回 -1；无法解析的排最后。 */
export function comparePeriod(a: string, b: string): number {
  const sa = periodStart(a)
  const sb = periodStart(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/** 含签订日期当日所在的周期：存量合同从该周期开始计费。 */
export function firstChargePeriod(signDate: string): string {
  const d = new Date(`${signDate}T00:00:00`)
  const year = d.getFullYear()
  const quarter = Math.floor(d.getMonth() / 3) + 1
  return `${year}-Q${quarter}`
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function periodLabel(period: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(period.trim())
  if (m) {
    return `${m[1]}年第${m[2]}季度`
  }
  return period
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function money(n: number): string {
  return round2(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 结算单应收：明细金额合计（作废单应收为 0，不叠加）。 */
export function billReceivable(bill: { 状态: string; 明细: { 金额: number }[] }): number {
  if (bill.状态 === '已作废') return 0
  return round2(bill.明细.reduce((s, l) => s + Number(l.金额 || 0), 0))
}

/** 对账差额：对方确认 - 我方应收。负数即少确认/欠费。 */
export function billDiff(bill: { 状态: string; 明细: { 金额: number }[]; 对方确认金额: number }): number {
  return round2(bill.对方确认金额 - billReceivable(bill))
}

/**
 * 极简 CSV 解析：支持引号包裹、引号内逗号与双引号转义，首行作为表头。
 * 表头会做空白裁剪，行内字段也裁剪两端空白。
 */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
  }
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {}
    header.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim()
    })
    return obj
  })
}

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], lines: unknown[][]): string {
  const all = [header, ...lines]
  return `﻿${all.map((line) => line.map(escapeCell).join(',')).join('\r\n')}`
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function nowStamp(): string {
  const d = new Date()
  return `${today()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/[,，\s¥￥]/g, ''))
  return Number.isFinite(n) ? round2(n) : NaN
}
