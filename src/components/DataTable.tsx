import { useMemo } from 'react'
import type { DataRow, DataType } from '../types'
import { formatCell, isMissing } from '../utils'

/**
 * Virtualised-by-page table with type-aware alignment and missing-value styling.
 * Used by the overview preview and every result grid so they stay consistent.
 */
export function DataTable({
  columns, rows, types, maxHeight = 560, rowOffset = 0, highlight,
}: {
  columns: string[]
  rows: DataRow[]
  types?: Record<string, DataType>
  maxHeight?: number
  rowOffset?: number
  highlight?: (row: DataRow) => boolean
}) {
  const numericColumns = useMemo(() => {
    const result = new Set<string>()
    columns.forEach((column) => {
      if (types && types[column]) {
        if (types[column] === 'number') result.add(column)
        return
      }
      const sample = rows.slice(0, 30).map((row) => row[column]).filter((value) => !isMissing(value))
      if (sample.length && sample.every((value) => typeof value === 'number')) result.add(column)
    })
    return result
  }, [columns, rows, types])

  if (!rows.length) return <div className="table-empty">—</div>

  return (
    <div className="table-scroll" style={{ maxHeight }}>
      <table className="data-table">
        <thead>
          <tr>
            <th className="index-cell">#</th>
            {columns.map((column) => (
              <th key={column} className={numericColumns.has(column) ? 'numeric' : ''}>
                <span className="th-label">{column}</span>
                {types?.[column] && <span className={`type-dot ${types[column]}`} title={types[column]} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={highlight?.(row) ? 'row-highlight' : ''}>
              <td className="index-cell">{rowOffset + index + 1}</td>
              {columns.map((column) => {
                const value = row[column]
                const missing = isMissing(value)
                return (
                  <td
                    key={column}
                    className={`${numericColumns.has(column) ? 'numeric' : ''} ${missing ? 'missing-cell' : ''}`}
                    title={missing ? '' : formatCell(value)}
                  >
                    {missing ? '—' : formatCell(value)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
