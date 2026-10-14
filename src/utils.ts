import type { CellValue, DataRow, DataType } from './types'

/* ------------------------------------------------------------------ *
 * Value coercion
 * ------------------------------------------------------------------ */

export const isMissing = (value: CellValue | undefined): boolean =>
  value === null || value === undefined || value === ''

export const normalizeValue = (value: unknown): CellValue => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'object' && value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/** Coerce a cell to a finite number, or `null` when it is not numeric. */
export const toNumber = (value: CellValue | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null || value === undefined) return null
  const text = String(value).trim().replace(/,/g, '')
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export const toBoolean = (value: CellValue | undefined): boolean | null => {
  if (typeof value === 'boolean') return value
  if (isMissing(value)) return null
  const text = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 't'].includes(text)) return true
  if (['false', '0', 'no', 'n', 'f'].includes(text)) return false
  return null
}

export const DATE_RE = /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?([ T]\d{1,2}:\d{2}(:\d{2})?)?/
export const DATE_ONLY_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/

export const parseDate = (value: CellValue | undefined): Date | null => {
  if ((value as unknown) instanceof Date) return value as unknown as Date
  if (isMissing(value)) return null
  const text = String(value).trim()
  if (!DATE_RE.test(text)) return null
  const time = Date.parse(text.length <= 10 ? `${text}T00:00:00Z` : text)
  return Number.isNaN(time) ? null : new Date(time)
}

export const toISODate = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * Infer a column dtype the way pandas' `read_csv` guesses it.
 * Numbers and dates win over text only when *every* non-missing value parses,
 * which keeps ids like `ORD-0001` as text instead of silently becoming NaN.
 */
export const inferType = (values: Array<CellValue | undefined>): DataType => {
  const present = values.filter((value) => !isMissing(value))
  if (!present.length) return 'text'
  if (present.every((value) => toBoolean(value) !== null)) return 'boolean'
  if (present.every((value) => toNumber(value) !== null)) return 'number'
  if (present.every((value) => parseDate(value) !== null)) return 'date'
  return 'text'
}

export const inferColumnTypes = (rows: DataRow[], columns: string[]): Record<string, DataType> => {
  const sample = rows.length > 500 ? rows.slice(0, 500) : rows
  const types: Record<string, DataType> = {}
  columns.forEach((column) => {
    types[column] = inferType(sample.map((row) => row[column]))
  })
  return types
}

export const getColumns = (rows: DataRow[]): string[] => {
  const seen = new Set<string>()
  const order: string[] = []
  rows.slice(0, 50).forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    })
  })
  return order
}

export const normalizeRows = (input: unknown[]): DataRow[] => {
  const objects = input.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
  )
  const keys: string[] = []
  const seen = new Set<string>()
  objects.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    })
  })
  return objects.map(
    (row) => Object.fromEntries(keys.map((key) => [key, normalizeValue(row[key])])) as DataRow,
  )
}

/* ------------------------------------------------------------------ *
 * Statistics primitives
 * ------------------------------------------------------------------ */

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

export const mean = (values: number[]): number => (values.length ? sum(values) / values.length : 0)

/* Loop-based extremes: `Math.min(...values)` spreads every element onto the
   call stack and throws RangeError past ~65k arguments. */
export const minOf = (values: ArrayLike<number>): number => {
  let result = Infinity
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < result) result = values[index]
  }
  return result
}

export const maxOf = (values: ArrayLike<number>): number => {
  let result = -Infinity
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > result) result = values[index]
  }
  return result
}

/** Both extremes in a single pass. */
export const minMax = (values: ArrayLike<number>): { min: number; max: number } => {
  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/** Sample standard deviation (ddof = 1), matching pandas' `.std()` default. */
export const std = (values: number[], ddof = 1): number => {
  if (values.length <= ddof) return 0
  const avg = mean(values)
  const squared = values.map((value) => (value - avg) ** 2)
  return Math.sqrt(sum(squared) / (values.length - ddof))
}

export const variance = (values: number[], ddof = 1): number => std(values, ddof) ** 2

/** Linear-interpolation quantile, matching `numpy.percentile` / pandas `.quantile()`. */
export const quantile = (sortedValues: number[], q: number): number => {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * Math.min(Math.max(q, 0), 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

export const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b)

export const median = (values: number[]): number => quantile(sorted(values), 0.5)

export const skewness = (values: number[]): number => {
  const n = values.length
  if (n < 3) return 0
  const avg = mean(values)
  const spread = std(values, 0)
  if (spread === 0) return 0
  const cubed = values.map((value) => ((value - avg) / spread) ** 3)
  return (n / ((n - 1) * (n - 2))) * sum(cubed)
}

/** Excess kurtosis (Fisher), matching pandas' `.kurt()`. */
export const kurtosis = (values: number[]): number => {
  const n = values.length
  if (n < 4) return 0
  const avg = mean(values)
  const spread = std(values, 0)
  if (spread === 0) return 0
  const fourth = sum(values.map((value) => ((value - avg) / spread) ** 4)) / n
  return fourth - 3
}

export const pearson = (pairs: Array<[number, number]>): number | null => {
  const n = pairs.length
  if (n < 3) return null
  const xs = pairs.map((pair) => pair[0])
  const ys = pairs.map((pair) => pair[1])
  const mx = mean(xs)
  const my = mean(ys)
  let cov = 0
  let vx = 0
  let vy = 0
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - mx
    const dy = ys[index] - my
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx === 0 || vy === 0) return null
  return cov / Math.sqrt(vx * vy)
}

/** Average-rank transform, the basis of Spearman correlation. */
export const ranks = (values: number[]): number[] => {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length).fill(0)
  let position = 0
  while (position < order.length) {
    let end = position
    while (end + 1 < order.length && order[end + 1].value === order[position].value) end += 1
    const averageRank = (position + end) / 2 + 1
    for (let cursor = position; cursor <= end; cursor += 1) result[order[cursor].index] = averageRank
    position = end + 1
  }
  return result
}

export const linearRegression = (
  pairs: Array<[number, number]>,
): { slope: number; intercept: number; r2: number } | null => {
  if (pairs.length < 3) return null
  const xs = pairs.map((pair) => pair[0])
  const ys = pairs.map((pair) => pair[1])
  const mx = mean(xs)
  const my = mean(ys)
  let cov = 0
  let vx = 0
  for (let index = 0; index < pairs.length; index += 1) {
    cov += (xs[index] - mx) * (ys[index] - my)
    vx += (xs[index] - mx) ** 2
  }
  if (vx === 0) return null
  const slope = cov / vx
  const intercept = my - slope * mx
  const correlation = pearson(pairs)
  return { slope, intercept, r2: correlation === null ? 0 : correlation ** 2 }
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return numberFormatter.format(value)
}

export const formatCompact = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Math.abs(value) >= 10000 ? compactFormatter.format(value) : numberFormatter.format(value)
}

export const formatRatio = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

export const formatCell = (value: CellValue): string => {
  if (isMissing(value)) return ''
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export const truncate = (text: string, max = 22): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** Stable unique id so React keys never collide across rapid clicks. */
let counter = 0
export const uid = (prefix = 'id'): string => {
  counter += 1
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
