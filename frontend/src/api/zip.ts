/**
 * 极简 ZIP 打包（仅 STORE，不压缩）：外部文件处理完后，
 * 把「对账结果 + 入库数据」打成一个 zip 另存，不引第三方依赖。
 */

const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function strBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export interface ZipEntry {
  name: string
  content: string
}

export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const u16 = (view: DataView, at: number, v: number) => view.setUint16(at, v, true)
  const u32 = (view: DataView, at: number, v: number) => view.setUint32(at, v >>> 0, true)

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const data = strBytes(entry.content)
    const crc = crc32(data)

    const local = new ArrayBuffer(30 + nameBytes.length)
    const lv = new DataView(local)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 6, 0x0800) // UTF-8 标志位
    u16(lv, 8, 0) // STORE
    u16(lv, 10, 0)
    u16(lv, 12, 0)
    u32(lv, 14, crc)
    u32(lv, 18, data.length)
    u32(lv, 22, data.length)
    u16(lv, 26, nameBytes.length)
    u16(lv, 28, 0)
    new Uint8Array(local).set(nameBytes, 30)

    chunks.push(new Uint8Array(local), data)

    const cd = new ArrayBuffer(46 + nameBytes.length)
    const cv = new DataView(cd)
    u32(cv, 0, 0x02014b50)
    u16(cv, 4, 20)
    u16(cv, 6, 20)
    u16(cv, 8, 0x0800)
    u16(cv, 10, 0)
    u16(cv, 12, 0)
    u16(cv, 14, 0)
    u32(cv, 16, crc)
    u32(cv, 20, data.length)
    u32(cv, 24, data.length)
    u16(cv, 28, nameBytes.length)
    u16(cv, 30, 0)
    u16(cv, 32, 0)
    u16(cv, 34, 0)
    u16(cv, 36, 0)
    u32(cv, 38, 0)
    u32(cv, 42, offset)
    new Uint8Array(cd).set(nameBytes, 46)
    central.push(new Uint8Array(cd))

    offset += 30 + nameBytes.length + data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const centralOffset = offset

  const end = new ArrayBuffer(22)
  const ev = new DataView(end)
  u32(ev, 0, 0x06054b50)
  u16(ev, 4, 0)
  u16(ev, 6, 0)
  u16(ev, 8, entries.length)
  u16(ev, 10, entries.length)
  u32(ev, 12, centralSize)
  u32(ev, 16, centralOffset)
  u16(ev, 20, 0)

  return new Blob(
    [...chunks, ...central, new Uint8Array(end)] as BlobPart[],
    {
      type: 'application/zip',
    },
  )
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
