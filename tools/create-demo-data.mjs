import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbook } from '@oai/artifact-tool'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const round = (value) => Math.round(value * 100) / 100
const regions = [
  ['East', 1.22], ['North', 1.06], ['South', 0.96], ['West', 0.82],
]
const categories = [
  ['Electronics', 280], ['Home', 160], ['Sports', 130],
]
const headers = [
  'RecordID', 'Date', 'Region', 'Category', 'Channel', 'Promotion',
  'Orders', 'Quantity', 'UnitPrice', 'Discount', 'Sales', 'Cost',
  'Profit', 'MarketingSpend', 'Satisfaction',
]

const rows = []
for (const year of [2024, 2025]) {
  for (let month = 1; month <= 12; month += 1) {
    for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
      for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
        const [region, regionWeight] = regions[regionIndex]
        const [category, basePrice] = categories[categoryIndex]
        const orders = 36 + month * 2 + regionIndex * 3 + categoryIndex * 4 + (year - 2024) * 8
          + ((month * 3 + regionIndex * 5 + categoryIndex * 7) % 9)
        const quantity = orders * (1 + ((month + regionIndex + categoryIndex) % 3))
        const unitPrice = round(basePrice * (0.94 + ((month * 2 + regionIndex + categoryIndex) % 9) * 0.015))
        const discount = round(0.02 + ((month + categoryIndex) % 4) * 0.025)
        const season = month === 11 ? 1.3 : month === 12 ? 1.42 : month === 6 ? 1.1 : 1
        const yearGrowth = year === 2025 ? 1.13 : 1
        const channel = ['Online', 'Retail', 'Partner'][(month + regionIndex + categoryIndex) % 3]
        let promotion = month >= 11 ? 'Holiday' : month === 6 ? 'Summer' : 'None'
        let sales = round(quantity * unitPrice * (1 - discount) * season * regionWeight * yearGrowth)
        if (year === 2025 && month === 11 && region === 'East' && category === 'Electronics') {
          sales = round(sales * 3.2)
          promotion = 'Major Campaign'
        }
        if (year === 2025 && month === 4 && region === 'West' && category === 'Sports') {
          sales = round(sales * 0.35)
          promotion = 'Supply Disruption'
        }
        const cost = round(sales * (0.59 + ((month + regionIndex + categoryIndex) % 5) * 0.015))
        const index = rows.length
        rows.push([
          `DEMO-${year}${String(month).padStart(2, '0')}-${region[0]}-${category[0]}`,
          new Date(Date.UTC(year, month - 1, 15)), region, category, channel, promotion,
          orders, quantity, unitPrice, discount, sales, cost, round(sales - cost),
          index % 53 === 12 ? null : round(sales * (0.04 + ((month + regionIndex) % 4) * 0.005)),
          index % 29 === 7 ? null : 78 + ((month * 3 + regionIndex * 4 + categoryIndex * 5) % 18),
        ])
      }
    }
  }
}
for (const index of [18, 123, 246]) rows.push([...rows[index]])

const build = (name, columns, data) => {
  const workbook = Workbook.create()
  const sheet = workbook.worksheets.add(name)
  const used = sheet.getRangeByIndexes(0, 0, data.length + 1, columns.length)
  used.values = [columns, ...data]
  used.format.font = { name: 'Arial', size: 10, color: '#173B55' }
  used.format.verticalAlignment = 'center'
  sheet.getRangeByIndexes(0, 0, 1, columns.length).format = {
    fill: '#E7F5FB',
    font: { name: 'Arial', size: 10, bold: true, color: '#124F78' },
  }
  columns.forEach((column, index) => {
    sheet.getRangeByIndexes(0, index, data.length + 1, 1).format.columnWidth =
      column === 'RecordID' ? 24 : column === 'Promotion' ? 21 : column === 'Date' ? 16 : 17
  })
  sheet.freezePanes.freezeRows(1)
  sheet.showGridLines = false
  workbook.recalculate()
  return { workbook, sheet }
}

const orders = build('Orders', headers, rows)
orders.sheet.getRangeByIndexes(1, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd')
for (const index of [8, 10, 11, 12, 13]) {
  orders.sheet.getRangeByIndexes(1, index, rows.length, 1).setNumberFormat('#,##0.00')
}
orders.sheet.getRangeByIndexes(1, 9, rows.length, 1).setNumberFormat('0.0%')

const targetRows = [
  ['East', 0.15, 0.36, 'Tier 1'],
  ['North', 0.12, 0.34, 'Tier 1'],
  ['South', 0.11, 0.32, 'Tier 2'],
  ['West', 0.10, 0.30, 'Tier 2'],
]
const targets = build('RegionTargets', ['Region', 'TargetGrowth2025', 'TargetMargin', 'MarketTier'], targetRows)
targets.sheet.getRange('B2:C5').setNumberFormat('0.0%')

const csv = (matrix) => matrix.map((row) => row.map((value) => {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}).join(',')).join('\r\n') + '\r\n'
const output = [
  [orders.sheet, rows.length + 1, headers.length, path.join(root, '演示零售订单_合成数据.csv')],
  [targets.sheet, targetRows.length + 1, 4, path.join(root, '演示地区目标_合成数据.csv')],
]
for (const [sheet, rowCount, columnCount, file] of output) {
  await fs.writeFile(file, '\ufeff' + csv(sheet.getRangeByIndexes(0, 0, rowCount, columnCount).values), 'utf8')
  console.log(file)
}

const previewDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacanvas-demo-'))
for (const [name, workbook, range] of [
  ['orders', orders.workbook, 'A1:O8'],
  ['targets', targets.workbook, 'A1:D5'],
]) {
  const preview = await workbook.render({ sheetName: name === 'orders' ? 'Orders' : 'RegionTargets', range, scale: 1.4, format: 'png' })
  await fs.writeFile(path.join(previewDir, `${name}.png`), new Uint8Array(await preview.arrayBuffer()))
}
console.log(`previews: ${previewDir}`)
console.log(`orders: ${rows.length}; missing Satisfaction: ${rows.filter((row) => row[14] === null).length}; missing MarketingSpend: ${rows.filter((row) => row[13] === null).length}; duplicated rows: 3`)
