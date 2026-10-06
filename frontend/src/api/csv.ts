/** 结算域用的 CSV 解析与序列化（支持引号、逗号、换行；导出带 BOM 供 Excel 识别）。 */

export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
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
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }

  if (rows.length === 0) return []
  const header = rows[0].map((cell) => cell.trim())
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    header.forEach((key, index) => {
      record[key] = (cells[index] ?? '').trim()
    })
    return record
  })
}

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(header: string[], rows: Record<string, unknown>[]): string {
  const lines = [header.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(header.map((key) => escapeCell(row[key])).join(','))
  }
  return `﻿${lines.join('\n')}`
}

export function parseAmount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const amount = Number(value.replace(/[,，\s]/g, ''))
  return Number.isFinite(amount) ? amount : null
}
