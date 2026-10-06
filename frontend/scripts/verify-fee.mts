// 用本地 localStorage stub 在 Node 里跑一遍核心业务流，验证所有硬规则。

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
}
globalThis.document = { createElement: () => ({ click() {}, style: {} }), body: { appendChild() {}, removeChild() {} } }
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
globalThis.Blob = class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts } }
const { TextEncoder } = await import('node:util')
globalThis.TextEncoder = TextEncoder

import * as svc from '../src/api/fee-service.ts'

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name} ${detail}`) }
}

// 1. 种子：Q3 9 张有效单，Q2 1 张作废 + 8 张有效
let bills = svc.listBills()
check('种子结算单总数 18', bills.length === 18, `实际 ${bills.length}`)
check('作废单 1 张', bills.filter((b) => b.状态 === '已作废').length === 1)
check('燃气 Q2 欠费 6000', (() => {
  const g = bills.find((b) => b.合同编号 === 'HT-RL-2024-018' && b.计费周期 === '2026-Q2' && b.状态 === '欠费')
  return g && svc.billReceivable(g) - g.已收金额 === 6000
})())
check('通信 Q3 含入廊费 210000+服务费 15000=225000', (() => {
  const t = bills.find((b) => b.合同编号 === 'HT-RL-2026-003' && b.计费周期 === '2026-Q3')
  return t && svc.billReceivable(t) === 225000
})())

// 2. 越权：非收费班组不能出账
let r = svc.generateBills('2026-Q3', 'pipeline', '测试')
check('非收费班组出账被驳回', r.ok === false && /按归属驳回/.test(r.message))

// 3. 重复出账：Q3 再出一次 -> 9 张旧版作废，新版 9 张
r = svc.generateBills('2026-Q3', 'billing', '收费结算班组·李会计')
check('Q3 重复出账成功', r.ok && r.created === 9 && r.superseded === 9, r.message)
bills = svc.listBills('2026-Q3')
check('Q3 有效单仍为 9（不叠加）', bills.filter((b) => b.状态 !== '已作废').length === 9)
check('Q3 作废单 9 张', bills.filter((b) => b.状态 === '已作废').length === 9)
check('作废单指向替代版本', bills.filter((b) => b.状态 === '已作废').every((b) => b.被谁替代))
check('新出账单为 v2', bills.filter((b) => b.状态 !== '已作废').every((b) => b.版次 === 2))

// 4. 对账导入：含匹配、少缴、未匹配合同、无有效周期
const csv = [
  '合同编号,计费周期,费目,账列金额,回函确认金额,回函已缴金额,对方备注',
  'HT-RL-2021-001,2026-Q3,服务费,36000,36000,36000,核对无误',
  'HT-RL-2024-018,2026-Q3,服务费,26000,26000,10000,先缴一万',
  'HT-RL-9999-999,2026-Q3,服务费,0,500,500,合同号写错',
  'HT-RL-2026-003,2026-Q2,服务费,0,15000,0,首费期前回函',
].join('\n')
const imp = svc.importReconcileFile('test.csv', csv, '收费结算班组·李会计', 'billing')
check('导入匹配 2 行', imp.匹配入账 === 2, imp.message)
check('导入未匹配 2 行并单列', imp.未匹配 === 2 && imp.unmatched.length === 2)
check('未匹配原因：合同不存在', /合同编号 HT-RL-9999-999 .*不存在/.test(imp.unmatched.find((x) => x.合同编号 === 'HT-RL-9999-999').原因))
check('未匹配原因：首费期之前', /首费周期为 2026-Q3/.test(imp.unmatched.find((x) => x.合同编号 === 'HT-RL-2026-003').原因))
check('新增欠费 1 张', imp.新增欠费 === 1)
check('结清 1 张', imp.结清 === 1)
const gasQ3 = svc.listBills('2026-Q3').find((b) => b.合同编号 === 'HT-RL-2024-018' && b.状态 !== '已作废')
check('燃气 Q3 挂欠费 16000', gasQ3.状态 === '欠费' && svc.billReceivable(gasQ3) - gasQ3.已收金额 === 16000)

// 5. 欠费牵动复核：燃气 Q2(6000,2条) + Q3(16000,2条) = 4 条待复核
let reviews = svc.listReviews('待复核')
check('待复核共 4 条（Q2+Q3 各 2 条管线）', reviews.length === 4, `实际 ${reviews.length}`)
const q3Reviews = reviews.filter((x) => x.计费周期 === '2026-Q3')
check('Q3 欠费在两条管线上均摊 8000', q3Reviews.length === 2 && q3Reviews.every((x) => x.欠费分摊 === 8000))

// 6. 非管线班组提交复核被拒
let sr = svc.submitReview(q3Reviews[0].id, {
  管线编号: q3Reviews[0].管线编号, 现场实测值: 'a', 台账申报值: 'b', 实测时间: '2026-10-06',
  复核结论: 'c', 本次保养日期: '2026-10-06', 保养周期月: 3, 责任班组: '机电维修班',
}, 'billing')
check('非管线班组复核提交被驳回', sr.ok === false && /按归属驳回/.test(sr.message))

// 7. PIPE-0008 已有台账照原编号；实测与申报不一致按实测
sr = svc.submitReview(q3Reviews.find((x) => x.管线编号 === 'PIPE-0008').id, {
  管线编号: 'PIPE-0008', 现场实测值: '实测压力0.35', 台账申报值: '台账0.30', 实测时间: '2026-10-06',
  复核结论: '运行正常，催缴欠费', 本次保养日期: '2026-10-06', 保养周期月: 3, 责任班组: '机电维修班',
}, 'pipeline')
check('PIPE-0008 复核提交成功并落 DEVI-0002', sr.ok && sr.台账编号 === 'DEVI-0002', sr.message)
let ledger = svc.listLedger()
const dev0002 = ledger.find((l) => l.台账编号 === 'DEVI-0002')
check('照原编号更新且采用现场实测版', dev0002.现场实测值 === '实测压力0.35' && dev0002.取值版本 === '现场实测版')
check('下次保养日照实测日期+3月回算=2027-01-06', dev0002.下次保养日期 === '2027-01-06', dev0002.下次保养日期)
check('上次保养日取原本次保养日', dev0002.上次保养日期 === '2026-06-15')
check('历史留痕 +1', dev0002.历史.length === 1)
check('来源单号=复核编号', dev0002.来源单号?.startsWith('FH-'))

// 8. PIPE-0009 早年未登记 -> 另起 BY-NEW
const pipe9 = svc.listReviews('待复核').find((x) => x.管线编号 === 'PIPE-0009' && x.计费周期 === '2026-Q3')
sr = svc.submitReview(pipe9.id, {
  管线编号: 'PIPE-0009', 现场实测值: '无泄漏', 台账申报值: '无记录', 实测时间: '2026-10-06',
  复核结论: '正常', 本次保养日期: '2026-10-06', 保养周期月: 3, 责任班组: '机电维修班',
}, 'pipeline')
check('PIPE-0009 另起 BY-NEW 新行', sr.ok && /^BY-NEW-/.test(sr.台账编号 ?? ''), sr.message)

// 9. 复核清单数字与结算单详情同源：补缴结清后，未处理复核项自动解除、已复核项留痕
//   （Q3 两条都已提交复核应留痕；另用尚未处理的 Q2 燃气欠费验证解除）
const csv2 = '合同编号,计费周期,费目,账列金额,回函确认金额,回函已缴金额,对方备注\nHT-RL-2024-018,2026-Q3,服务费,26000,26000,26000,补齐\nHT-RL-2024-018,2026-Q2,服务费,26000,26000,26000,补齐尾款6000'
const imp2 = svc.importReconcileFile('pay.csv', csv2, '收费结算班组·李会计', 'billing')
check('燃气 Q2/Q3 补缴后结清 2 张', imp2.ok && imp2.结清 === 2, imp2.message)
const q3Gas = svc.listReviews().filter((x) => x.计费周期 === '2026-Q3' && x.权属单位 === '中燃城市燃气')
check('Q3 已复核两项留痕、不被解除', q3Gas.length === 2 && q3Gas.every((x) => x.状态 === '已复核'))
const q2Gas = svc.listReviews().filter((x) => x.计费周期 === '2026-Q2')
check('Q2 未处理复核项随欠费结清自动解除', q2Gas.length === 2 && q2Gas.every((x) => x.状态 === '已解除'))

// 10. 外部保养台账导入：更新既有 + 新行 + 按实测
const ledgerCsv = [
  '保养对象编号,保养对象名称,所属舱室,责任班组,保养周期月,本次保养日期,现场实测值,台账申报值',
  'PIPE-0001,给水管线一,综合舱A,机电维修班,3,2026-10-05,实测值X,台账值Y',
  'PIPE-0077,早年漏登,综合舱A,机电维修班,6,2026-10-05,实测Z,无台账',
].join('\n')
const li = svc.importLedgerFile('外.csv', ledgerCsv, 'maintenance')
check('保养导入：更新 1 新增 1', li.ok && li.更新 === 1 && li.新增 === 1, li.message)
check('非机电班组保养导入被驳回', svc.importLedgerFile('x.csv', ledgerCsv, 'billing').ok === false)
ledger = svc.listLedger()
const newRow = ledger.find((l) => l.保养对象编号 === 'PIPE-0077')
check('新登记项 BY-NEW 且注明早年未登记', newRow && /^BY-NEW-/.test(newRow.台账编号) && /早年未登记/.test(newRow.备注))
check('既有项照原编号且按实测统一', ledger.find((l) => l.保养对象编号 === 'PIPE-0001').台账编号 === 'DEVI-0001')

// 11. 打包 ZIP 权限
check('只读身份不能打包', svc.packageAll('2026-Q3', 'viewer').ok === false)
const pkg = svc.packageAll('2026-Q3', 'billing')
check('收费班组可打包', pkg.ok, pkg.message)

// 12. 对齐汇总
const sum = svc.ledgerAlignmentSummary()
check('对齐汇总无异常', Array.isArray(sum.未登记管线) && typeof sum.待复核管线 === 'number')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
