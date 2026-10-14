/**
 * Sensible default field selection.
 *
 * Picking `columns[0]` is technically valid but lands on an identifier like
 * `OrderID`, which makes a filter or a chart look broken. These helpers prefer
 * the columns a human would reach for first, then fall back progressively.
 */

export interface ColumnDefaults {
  /** a low-cardinality text column — good for grouping, filtering and chart axes */
  dimension: string
  /** a second, different dimension for pivots and cross tabs */
  secondDimension: string
  /** the headline numeric measure */
  measure: string
  /** a second numeric measure, for scatter/bubble axes */
  secondMeasure: string
  /** a date column, if the dataset has one */
  date: string
  /** every text-ish column, best-first */
  dimensions: string[]
}

const DIMENSION_PREFERENCE = [
  'Category', 'Region', 'Segment', 'Channel', 'Product', 'Department', 'Type',
  'Group', 'Class', 'Status', 'City', 'Country', 'State', 'Store', 'Team',
]

const MEASURE_PREFERENCE = [
  'Sales', 'Revenue', 'Amount', 'Profit', 'Total', 'Quantity', 'Price',
  'Score', 'Value', 'Cost', 'Count',
]

const DATE_PREFERENCE = ['Date', 'OrderDate', 'CreatedAt', 'Timestamp', 'Month', 'Time']

const DEPrioritise = /(^|_)(id|key|code|uuid|guid|index)$/i

const rank = (columns: string[], preferred: string[], typeTest: (column: string) => boolean): string[] => {
  const pool = columns.filter(typeTest)
  const preferredHits = preferred
    .map((name) => pool.find((column) => column.toLowerCase() === name.toLowerCase()))
    .filter((column): column is string => !!column)
  const rest = pool
    .filter((column) => !preferredHits.includes(column))
    // Identifier-looking columns go last: they are unique per row and make
    // useless grouping keys.
    .sort((a, b) => Number(DEPrioritise.test(a)) - Number(DEPrioritise.test(b)))
  return [...preferredHits, ...rest]
}

export const deriveColumnDefaults = (
  columns: string[],
  types: Record<string, string>,
): ColumnDefaults => {
  const isText = (column: string) => types[column] === 'text' || types[column] === 'boolean'
  const isNumber = (column: string) => types[column] === 'number'
  const isDate = (column: string) => types[column] === 'date'

  const dimensions = rank(columns, DIMENSION_PREFERENCE, isText)
  const measures = rank(columns, MEASURE_PREFERENCE, isNumber)
  const dates = rank(columns, DATE_PREFERENCE, isDate)

  return {
    dimension: dimensions[0] ?? columns[0] ?? '',
    secondDimension: dimensions[1] ?? dimensions[0] ?? columns[0] ?? '',
    measure: measures[0] ?? '',
    secondMeasure: measures[1] ?? measures[0] ?? '',
    date: dates[0] ?? '',
    dimensions,
  }
}
