import type {
  Aggregation, CellValue, ColumnProfile, CorrelationMatrix, DataRow, DataType, FilterCondition,
  RegressionResult, SummaryStats,
} from './types'
import {
  formatCell, inferType, isMissing, kurtosis, linearRegression, maxOf, mean, median, minMax,
  minOf, pearson, quantile, ranks, skewness, sorted, std, sum, toNumber, truncate, uid,
} from './utils'

/* ------------------------------------------------------------------ *
 * Column profiling  (pandas: df.info() / df.describe())
 * ------------------------------------------------------------------ */

const HISTOGRAM_BINS = 12

const buildHistogram = (values: number[], bins = HISTOGRAM_BINS): number[] => {
  if (!values.length) return new Array(bins).fill(0)
  const { min: low, max: high } = minMax(values)
  const width = (high - low) / bins || 1
  const result = new Array(bins).fill(0)
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - low) / width)))
    result[index] += 1
  })
  return result
}

export const topValues = (rows: DataRow[], column: string, limit = 5): Array<{ value: string; count: number }> => {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    const value = row[column]
    if (isMissing(value)) return
    const key = formatCell(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export const profileColumns = (rows: DataRow[], columns: string[]): ColumnProfile[] =>
  columns.map((name) => {
    const raw = rows.map((row) => row[name])
    const present = raw.filter((value) => !isMissing(value))
    const missing = rows.length - present.length
    const type: DataType = inferType(raw)
    const numeric = type === 'number' ? present.map((value) => toNumber(value)!).filter(Number.isFinite) : []
    const labels = present.map((value) => formatCell(value))
    const base: ColumnProfile = {
      name,
      type,
      count: present.length,
      missing,
      missingRatio: rows.length ? missing / rows.length : 0,
      unique: new Set(labels).size,
      topValues: topValues(rows, name),
      histogram: [],
    }
    if (type === 'number' && numeric.length) {
      const ordered = sorted(numeric)
      return {
        ...base,
        mean: mean(numeric),
        std: std(numeric),
        min: ordered[0],
        q1: quantile(ordered, 0.25),
        median: quantile(ordered, 0.5),
        q3: quantile(ordered, 0.75),
        max: ordered[ordered.length - 1],
        sum: sum(numeric),
        skew: skewness(numeric),
        histogram: buildHistogram(numeric),
      }
    }
    const orderedLabels = [...labels].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    return {
      ...base,
      minLabel: orderedLabels[0],
      maxLabel: orderedLabels[orderedLabels.length - 1],
    }
  })

export const describeColumn = (rows: DataRow[], column: string): SummaryStats => {
  const raw = rows.map((row) => row[column])
  const present = raw.filter((value) => !isMissing(value))
  const numeric = present.map((value) => toNumber(value)).filter((value): value is number => value !== null)
  const ordered = sorted(numeric)
  const avg = mean(numeric)
  const spread = std(numeric)
  const min = ordered.length ? ordered[0] : 0
  const max = ordered.length ? ordered[ordered.length - 1] : 0
  return {
    count: numeric.length,
    missing: rows.length - present.length,
    mean: avg,
    std: spread,
    min,
    q1: quantile(ordered, 0.25),
    median: quantile(ordered, 0.5),
    q3: quantile(ordered, 0.75),
    max,
    sum: sum(numeric),
    skew: skewness(numeric),
    kurtosis: kurtosis(numeric),
    range: max - min,
    iqr: quantile(ordered, 0.75) - quantile(ordered, 0.25),
    cv: avg === 0 ? 0 : spread / Math.abs(avg),
  }
}

/* ------------------------------------------------------------------ *
 * Grouping and aggregation  (pandas: df.groupby(...).agg(...))
 * ------------------------------------------------------------------ */

const aggregateValues = (
  rows: DataRow[],
  column: string,
  aggregation: Aggregation,
): CellValue => {
  const raw = rows.map((row) => row[column])
  const present = raw.filter((value) => !isMissing(value))
  if (aggregation === 'count') return present.length
  if (aggregation === 'nunique') return new Set(present.map((value) => formatCell(value))).size
  if (aggregation === 'first') return present.length ? present[0] : null
  if (aggregation === 'last') return present.length ? present[present.length - 1] : null
  const numeric = present.map((value) => toNumber(value)).filter((value): value is number => value !== null)
  if (!numeric.length) return null
  switch (aggregation) {
    case 'sum': return sum(numeric)
    case 'mean': return mean(numeric)
    case 'median': return median(numeric)
    case 'min': return minOf(numeric)
    case 'max': return maxOf(numeric)
    case 'std': return std(numeric)
    case 'var': return std(numeric) ** 2
    case 'range': {
      const { min, max } = minMax(numeric)
      return max - min
    }
    default: return null
  }
}

/** The column name pandas would produce for a given aggregation, e.g. `Sales_mean`. */
export const aggColumnName = (column: string, aggregation: Aggregation): string =>
  `${column}_${aggregation}`

export const groupByAggregate = (
  rows: DataRow[],
  keys: string[],
  aggs: Array<{ column: string; aggregation: Aggregation }>,
): { rows: DataRow[]; columns: string[] } => {
  if (!keys.length) return { rows, columns: rows.length ? Object.keys(rows[0]) : [] }
  const groups = new Map<string, DataRow[]>()
  rows.forEach((row) => {
    const key = keys.map((column) => formatCell(row[column]) || '(NaN)').join(' | ')
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  })
  const outColumns = [
    ...keys,
    ...(aggs.length ? aggs.map((agg) => aggColumnName(agg.column, agg.aggregation)) : ['count']),
  ]
  const outRows = Array.from(groups.values()).map((items) => {
    const record: DataRow = {}
    keys.forEach((column) => {
      record[column] = items[0][column]
    })
    if (!aggs.length) {
      record.count = items.length
      return record
    }
    aggs.forEach((agg) => {
      record[aggColumnName(agg.column, agg.aggregation)] = aggregateValues(items, agg.column, agg.aggregation)
    })
    return record
  })
  return { rows: outRows, columns: outColumns }
}

/* ------------------------------------------------------------------ *
 * Pivot  (pandas: df.pivot_table)
 * ------------------------------------------------------------------ */

export const pivotTable = (
  rows: DataRow[],
  index: string,
  columns: string,
  values: string,
  aggregation: Aggregation,
): { rows: DataRow[]; columns: string[] } => {
  const columnKeys: string[] = []
  const seen = new Set<string>()
  const buckets = new Map<string, Map<string, DataRow[]>>()
  rows.forEach((row) => {
    const rowKey = formatCell(row[index]) || '(NaN)'
    const columnKey = formatCell(row[columns]) || '(NaN)'
    if (!seen.has(columnKey)) {
      seen.add(columnKey)
      columnKeys.push(columnKey)
    }
    const bucket = buckets.get(rowKey) ?? new Map<string, DataRow[]>()
    const cell = bucket.get(columnKey) ?? []
    cell.push(row)
    bucket.set(columnKey, cell)
    buckets.set(rowKey, bucket)
  })
  columnKeys.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const outColumns = [index, ...columnKeys]
  const outRows: DataRow[] = Array.from(buckets.entries()).map(([rowKey, bucket]) => {
    const record: DataRow = { [index]: rowKey }
    columnKeys.forEach((columnKey) => {
      const cell = bucket.get(columnKey)
      record[columnKey] = cell && cell.length ? aggregateValues(cell, values, aggregation) : null
    })
    return record
  })
  return { rows: outRows, columns: outColumns }
}

/* ------------------------------------------------------------------ *
 * Cross tabulation  (pandas: pd.crosstab)
 * ------------------------------------------------------------------ */

export const crossTab = (
  rows: DataRow[],
  rowField: string,
  columnField: string,
  normalize: 'none' | 'index' | 'columns' | 'all',
): { rows: DataRow[]; columns: string[]; rowTotals: DataRow[] } => {
  const columnKeys: string[] = []
  const seen = new Set<string>()
  const counts = new Map<string, Map<string, number>>()
  rows.forEach((row) => {
    const rowKey = formatCell(row[rowField]) || '(NaN)'
    const columnKey = formatCell(row[columnField]) || '(NaN)'
    if (!seen.has(columnKey)) {
      seen.add(columnKey)
      columnKeys.push(columnKey)
    }
    const bucket = counts.get(rowKey) ?? new Map<string, number>()
    bucket.set(columnKey, (bucket.get(columnKey) ?? 0) + 1)
    counts.set(rowKey, bucket)
  })
  columnKeys.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const grandTotal = rows.length
  const rowTotalsMap = new Map<string, number>()
  counts.forEach((bucket, rowKey) => {
    rowTotalsMap.set(rowKey, Array.from(bucket.values()).reduce((total, value) => total + value, 0))
  })
  const columnTotals = new Map<string, number>()
  columnKeys.forEach((columnKey) => {
    let total = 0
    counts.forEach((bucket) => {
      total += bucket.get(columnKey) ?? 0
    })
    columnTotals.set(columnKey, total)
  })
  const outColumns = [rowField, ...columnKeys, 'All']
  const outRows: DataRow[] = Array.from(counts.entries()).map(([rowKey, bucket]) => {
    const record: DataRow = { [rowField]: rowKey }
    const rowTotal = rowTotalsMap.get(rowKey) ?? 0
    columnKeys.forEach((columnKey) => {
      const raw = bucket.get(columnKey) ?? 0
      let value = raw
      if (normalize === 'index') value = rowTotal ? raw / rowTotal : 0
      else if (normalize === 'columns') value = (columnTotals.get(columnKey) ?? 0) ? raw / (columnTotals.get(columnKey) ?? 1) : 0
      else if (normalize === 'all') value = grandTotal ? raw / grandTotal : 0
      record[columnKey] = Number(value.toFixed(4))
    })
    record.All = normalize === 'none'
      ? rowTotal
      : normalize === 'index' ? 1 : Number(((rowTotal / (grandTotal || 1))).toFixed(4))
    return record
  })
  const totalsRow: DataRow = { [rowField]: 'All' }
  columnKeys.forEach((columnKey) => {
    const total = columnTotals.get(columnKey) ?? 0
    let value: CellValue = total
    if (normalize === 'index') value = grandTotal ? total / grandTotal : 0
    else if (normalize === 'columns') value = 1
    else if (normalize === 'all') value = grandTotal ? total / grandTotal : 0
    totalsRow[columnKey] = typeof value === 'number' ? Number(value.toFixed(4)) : value
  })
  totalsRow.All = normalize === 'none' ? grandTotal : 1
  return { rows: outRows, columns: outColumns, rowTotals: [...outRows, totalsRow] }
}

/* ------------------------------------------------------------------ *
 * Correlation  (pandas: df.corr())
 * ------------------------------------------------------------------ */

export const correlationMatrix = (
  rows: DataRow[],
  columns: string[],
  method: 'pearson' | 'spearman' = 'pearson',
): CorrelationMatrix => {
  const vectors = columns.map((column) =>
    rows.map((row) => toNumber(row[column])),
  )
  // Spearman is Pearson on ranks. Each column is ranked once over its own
  // observed values (the pandas convention; missing entries stay null) instead
  // of re-sorting a column for every one of its pairs — with c columns that
  // turned c*(c-1) sorts into c sorts.
  const series = method === 'spearman'
    ? vectors.map((vector) => {
        const present = vector
          .map((value, index) => ({ value, index }))
          .filter((entry): entry is { value: number; index: number } => entry.value !== null)
        const ordered = ranks(present.map((entry) => entry.value))
        const result: (number | null)[] = new Array(vector.length).fill(null)
        present.forEach((entry, k) => { result[entry.index] = ordered[k] })
        return result
      })
    : vectors
  const matrix = columns.map((_, i) =>
    columns.map((__, j) => {
      if (i === j) return 1
      const left = series[i]
      const right = series[j]
      const pairs: Array<[number, number]> = []
      for (let index = 0; index < rows.length; index += 1) {
        const a = left[index]
        const b = right[index]
        if (a !== null && b !== null) pairs.push([a, b])
      }
      return pearson(pairs)
    }),
  )
  return { columns, matrix }
}

/** Strongest correlations, ranked — handy for a textual "what relates to what" read. */
export const topCorrelations = (
  matrix: CorrelationMatrix,
  limit = 8,
): Array<{ x: string; y: string; value: number }> => {
  const pairs: Array<{ x: string; y: string; value: number }> = []
  for (let i = 0; i < matrix.columns.length; i += 1) {
    for (let j = i + 1; j < matrix.columns.length; j += 1) {
      const value = matrix.matrix[i][j]
      if (value !== null && Number.isFinite(value)) {
        pairs.push({ x: matrix.columns[i], y: matrix.columns[j], value })
      }
    }
  }
  return pairs.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, limit)
}

export const regression = (pairs: Array<[number, number]>): RegressionResult | null => {
  const fit = linearRegression(pairs)
  if (!fit) return null
  const xs = pairs.map((pair) => pair[0])
  const { min, max } = minMax(xs)
  return {
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    n: pairs.length,
    line: [
      [min, fit.intercept + fit.slope * min],
      [max, fit.intercept + fit.slope * max],
    ],
  }
}

/* ------------------------------------------------------------------ *
 * Filtering  (pandas: df.query / boolean indexing)
 * ------------------------------------------------------------------ */

const matchesCondition = (row: DataRow, condition: FilterCondition): boolean => {
  const raw = row[condition.column]
  const text = formatCell(raw).toLowerCase()
  const target = condition.value.trim().toLowerCase()
  const target2 = (condition.value2 ?? '').trim().toLowerCase()
  const numeric = toNumber(raw)
  const numericTarget = toNumber(condition.value)
  const numericTarget2 = toNumber(condition.value2 ?? '')
  switch (condition.operator) {
    case 'contains': return text.includes(target)
    case 'notContains': return !text.includes(target)
    case 'equals': return text === target
    case 'notEquals': return text !== target
    case 'startsWith': return text.startsWith(target)
    case 'endsWith': return text.endsWith(target)
    case 'gt': return numeric !== null && numericTarget !== null && numeric > numericTarget
    case 'gte': return numeric !== null && numericTarget !== null && numeric >= numericTarget
    case 'lt': return numeric !== null && numericTarget !== null && numeric < numericTarget
    case 'lte': return numeric !== null && numericTarget !== null && numeric <= numericTarget
    case 'between':
      return numeric !== null && numericTarget !== null && numericTarget2 !== null
        && numeric >= Math.min(numericTarget, numericTarget2)
        && numeric <= Math.max(numericTarget, numericTarget2)
    case 'isEmpty': return isMissing(raw)
    case 'notEmpty': return !isMissing(raw)
    case 'in': {
      const list = condition.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
      return list.length ? list.includes(text) : true
    }
    case 'notIn': {
      const list = condition.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
      return list.length ? !list.includes(text) : true
    }
    default: return true
  }
}

export const applyFilter = (
  rows: DataRow[],
  conditions: FilterCondition[],
  conjunction: 'and' | 'or',
): DataRow[] => {
  const active = conditions.filter((condition) => condition.column)
  if (!active.length) return rows
  return rows.filter((row) =>
    conjunction === 'and'
      ? active.every((condition) => matchesCondition(row, condition))
      : active.some((condition) => matchesCondition(row, condition)),
  )
}

/** Human-readable form of a filter, used for the pandas code export. */
export const conditionToCode = (condition: FilterCondition): string => {
  const column = `df["${condition.column}"]`
  const value = condition.value.trim()
  switch (condition.operator) {
    case 'contains': return `${column}.str.contains("${value}", case=False, na=False)`
    case 'notContains': return `~${column}.str.contains("${value}", case=False, na=False)`
    case 'equals': return `${column} == "${value}"`
    case 'notEquals': return `${column} != "${value}"`
    case 'startsWith': return `${column}.str.startswith("${value}", na=False)`
    case 'endsWith': return `${column}.str.endswith("${value}", na=False)`
    case 'gt': return `${column} > ${value || 0}`
    case 'gte': return `${column} >= ${value || 0}`
    case 'lt': return `${column} < ${value || 0}`
    case 'lte': return `${column} <= ${value || 0}`
    case 'between': return `${column}.between(${value || 0}, ${condition.value2 || 0})`
    case 'isEmpty': return `${column}.isna()`
    case 'notEmpty': return `${column}.notna()`
    case 'in': return `${column}.isin([${value.split(',').map((item) => `"${item.trim()}"`).join(', ')}])`
    case 'notIn': return `~${column}.isin([${value.split(',').map((item) => `"${item.trim()}"`).join(', ')}])`
    default: return 'True'
  }
}

/* ------------------------------------------------------------------ *
 * Sorting  (pandas: df.sort_values)
 * ------------------------------------------------------------------ */

export const sortRows = (
  rows: DataRow[],
  keys: Array<{ column: string; direction: 'asc' | 'desc' }>,
): DataRow[] => {
  if (!keys.length) return rows
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const left = a[key.column]
      const right = b[key.column]
      const leftMissing = isMissing(left)
      const rightMissing = isMissing(right)
      // pandas always places NaN last regardless of direction
      if (leftMissing && rightMissing) continue
      if (leftMissing) return 1
      if (rightMissing) return -1
      const leftNumber = toNumber(left)
      const rightNumber = toNumber(right)
      let comparison: number
      if (leftNumber !== null && rightNumber !== null) comparison = leftNumber - rightNumber
      else comparison = formatCell(left).localeCompare(formatCell(right), 'en', { numeric: true, sensitivity: 'base' })
      if (comparison !== 0) return key.direction === 'asc' ? comparison : -comparison
    }
    return 0
  })
}

/* ------------------------------------------------------------------ *
 * Row set helpers
 * ------------------------------------------------------------------ */

export const rowKey = (row: DataRow, columns: string[]): string =>
  columns.map((column) => `${formatCell(row[column])}\u0001`).join('\u0002')

export const countDuplicates = (rows: DataRow[], subset?: string[]): number => {
  const columns = subset && subset.length ? subset : rows.length ? Object.keys(rows[0]) : []
  const seen = new Set<string>()
  let duplicates = 0
  rows.forEach((row) => {
    const key = rowKey(row, columns)
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  })
  return duplicates
}

export interface FrameQuality {
  missing: number
  duplicates: number
}

/** Missing cells plus duplicate rows — cached per frame by callers so chart
    reconfigurations do not rescan unchanged data. */
export const measureQuality = (frame: { rows: DataRow[]; columns: string[] }): FrameQuality => ({
  missing: frame.rows.reduce(
    (total, row) => total + frame.columns.reduce((sum, column) => sum + (isMissing(row[column]) ? 1 : 0), 0),
    0,
  ),
  duplicates: countDuplicates(frame.rows),
})

export interface OutlierBounds {
  low: number
  high: number
  center: number
  indexes: number[]
}

/** Shared IQR / z-score detector used by EDA, cleaning and generated code. */
export const detectOutliers = (
  rows: DataRow[],
  column: string,
  method: 'iqr' | 'zscore' = 'iqr',
  threshold = method === 'iqr' ? 1.5 : 3,
): OutlierBounds => {
  const values = rows.map((row) => toNumber(row[column])).filter((value): value is number => value !== null)
  if (!values.length) return { low: 0, high: 0, center: 0, indexes: [] }
  const center = median(values)
  let low: number
  let high: number
  if (method === 'zscore') {
    const avg = mean(values)
    const spread = std(values)
    low = avg - threshold * spread
    high = avg + threshold * spread
  } else {
    const ordered = sorted(values)
    const q1 = quantile(ordered, 0.25)
    const q3 = quantile(ordered, 0.75)
    const iqr = q3 - q1
    low = q1 - threshold * iqr
    high = q3 + threshold * iqr
  }
  const indexes = rows.reduce<number[]>((result, row, index) => {
    const value = toNumber(row[column])
    if (value !== null && (value < low || value > high)) result.push(index)
    return result
  }, [])
  return { low, high, center, indexes }
}

export const dropDuplicates = (rows: DataRow[], subset?: string[]): DataRow[] => {
  const columns = subset && subset.length ? subset : rows.length ? Object.keys(rows[0]) : []
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = rowKey(row, columns)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const dropna = (rows: DataRow[], columns: string[], how: 'any' | 'all'): DataRow[] => {
  const fields = columns.length ? columns : rows.length ? Object.keys(rows[0]) : []
  return rows.filter((row) => {
    const missing = fields.filter((column) => isMissing(row[column])).length
    return how === 'any' ? missing === 0 : missing !== fields.length
  })
}

export const fillna = (
  rows: DataRow[],
  column: string,
  strategy: 'mean' | 'median' | 'mode' | 'zero' | 'constant' | 'ffill' | 'bfill' | 'interpolate',
  value: string,
): DataRow[] => {
  const numeric = rows.map((row) => toNumber(row[column])).filter((item): item is number => item !== null)
  let constant: CellValue = value
  if (strategy === 'mean') constant = mean(numeric)
  else if (strategy === 'median') constant = median(numeric)
  else if (strategy === 'zero') constant = 0
  else if (strategy === 'mode') {
    const counts = new Map<string, number>()
    rows.forEach((row) => {
      if (isMissing(row[column])) return
      const key = formatCell(row[column])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
    constant = best ? best[0] : null
  }
  if (strategy === 'ffill' || strategy === 'bfill') {
    const out = rows.map((row) => ({ ...row }))
    const order = strategy === 'ffill'
      ? Array.from({ length: out.length }, (_, index) => index)
      : Array.from({ length: out.length }, (_, index) => out.length - 1 - index)
    let last: CellValue = null
    order.forEach((index) => {
      const current = out[index][column]
      if (isMissing(current)) {
        if (!isMissing(last)) out[index][column] = last
      } else last = current
    })
    return out
  }
  if (strategy === 'interpolate') {
    const out = rows.map((row) => ({ ...row }))
    const known: number[] = []
    out.forEach((row, index) => {
      const parsed = toNumber(row[column])
      if (parsed !== null) known.push(index)
    })
    for (let cursor = 0; cursor < known.length - 1; cursor += 1) {
      const start = known[cursor]
      const end = known[cursor + 1]
      const startValue = toNumber(out[start][column]) ?? 0
      const endValue = toNumber(out[end][column]) ?? 0
      for (let index = start + 1; index < end; index += 1) {
        const weight = (index - start) / (end - start)
        out[index][column] = Number((startValue + (endValue - startValue) * weight).toFixed(4))
      }
    }
    return out
  }
  return rows.map((row) => (isMissing(row[column]) ? { ...row, [column]: constant } : row))
}

export const castColumn = (rows: DataRow[], column: string, to: DataType): DataRow[] =>
  rows.map((row) => {
    const value = row[column]
    if (isMissing(value)) return row
    if (to === 'number') return { ...row, [column]: toNumber(value) }
    if (to === 'boolean') {
      const parsed = typeof value === 'boolean' ? value : ['true', '1', 'yes', 'y', 't'].includes(String(value).trim().toLowerCase())
      return { ...row, [column]: parsed }
    }
    return { ...row, [column]: formatCell(value) }
  })

/* ------------------------------------------------------------------ *
 * Joins  (pandas: pd.merge)
 * ------------------------------------------------------------------ */

export const joinFrames = (
  left: DataRow[],
  right: DataRow[],
  leftOn: string,
  rightOn: string,
  how: 'inner' | 'left' | 'right' | 'outer',
  suffix: string,
): DataRow[] => {
  const rightIndex = new Map<string, DataRow[]>()
  right.forEach((row) => {
    const key = formatCell(row[rightOn])
    const bucket = rightIndex.get(key)
    if (bucket) bucket.push(row)
    else rightIndex.set(key, [row])
  })
  const leftColumns = left.length ? Object.keys(left[0]) : []
  const rightColumns = right.length ? Object.keys(right[0]) : []
  const overlapping = new Set(rightColumns.filter((column) => column !== rightOn && leftColumns.includes(column)))
  const out: DataRow[] = []
  const matchedRightKeys = new Set<string>()
  left.forEach((leftRow) => {
    const key = formatCell(leftRow[leftOn])
    const matches = rightIndex.get(key) ?? []
    if (matches.length) matchedRightKeys.add(key)
    if (!matches.length && (how === 'left' || how === 'outer')) {
      const record: DataRow = { ...leftRow }
      rightColumns.forEach((column) => {
        if (column === rightOn) return
        record[overlapping.has(column) ? `${column}${suffix}` : column] = null
      })
      out.push(record)
      return
    }
    matches.forEach((rightRow) => {
      const record: DataRow = { ...leftRow }
      rightColumns.forEach((column) => {
        if (column === rightOn) return
        record[overlapping.has(column) ? `${column}${suffix}` : column] = rightRow[column]
      })
      out.push(record)
    })
  })
  if (how === 'right' || how === 'outer') {
    right.forEach((rightRow) => {
      const key = formatCell(rightRow[rightOn])
      if (matchedRightKeys.has(key)) return
      const record: DataRow = {}
      leftColumns.forEach((column) => {
        record[column] = column === leftOn ? rightRow[rightOn] : null
      })
      rightColumns.forEach((column) => {
        if (column === rightOn) return
        record[overlapping.has(column) ? `${column}${suffix}` : column] = rightRow[column]
      })
      out.push(record)
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Melting  (pandas: df.melt)
 * ------------------------------------------------------------------ */

export const meltRows = (
  rows: DataRow[],
  idVars: string[],
  valueVars: string[],
  varName: string,
  valueName: string,
): DataRow[] =>
  rows.flatMap((row) =>
    valueVars.map((column) => {
      const record: DataRow = {}
      idVars.forEach((id) => {
        record[id] = row[id]
      })
      record[varName] = column
      record[valueName] = row[column]
      return record
    }),
  )

/* ------------------------------------------------------------------ *
 * Numeric column transforms
 * ------------------------------------------------------------------ */

export const cumulative = (
  rows: DataRow[],
  column: string,
  method: 'cumsum' | 'cummax' | 'cummin' | 'cumprod',
): DataRow[] => {
  let running: number | null = null
  return rows.map((row) => {
    const value = toNumber(row[column])
    if (value === null) return row
    if (running === null) running = method === 'cumprod' ? value : value
    else if (method === 'cumsum') running += value
    else if (method === 'cumprod') running *= value
    else if (method === 'cummax') running = Math.max(running, value)
    else running = Math.min(running, value)
    return { ...row, [column]: Number(running.toFixed(6)) }
  })
}

export const pctChange = (rows: DataRow[], column: string, periods: number): DataRow[] => {
  const series = rows.map((row) => toNumber(row[column]))
  return rows.map((row, index) => {
    if (index < periods) return { ...row, [column]: null }
    const previous = series[index - periods]
    const current = series[index]
    if (previous === null || current === null || previous === 0) return { ...row, [column]: null }
    return { ...row, [column]: Number((current / previous - 1).toFixed(6)) }
  })
}

export const shiftColumn = (rows: DataRow[], column: string, periods: number): DataRow[] =>
  rows.map((row, index) => {
    const source = index - periods
    if (source < 0 || source >= rows.length) return { ...row, [column]: null }
    return { ...row, [column]: rows[source][column] }
  })

export const rankColumn = (
  rows: DataRow[],
  column: string,
  method: 'average' | 'min' | 'max' | 'dense' | 'ordinal',
  ascending: boolean,
): DataRow[] => {
  const entries = rows
    .map((row, index) => ({ index, value: toNumber(row[column]) }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null)
  const ordered = [...entries].sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
  const rankValues = new Map<number, number>()
  let position = 0
  let denseRank = 0
  while (position < ordered.length) {
    let end = position
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[position].value) end += 1
    const averageRank = (position + end) / 2 + 1
    const minRank = position + 1
    const maxRank = end + 1
    denseRank += 1
    for (let cursor = position; cursor <= end; cursor += 1) {
      const target = ordered[cursor].index
      if (method === 'average') rankValues.set(target, averageRank)
      else if (method === 'min') rankValues.set(target, minRank)
      else if (method === 'max') rankValues.set(target, maxRank)
      else if (method === 'dense') rankValues.set(target, denseRank)
      else rankValues.set(target, cursor + 1)
    }
    position = end + 1
  }
  return rows.map((row, index) => ({
    ...row,
    [column]: rankValues.has(index) ? rankValues.get(index)! : null,
  }))
}

export const rolling = (
  rows: DataRow[],
  column: string,
  window: number,
  aggregation: 'mean' | 'sum' | 'max' | 'min' | 'std',
): DataRow[] => {
  const series = rows.map((row) => toNumber(row[column]))
  return rows.map((row, index) => {
    if (index + 1 < window) return { ...row, [column]: null }
    const slice = series.slice(index + 1 - window, index + 1).filter((value): value is number => value !== null)
    if (slice.length < window) return { ...row, [column]: null }
    let result: number
    if (aggregation === 'mean') result = mean(slice)
    else if (aggregation === 'sum') result = sum(slice)
    else if (aggregation === 'max') result = maxOf(slice)
    else if (aggregation === 'min') result = minOf(slice)
    else result = std(slice)
    return { ...row, [column]: Number(result.toFixed(6)) }
  })
}

export const clipColumn = (rows: DataRow[], column: string, lower: string, upper: string): DataRow[] => {
  const low = toNumber(lower)
  const high = toNumber(upper)
  return rows.map((row) => {
    const value = toNumber(row[column])
    if (value === null) return row
    let next = value
    if (low !== null) next = Math.max(next, low)
    if (high !== null) next = Math.min(next, high)
    return { ...row, [column]: next }
  })
}

/** Equal-frequency binning (pandas: pd.qcut). */
export const qcut = (rows: DataRow[], column: string, bins: number, labels: string): DataRow[] => {
  const entries = rows
    .map((row, index) => ({ index, value: toNumber(row[column]) }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null)
  if (!entries.length) return rows
  const ordered = [...entries].sort((a, b) => a.value - b.value)
  const values = ordered.map((entry) => entry.value)
  const boundaries = Array.from({ length: bins - 1 }, (_, index) => quantile(values, (index + 1) / bins))
  const labelList = labels.split(',').map((item) => item.trim()).filter(Boolean)
  const assignment = new Map<number, string>()
  ordered.forEach((entry) => {
    let bucket = boundaries.findIndex((boundary) => entry.value <= boundary)
    if (bucket === -1) bucket = bins - 1
    const name = labelList[bucket] ?? `Q${bucket + 1}`
    assignment.set(entry.index, name)
  })
  return rows.map((row, index) => ({
    ...row,
    [`${column}_bins`]: assignment.has(index) ? assignment.get(index)! : null,
  }))
}

/* ------------------------------------------------------------------ *
 * Category encoding
 * ------------------------------------------------------------------ */

export const oneHotEncode = (rows: DataRow[], column: string): DataRow[] => {
  const categories = topValues(rows, column, Number.MAX_SAFE_INTEGER).map((item) => item.value)
  const prefix = truncate(column, 14)
  return rows.map((row) => {
    const current = formatCell(row[column])
    const record: DataRow = { ...row }
    categories.forEach((category) => {
      record[`${prefix}=${truncate(category, 18)}`] = current === category ? 1 : 0
    })
    return record
  })
}

/* ------------------------------------------------------------------ *
 * Formula engine for df.assign()
 * ------------------------------------------------------------------ */

// Each helper receives ordinary spread arguments (`round(Sales, 2)`), matching the
// `__F.name(...)` call shape produced by evaluateFormula — never a packed array.
// min/max use reductions (not Math.min(...args)) to stay safe even on long argument lists.
const FORMULA_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: (x) => Math.abs(x),
  round: (x, digits = 0) => Number(x.toFixed(digits)),
  sqrt: (x) => Math.sqrt(x),
  log: (x) => Math.log(x),
  exp: (x) => Math.exp(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  min: (...args) => args.reduce((low, value) => (value < low ? value : low), Infinity),
  max: (...args) => args.reduce((high, value) => (value > high ? value : high), -Infinity),
  pow: (x, y) => x ** y,
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  sign: (x) => Math.sign(x),
}

export const FORMULA_FUNCTION_NAMES = Object.keys(FORMULA_FUNCTIONS)

/** Validates a formula and reports an unknown bare identifier, if any. */
export const validateFormula = (formula: string, columns: string[]): { ok: boolean; unknown?: string } => {
  // Drop bracketed column names first (`[Unit Price]`) so their inner words are not
  // mistaken for unknown identifiers.
  const withoutBrackets = formula.replace(/\[[^\]]*\]/g, ' ')
  const stripped = withoutBrackets.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*(?=\()/g, (match) => {
    const name = match.trim().slice(0, -1)
    return FORMULA_FUNCTIONS[name] ? '__FN__' : match
  })
  const identifiers = stripped.match(/[a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*/g) ?? []
  const known = new Set([
    ...columns, ...Object.keys(FORMULA_FUNCTIONS),
    'true', 'false', 'null', 'NaN', 'Infinity', 'e', 'pi', 'PI', 'E',
  ])
  const unknown = identifiers.find((identifier) => !known.has(identifier) && identifier !== '__FN__')
  return unknown ? { ok: false, unknown } : { ok: true }
}

/**
 * Evaluate a spreadsheet-style formula per row.
 * Column names may be bare (`Sales`) or bracketed (`[Unit Price]`) so that names
 * containing spaces still work; `+ - * / %` and comparisons are supported.
 */
export const evaluateFormula = (formula: string, row: DataRow, columns: string[]): CellValue => {
  let expression = formula.trim()
  if (!expression) return null
  try {
    // Bracket syntax first so column names with spaces survive.
    expression = expression.replace(/\[([^\]]+)\]/g, (_, name: string) => {
      const column = columns.find((item) => item === name.trim())
      return column ? `__V(${JSON.stringify(column)})` : 'NaN'
    })
    Object.keys(FORMULA_FUNCTIONS).forEach((name) => {
      expression = expression.replace(new RegExp(`\\b${name}\\s*\\(`, 'g'), `__F.${name}(`)
    })

    // Bare column names, longest first so `UnitPrice` never shadows `Unit`.
    const bare = [...columns].sort((a, b) => b.length - a.length)
    bare.forEach((column) => {
      if (!/^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*$/.test(column)) return
      const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expression = expression.replace(new RegExp(`(?<![\\w.$])${escaped}(?![\\w$])`, 'g'), `__V(${JSON.stringify(column)})`)
    })
    const helper = new Function(
      '__V', '__F', 'Math',
      `"use strict"; return (${expression});`,
    ) as (v: (name: string) => unknown, f: Record<string, (...args: number[]) => number>, m: typeof Math) => unknown
    const referenced = (name: string) => {
      const value = row[name]
      if (isMissing(value)) return NaN
      const numeric = toNumber(value)
      return numeric === null ? NaN : numeric
    }
    const result = helper(referenced, FORMULA_FUNCTIONS, Math)
    if (typeof result === 'number') return Number.isFinite(result) ? Number(result.toFixed(6)) : null
    if (typeof result === 'boolean') return result
    if (result === null || result === undefined) return null
    return String(result)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Sample size helpers
 * ------------------------------------------------------------------ */

export const sampleRows = (rows: DataRow[], size: number, withReplacement: boolean): DataRow[] => {
  if (!rows.length) return rows
  const target = Math.max(1, Math.min(withReplacement ? size : rows.length, size))
  if (withReplacement) {
    return Array.from({ length: target }, () => rows[Math.floor(Math.random() * rows.length)])
  }
  const pool = [...rows]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const temp = pool[index]
    pool[index] = pool[swap]
    pool[swap] = temp
  }
  return pool.slice(0, target)
}

export const transposeRows = (rows: DataRow[], columns: string[]): { rows: DataRow[]; columns: string[] } => {
  if (!rows.length) return { rows: [], columns: [] }
  const outColumns = ['field', ...rows.map((_, index) => `row_${index}`)]
  const outRows: DataRow[] = columns.map((column) => {
    const record: DataRow = { field: column }
    rows.forEach((row, index) => {
      record[`row_${index}`] = row[column]
    })
    return record
  })
  return { rows: outRows, columns: outColumns }
}

export const newCondition = (column: string): FilterCondition => ({
  id: uid('cond'),
  column,
  operator: 'contains',
  value: '',
})
