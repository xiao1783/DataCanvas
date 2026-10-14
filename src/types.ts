export type CellValue = string | number | boolean | null
export type DataRow = Record<string, CellValue>
export type Language = 'zh' | 'en'
export type Theme = 'light' | 'dark'
export type DataType = 'number' | 'date' | 'boolean' | 'text'

/* ------------------------------------------------------------------ *
 * Column metadata
 * ------------------------------------------------------------------ */

export interface ColumnProfile {
  name: string
  type: DataType
  /** non-missing values */
  count: number
  missing: number
  missingRatio: number
  unique: number
  /** numeric-only statistics */
  mean?: number
  std?: number
  min?: number
  q1?: number
  median?: number
  q3?: number
  max?: number
  sum?: number
  skew?: number
  /** text/date extremes */
  minLabel?: string
  maxLabel?: string
  /** most frequent values, for a quick categorical read */
  topValues: Array<{ value: string; count: number }>
  /** small histogram used by the overview sparkline */
  histogram: number[]
}

export interface SummaryStats {
  count: number
  missing: number
  mean: number
  std: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  sum: number
  skew: number
  kurtosis: number
  range: number
  iqr: number
  cv: number
}

export interface CorrelationMatrix {
  columns: string[]
  /** matrix[i][j] correlates columns[i] with columns[j] */
  matrix: Array<Array<number | null>>
}

export interface RegressionResult {
  slope: number
  intercept: number
  r2: number
  n: number
  /** sampled points of the fitted line, in axis coordinates */
  line: Array<[number, number]>
}

/* ------------------------------------------------------------------ *
 * Pipeline: every user action becomes a typed, replayable operation
 * ------------------------------------------------------------------ */

export type FilterOperator =
  | 'contains' | 'notContains' | 'equals' | 'notEquals'
  | 'startsWith' | 'endsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'isEmpty' | 'notEmpty'
  | 'in' | 'notIn'

export interface FilterCondition {
  id: string
  column: string
  operator: FilterOperator
  value: string
  value2?: string
}

export type SortDirection = 'asc' | 'desc'

export interface SortKey {
  id: string
  column: string
  direction: SortDirection
}

export type Aggregation =
  | 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count'
  | 'nunique' | 'std' | 'var' | 'first' | 'last' | 'range'

export interface GroupAgg {
  id: string
  column: string
  aggregation: Aggregation
}

export type FillStrategy =
  | 'mean' | 'median' | 'mode' | 'zero' | 'constant'
  | 'ffill' | 'bfill' | 'interpolate'

export interface JoinSpec {
  rightName: string
  rightRows: DataRow[]
  leftOn: string
  rightOn: string
  how: 'inner' | 'left' | 'right' | 'outer'
  suffix: string
}

export type Op =
  | { kind: 'filter'; conditions: FilterCondition[]; conjunction: 'and' | 'or' }
  | { kind: 'sort'; keys: SortKey[] }
  | { kind: 'selectColumns'; columns: string[] }
  | { kind: 'dropColumns'; columns: string[] }
  | { kind: 'renameColumn'; from: string; to: string }
  | { kind: 'castColumn'; column: string; to: DataType }
  | { kind: 'dropna'; columns: string[]; how: 'any' | 'all' }
  | { kind: 'fillna'; column: string; strategy: FillStrategy; value: string }
  | { kind: 'dropDuplicates'; subset: string[] }
  | { kind: 'groupby'; keys: string[]; aggs: GroupAgg[] }
  | { kind: 'pivot'; index: string; columns: string; values: string; aggregation: Aggregation }
  | { kind: 'crosstab'; row: string; col: string; normalize: 'none' | 'index' | 'columns' | 'all' }
  | { kind: 'join'; spec: JoinSpec }
  | { kind: 'concat'; sourceName: string; rows: DataRow[] }
  | { kind: 'assign'; name: string; formula: string }
  | { kind: 'valueCounts'; column: string }
  | { kind: 'cumulative'; column: string; method: 'cumsum' | 'cummax' | 'cummin' | 'cumprod' }
  | { kind: 'pctChange'; column: string; periods: number }
  | { kind: 'shift'; column: string; periods: number }
  | { kind: 'rank'; column: string; method: 'average' | 'min' | 'max' | 'dense' | 'ordinal'; ascending: boolean }
  | { kind: 'rolling'; column: string; window: number; aggregation: 'mean' | 'sum' | 'max' | 'min' | 'std' }
  | { kind: 'clip'; column: string; lower: string; upper: string }
  | { kind: 'outliers'; column: string; method: 'iqr' | 'zscore'; threshold: number; action: 'drop' | 'clip' | 'median' }
  | { kind: 'qcut'; column: string; bins: number; labels: string }
  | { kind: 'textOp'; column: string; operation: 'upper' | 'lower' | 'title' | 'trim' | 'strip' | 'length' | 'substring'; start: number; end: number }
  | { kind: 'textReplace'; column: string; find: string; replace: string; regex: boolean }
  | { kind: 'textContains'; column: string; pattern: string; newColumn: string }
  | { kind: 'textSplit'; column: string; separator: string; part: number }
  | { kind: 'concatColumns'; columns: string[]; separator: string; newColumn: string }
  | { kind: 'datePart'; column: string; part: 'year' | 'month' | 'day' | 'quarter' | 'weekday' | 'week' | 'ym'; newColumn: string }
  | { kind: 'dateDiff'; column: string; other: string; unit: 'days' | 'weeks' | 'months'; newColumn: string }
  | { kind: 'sample'; size: number; withReplacement: boolean }
  | { kind: 'keepRows'; rows: DataRow[]; reason: string }
  | { kind: 'head'; n: number }
  | { kind: 'transpose' }
  | { kind: 'melt'; idVars: string[]; valueVars: string[]; varName: string; valueName: string }
  | { kind: 'resetIndex' }
  | { kind: 'describe' }
  | { kind: 'corr' }
  | { kind: 'dropConstant' }

export interface PipelineStep {
  id: string
  op: Op
  labelZh: string
  labelEn: string
  /** the pandas equivalent, shown in the UI and the exported script */
  code: string
  enabled: boolean
  at: number
}

export interface DataFrame {
  columns: string[]
  rows: DataRow[]
  /** inferred dtype per column, for display and operation hints */
  types: Record<string, DataType>
}
