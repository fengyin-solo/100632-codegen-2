/** 零依赖 ZIP 打包：STORE（不压缩）+ CRC32。支持中文文件名（UTF-8 标志位 0x0800）。 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  filename: string
  content: string
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

export function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const chunks: BlobPart[] = []
  interface CentralHeader {
    name: Uint8Array<ArrayBuffer>
    crc: number
    size: number
    offset: number
  }
  const headers: CentralHeader[] = []
  let offset = 0

  for (const entry of entries) {
    const name: Uint8Array<ArrayBuffer> = encoder.encode(entry.filename) as Uint8Array<ArrayBuffer>
    const data: Uint8Array<ArrayBuffer> = encoder.encode(entry.content) as Uint8Array<ArrayBuffer>
    const crc = crc32(data)
    headers.push({ name, crc, size: data.length, offset })

    const local = new ArrayBuffer(30)
    const lv = new DataView(local)
    writeU32(lv, 0, 0x04034b50)
    writeU16(lv, 4, 20) // 版本
    writeU16(lv, 6, 0x0800) // UTF-8 文件名
    writeU16(lv, 8, 0) // STORE
    writeU16(lv, 10, 0)
    writeU16(lv, 12, 0)
    writeU32(lv, 14, crc)
    writeU32(lv, 18, data.length)
    writeU32(lv, 22, data.length)
    writeU16(lv, 26, name.length)
    writeU16(lv, 28, 0)
    chunks.push(new Uint8Array(local), name, data)
    offset += 30 + name.length + data.length
  }

  const centralStart = offset
  for (const h of headers) {
    const central = new ArrayBuffer(46)
    const cv = new DataView(central)
    writeU32(cv, 0, 0x02014b50)
    writeU16(cv, 4, 20)
    writeU16(cv, 6, 20)
    writeU16(cv, 8, 0x0800)
    writeU16(cv, 10, 0)
    writeU16(cv, 12, 0)
    writeU16(cv, 14, 0)
    writeU32(cv, 16, h.crc)
    writeU32(cv, 20, h.size)
    writeU32(cv, 24, h.size)
    writeU16(cv, 28, h.name.length)
    writeU16(cv, 30, 0)
    writeU16(cv, 32, 0)
    writeU16(cv, 34, 0)
    writeU16(cv, 36, 0)
    writeU32(cv, 38, 0)
    writeU32(cv, 42, h.offset)
    chunks.push(new Uint8Array(central), h.name)
    offset += 46 + h.name.length
  }
  const centralSize = offset - centralStart

  const end = new ArrayBuffer(22)
  const ev = new DataView(end)
  writeU32(ev, 0, 0x06054b50)
  writeU16(ev, 4, 0)
  writeU16(ev, 6, 0)
  writeU16(ev, 8, headers.length)
  writeU16(ev, 10, headers.length)
  writeU32(ev, 12, centralSize)
  writeU32(ev, 16, centralStart)
  writeU16(ev, 20, 0)
  chunks.push(new Uint8Array(end))

  return new Blob(chunks, { type: 'application/zip' })
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
