import type { Sheet } from 'read-excel-file/browser'
import type { DataRow } from './types'
import { normalizeRows } from './utils'

export function rowsFromExcelSheet(sheet: Sheet): DataRow[] {
  const [header, ...body] = sheet.data
  if (!header) return []
  return normalizeRows(body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [String(name ?? `Column${index + 1}`), cells[index] ?? null]))))
}
