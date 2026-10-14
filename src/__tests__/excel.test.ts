import { describe, expect, it } from 'vitest'
import readXlsxFile from 'read-excel-file/node'
import { fileURLToPath } from 'node:url'
import { rowsFromExcelSheet } from '../excel'

describe('Excel import', () => {
  it('reads all worksheets and converts the selected sheet into data rows', async () => {
    const path = fileURLToPath(new URL('./fixtures/excel-multi.xlsx', import.meta.url))
    const sheets = await readXlsxFile(path)
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['Summary', 'Orders'])
    expect(rowsFromExcelSheet(sheets[1])).toEqual([
      { OrderID: 'A-001', Region: 'North', Sales: 25 },
      { OrderID: 'A-002', Region: 'South', Sales: 40 },
    ])
  })
})
