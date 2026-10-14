import type { EChartsOption } from 'echarts'
import type { Aggregation, DataRow, DataType, Language, Theme } from './types'
import type { MessageKey as Key } from './i18n'
import { aggregationLabels } from './i18n'
import { correlationMatrix, groupByAggregate, regression } from './analysis'
import { formatNumber, isMissing, maxOf, minMax, minOf, quantile, toNumber } from './utils'

export type ChartType =
  | 'bar' | 'barGrouped' | 'barStacked' | 'line' | 'area' | 'pie' | 'scatter' | 'bubble'
  | 'histogram' | 'box' | 'heatmap' | 'radar' | 'treemap' | 'funnel' | 'gauge'
  | 'sankey' | 'sunburst' | 'parallel' | 'splom'

export const CHART_TYPES: ChartType[] = [
  'bar', 'barGrouped', 'barStacked', 'line', 'area', 'pie', 'scatter', 'bubble',
  'histogram', 'box', 'heatmap', 'radar', 'treemap', 'funnel', 'gauge',
  'sankey', 'sunburst', 'parallel', 'splom',
]

/** Which field pickers a given chart type actually needs. */
export interface ChartNeeds {
  x: boolean
  y: boolean
  series: boolean
  size: boolean
}

export const chartNeeds: Record<ChartType, ChartNeeds> = {
  bar: { x: true, y: true, series: false, size: false },
  barGrouped: { x: true, y: true, series: true, size: false },
  barStacked: { x: true, y: true, series: true, size: false },
  line: { x: true, y: true, series: false, size: false },
  area: { x: true, y: true, series: false, size: false },
  pie: { x: true, y: true, series: false, size: false },
  funnel: { x: true, y: true, series: false, size: false },
  treemap: { x: true, y: true, series: false, size: false },
  scatter: { x: true, y: true, series: false, size: false },
  bubble: { x: true, y: true, series: true, size: true },
  histogram: { x: true, y: false, series: false, size: false },
  box: { x: true, y: true, series: false, size: false },
  heatmap: { x: true, y: true, series: true, size: false },
  radar: { x: true, y: true, series: false, size: false },
  gauge: { x: false, y: true, series: false, size: false },
  // sankey: X = source dimension, series = target dimension, Y = flow value
  sankey: { x: true, y: true, series: true, size: false },
  // sunburst: X = outer level, series = optional inner level, Y = size value
  sunburst: { x: true, y: true, series: true, size: false },
  // parallel: series = colour/category field; the numeric axes are picked automatically
  parallel: { x: false, y: false, series: true, size: false },
  // splom: fully automatic — every numeric column pairs against the others
  splom: { x: false, y: false, series: false, size: false },
}

export interface ChartConfig {
  type: ChartType
  x: string
  y: string
  series: string
  size: string
  aggregation: Aggregation
  title: string
  showLegend: boolean
  showLabels: boolean
  showGrid: boolean
  smooth: boolean
  trendline: boolean
  sortCategories: boolean
  horizontal: boolean
  topN: number
  bins: number
}

export const defaultChartConfig = (columns: string[], numericColumns: string[], types: Record<string, DataType>): ChartConfig => {
  const categorical = columns.filter((column) => types[column] !== 'number')
  const preferredX = ['Category', 'Region', 'Product', 'Segment', 'Channel']
    .find((name) => categorical.includes(name)) ?? categorical[0] ?? columns[0] ?? ''
  const preferredY = ['Sales', 'Profit', 'Quantity', 'UnitPrice']
    .find((name) => numericColumns.includes(name)) ?? numericColumns[0] ?? ''
  const preferredSeries = ['Region', 'Channel', 'Segment']
    .find((name) => categorical.includes(name) && name !== preferredX)
    ?? categorical.find((name) => name !== preferredX) ?? ''
  return {
    type: 'bar',
    x: preferredX,
    y: preferredY,
    series: preferredSeries,
    size: '',
    aggregation: preferredY === 'Sales' ? 'sum' : 'mean',
    title: '',
    showLegend: true,
    showLabels: false,
    showGrid: true,
    smooth: true,
    trendline: true,
    sortCategories: true,
    horizontal: false,
    topN: 12,
    bins: 16,
  }
}

/** Extra computed read-outs shown next to the chart. */
export interface ChartOptionResult {
  option: EChartsOption
  /** row index in `frame.rows` for every plotted point, in plot order */
  sourceOrder: number[]
  /** computed read-outs shown under the chart */
  facts: Array<{ label: Key | string; value: string; hint?: string }>
  /** true when the chart type has nothing to draw */
  empty: boolean
  /** colour-range legend for heat maps, when the values vary */
  colorRange?: { min: number; max: number } | null
}

/* ------------------------------------------------ chart theme tokens */

export interface ChartThemeTokens {
  palette: string[]
  axisLabel: string
  axisLine: string
  splitLine: string
  tooltipBg: string
  tooltipBorder: string
  tooltipFg: string
  heatColors: [string, string, string, string, string]
  corrColors: [string, string, string, string, string]
  gaugeTrack: string
  gaugeSplit: string
  markLine: string
  boxFill: string
  tileBorder: string
  regression: string
}

export const CHART_THEMES: Record<Theme, ChartThemeTokens> = {
  light: {
    palette: [
      '#155EEF', '#C7F000', '#0B42B8', '#5B7FFF', '#00A37A',
      '#F08C46', '#667085', '#88B000', '#4B61D1', '#E5484D',
    ],
    axisLabel: '#5d6b85',
    axisLine: 'rgba(120,140,170,.35)',
    splitLine: 'rgba(120,140,170,.18)',
    tooltipBg: '#ffffff',
    tooltipBorder: '#dce8f2',
    tooltipFg: '#1b2b41',
    heatColors: ['#F2F4F7', '#C9D8FF', '#6C92F8', '#155EEF', '#0B2F76'],
    corrColors: ['#0B42B8', '#6C92F8', '#F7F8FA', '#D5F45B', '#88A800'],
    gaugeTrack: 'rgba(120,140,170,.22)',
    gaugeSplit: 'rgba(120,140,170,.5)',
    markLine: '#667085',
    boxFill: 'rgba(21,94,239,.12)',
    tileBorder: 'rgba(255,255,255,.5)',
    regression: '#C7F000',
  },
  dark: {
    palette: [
      '#4F8FFF', '#C7F000', '#7AA4FF', '#8FB4FF', '#2FD3A1',
      '#F5A45E', '#9AA8C2', '#A8D63A', '#7B92F0', '#F07075',
    ],
    axisLabel: '#93a6c4',
    axisLine: 'rgba(150,180,220,.28)',
    splitLine: 'rgba(150,180,220,.12)',
    tooltipBg: '#15243c',
    tooltipBorder: '#2c4063',
    tooltipFg: '#e7eef8',
    heatColors: ['#1C2B45', '#1E3F7A', '#2E68D8', '#4F8FFF', '#BFD6FF'],
    corrColors: ['#2E68D8', '#3E78E8', '#1C2B45', '#9AC44A', '#C7F000'],
    gaugeTrack: 'rgba(150,180,220,.18)',
    gaugeSplit: 'rgba(150,180,220,.42)',
    markLine: '#9AA8C2',
    boxFill: 'rgba(79,143,255,.22)',
    tileBorder: 'rgba(180,205,240,.18)',
    regression: '#C7F000',
  },
}

const baseGrid = { top: 34, right: 24, bottom: 46, left: 62, containLabel: true }

const tooltipBase = (ct: ChartThemeTokens) => ({
  backgroundColor: ct.tooltipBg,
  borderColor: ct.tooltipBorder,
  borderWidth: 1,
  textStyle: { fontSize: 12, color: ct.tooltipFg },
})

const axisStyle = (ct: ChartThemeTokens) => ({
  axisLine: { lineStyle: { color: ct.axisLine } },
  axisLabel: { fontSize: 11, color: ct.axisLabel },
  splitLine: { lineStyle: { color: ct.splitLine } },
})

const commonOption = (config: ChartConfig, msg: (key: Key) => string, ct: ChartThemeTokens): EChartsOption => ({
  color: ct.palette,
  animationDuration: 420,
  textStyle: { fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' },
  title: config.title ? { text: config.title, left: 0, top: 0, textStyle: { fontSize: 14, fontWeight: 600 } } : undefined,
  tooltip: { trigger: 'item', confine: true, ...tooltipBase(ct) },
  grid: config.showGrid
    ? baseGrid
    : { ...baseGrid, show: true },
  legend: config.showLegend
    ? { bottom: 0, icon: 'roundRect', itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: ct.axisLabel } }
    : undefined,
  toolbox: {
    right: 4,
    top: 0,
    feature: { saveAsImage: { title: msg('downloadImage') } },
    iconStyle: { borderColor: ct.axisLine },
  },
})

/** Group the frame by x (+series) and reduce y with the chosen aggregation. */
const reduceByGroup = (
  rows: DataRow[],
  x: string,
  y: string,
  series: string,
  aggregation: Aggregation,
  xType: DataType,
) => {
  const groups = new Map<string, Map<string, number[]>>()
  const rowIndexByGroup = new Map<string, number[]>()
  rows.forEach((row, index) => {
    if (isMissing(row[x])) return
    const key = String(row[x])
    const seriesKey = series ? String(row[series] ?? '(NaN)') : '__all__'
    const bucket = groups.get(key) ?? new Map<string, number[]>()
    const values = bucket.get(seriesKey) ?? []
    const numeric = aggregation === 'count' || aggregation === 'nunique'
      ? 1
      : toNumber(row[y])
    if (numeric !== null) values.push(numeric)
    bucket.set(seriesKey, values)
    groups.set(key, bucket)
    // Track the source rows for every category, series or not: `sourceOrder`
    // drives brushing, and an empty order would make a populated chart look empty.
    const indices = rowIndexByGroup.get(key) ?? []
    indices.push(index)
    rowIndexByGroup.set(key, indices)
  })

  let categories = Array.from(groups.keys())
  if (xType === 'date' || /^\d{4}/.test(categories[0] ?? '')) {
    categories = categories.sort((a, b) => a.localeCompare(b))
  }

  const seriesKeys = series
    ? Array.from(new Set(rows.map((row) => String(row[series] ?? '(NaN)')))).sort()
    : ['__all__']

  const valueFor = (values: number[] | undefined, uniqueCount: number): number => {
    if (!values || !values.length) return uniqueCount ? uniqueCount : 0
    switch (aggregation) {
      case 'sum': return values.reduce((total, value) => total + value, 0)
      case 'mean': return values.reduce((total, value) => total + value, 0) / values.length
      case 'median': return quantile([...values].sort((a, b) => a - b), 0.5)
      case 'min': return minOf(values)
      case 'max': return maxOf(values)
      case 'count': return values.length
      case 'std': {
        if (values.length < 2) return 0
        const avg = values.reduce((total, value) => total + value, 0) / values.length
        return Math.sqrt(values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1))
      }
      case 'var': {
        if (values.length < 2) return 0
        const avg = values.reduce((total, value) => total + value, 0) / values.length
        return values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1)
      }
      case 'nunique': return new Set(values).size
      case 'range': {
        const { min, max } = minMax(values)
        return max - min
      }
      default: return values.reduce((total, value) => total + value, 0)
    }
  }

  const matrix = categories.map((category) =>
    seriesKeys.map((seriesKey) => valueFor(groups.get(category)?.get(seriesKey), 0)))

  const totals = categories.map((_, index) =>
    matrix[index].reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0))

  return { categories, seriesKeys, matrix, totals, rowIndexByGroup }
}

const applySortAndTop = <T,>(
  categories: string[],
  payload: T[],
  totals: number[],
  config: ChartConfig,
): { categories: string[]; payload: T[]; totals: number[] } => {
  if (!config.sortCategories) return { categories, payload, totals }
  const order = categories
    .map((_, index) => index)
    .sort((a, b) => totals[b] - totals[a])
  const limited = config.topN > 0 ? order.slice(0, config.topN) : order
  return {
    categories: limited.map((index) => categories[index]),
    payload: limited.map((index) => payload[index]),
    totals: limited.map((index) => totals[index]),
  }
}

const boxStats = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b)
  const q1 = quantile(ordered, 0.25)
  const median = quantile(ordered, 0.5)
  const q3 = quantile(ordered, 0.75)
  const iqr = q3 - q1
  const low = Math.max(ordered[0], q1 - 1.5 * iqr)
  const high = Math.min(ordered[ordered.length - 1], q3 + 1.5 * iqr)
  const outliers = ordered.filter((value) => value < low || value > high)
  return { low, q1, median, q3, high, outliers }
}

export const buildChartOption = (
  rows: DataRow[],
  config: ChartConfig,
  types: Record<string, DataType>,
  language: Language,
  msg: (key: Key) => string,
  theme: Theme = 'light',
): ChartOptionResult => {
  const ct = CHART_THEMES[theme]
  const base = commonOption(config, msg, ct)
  const allIndexes = rows.map((_, index) => index)
  const facts: ChartOptionResult['facts'] = []
  const empty: ChartOptionResult = { option: base, sourceOrder: [], facts: [], empty: true }

  const xType = types[config.x] ?? 'text'
  const aggLabel = msg(aggregationLabels[config.aggregation])
  let heatRange: { min: number; max: number } | null = null

  const finish = (option: EChartsOption, sourceOrder: number[], extraFacts = facts): ChartOptionResult => ({
    option, sourceOrder, facts: extraFacts, empty: sourceOrder.length === 0, colorRange: heatRange,
  })

  /* ---------------------------------------------------------- scatter */
  if (config.type === 'scatter' || config.type === 'bubble') {
    const points: Array<[number, number, number, number]> = []
    const order: number[] = []
    rows.forEach((row, index) => {
      const x = toNumber(row[config.x])
      const y = toNumber(row[config.y])
      if (x === null || y === null) return
      const size = config.type === 'bubble' && config.size ? toNumber(row[config.size]) ?? 1 : 1
      points.push([x, y, size, index])
      order.push(index)
    })
    if (config.type === 'bubble' && config.series) {
      const grouped = new Map<string, Array<[number, number, number, number]>>()
      points.forEach((point) => {
        const key = String(rows[point[3]][config.series] ?? '(NaN)')
        const bucket = grouped.get(key) ?? []
        bucket.push(point)
        grouped.set(key, bucket)
      })
      const series = Array.from(grouped, ([name, items]) => ({
        name,
        type: 'scatter' as const,
        data: items.map((point) => [point[0], point[1], point[2]]),
        symbolSize: (value: number[]) => Math.max(6, Math.min(46, Math.sqrt(Math.abs(value[2] ?? 1)) * 2.4)),
        itemStyle: { opacity: 0.72 },
        emphasis: { focus: 'series' as const },
        large: true,
        largeThreshold: 2000,
        progressive: 5000,
        progressiveThreshold: 3000,
      }))
      facts.push({ label: 'observations', value: formatNumber(points.length) })
      return finish({ ...base, tooltip: { ...base.tooltip, trigger: 'item' }, xAxis: { type: 'value', name: config.x, nameLocation: 'middle', nameGap: 28, ...axisStyle(ct) }, yAxis: { type: 'value', name: config.y, nameLocation: 'middle', nameGap: 44, ...axisStyle(ct) }, series }, order, facts)
    }

    const pairs: Array<[number, number]> = points.map((point) => [point[0], point[1]])
    const fit = config.trendline ? regression(pairs) : null
    const series: EChartsOption['series'] = [{
      type: 'scatter',
      data: points.map((point) => [point[0], point[1]]),
      symbolSize: config.type === 'bubble' ? 12 : 9,
      itemStyle: { opacity: 0.68 },
      large: true,
      largeThreshold: 2000,
      progressive: 5000,
      progressiveThreshold: 3000,
    }]
    if (fit) {
      facts.push({
        label: 'regressionEquation',
        value: `y = ${fit.slope.toFixed(3)}x ${fit.intercept >= 0 ? '+' : '−'} ${Math.abs(fit.intercept).toFixed(2)}`,
      })
      facts.push({ label: 'rSquared', value: fit.r2.toFixed(4) })
      series.push({
        type: 'line',
        data: fit.line,
        showSymbol: false,
        silent: true,
        lineStyle: { type: 'dashed', width: 2, color: ct.regression },
        tooltip: { show: false },
      })
    }
    facts.push({ label: 'observations', value: formatNumber(points.length) })
    return finish({
      ...base,
      xAxis: { type: 'value', name: config.x, nameLocation: 'middle', nameGap: 28, ...axisStyle(ct) },
      yAxis: { type: 'value', name: config.y, nameLocation: 'middle', nameGap: 44, ...axisStyle(ct) },
      series,
    }, order, facts)
  }

  /* -------------------------------------------------------- histogram */
  if (config.type === 'histogram') {
    const values = rows.map((row) => toNumber(row[config.x])).filter((value): value is number => value !== null)
    if (!values.length) return empty
    const { min: low, max: high } = minMax(values)
    const width = (high - low) / config.bins || 1
    const counts = new Array(config.bins).fill(0)
    const labels: string[] = []
    const bucketRows: number[][] = Array.from({ length: config.bins }, () => [])
    for (let index = 0; index < config.bins; index += 1) {
      labels.push(`${(low + index * width).toFixed(1)}–${(low + (index + 1) * width).toFixed(1)}`)
    }
    rows.forEach((row, index) => {
      const value = toNumber(row[config.x])
      if (value === null) return
      const bucket = Math.min(config.bins - 1, Math.max(0, Math.floor((value - low) / width)))
      counts[bucket] += 1
      bucketRows[bucket].push(index)
    })
    const histMean = values.reduce((a, b) => a + b, 0) / values.length
    const histStd = Math.sqrt(
      values.reduce((total, value) => total + (value - histMean) ** 2, 0) / Math.max(1, values.length - 1),
    )
    facts.push({ label: 'observations', value: formatNumber(values.length) })
    facts.push({ label: 'mean', value: formatNumber(histMean) })
    facts.push({ label: 'std', value: formatNumber(histStd) })
    facts.push({ label: 'min', value: formatNumber(low) })
    facts.push({ label: 'max', value: formatNumber(high) })
    return finish({
      ...base,
      tooltip: { ...base.tooltip, trigger: 'axis' },
      xAxis: { type: 'category', data: labels, ...axisStyle(ct), axisLabel: { rotate: 35, fontSize: 10 } },
      yAxis: { type: 'value', name: msg('frequency'), ...axisStyle(ct) },
      series: [{
        type: 'bar',
        data: counts.map((count, index) => ({
          value: count,
          itemStyle: { color: ct.palette[0], borderRadius: [4, 4, 0, 0] },
        })),
        barCategoryGap: '6%',
      }],
    }, bucketRows.flat(), facts)
  }

  /* ------------------------------------------------------------ gauge */
  if (config.type === 'gauge') {
    const values = rows.map((row) => toNumber(row[config.y])).filter((value): value is number => value !== null)
    if (!values.length) return empty
    let value: number
    if (config.aggregation === 'count') value = values.length
    else if (config.aggregation === 'sum') value = values.reduce((a, b) => a + b, 0)
    else if (config.aggregation === 'max') value = maxOf(values)
    else if (config.aggregation === 'min') value = minOf(values)
    else value = values.reduce((a, b) => a + b, 0) / values.length
    const display = Math.max(0, Math.min(100, value))
    facts.push({ label: aggregationLabels[config.aggregation], value: formatNumber(value) })
    facts.push({ label: 'observations', value: formatNumber(values.length) })
    return finish({
      ...base,
      series: [{
        type: 'gauge',
        min: 0,
        max: 100,
        progress: { show: true, width: 16, roundCap: true },
        axisLine: { lineStyle: { width: 16, color: [[1, ct.gaugeTrack]] } },
        axisTick: { show: false },
        splitLine: { length: 10, lineStyle: { color: ct.gaugeSplit } },
        axisLabel: { fontSize: 10, color: ct.axisLabel },
        pointer: { width: 4, itemStyle: { color: ct.palette[0] } },
        detail: { valueAnimation: true, fontSize: 26, color: ct.tooltipFg, formatter: (v: number) => v.toFixed(1) },
        data: [{ value: display, name: config.y }],
      }],
    }, allIndexes, facts)
  }

  /* ------------------------------------------------------------- box */
  if (config.type === 'box') {
    const grouped = new Map<string, number[]>()
    const order: number[] = []
    rows.forEach((row, index) => {
      const key = String(row[config.x] ?? '(NaN)')
      const value = toNumber(row[config.y])
      if (value === null) return
      const bucket = grouped.get(key) ?? []
      bucket.push(value)
      grouped.set(key, bucket)
      order.push(index)
    })
    const entries = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    if (!entries.length) return empty
    const boxes = entries.map(([, values]) => {
      const stats = boxStats(values)
      return [stats.low, stats.q1, stats.median, stats.q3, stats.high]
    })
    facts.push({ label: 'observations', value: formatNumber(entries.reduce((total, [, values]) => total + values.length, 0)) })
    return finish({
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item' },
      xAxis: { type: 'category', data: entries.map(([key]) => key), ...axisStyle(ct) },
      yAxis: { type: 'value', name: config.y, ...axisStyle(ct) },
      series: [{
        type: 'boxplot',
        data: boxes,
        itemStyle: { color: ct.boxFill, borderColor: ct.palette[0], borderWidth: 1.5 },
      }],
    }, order, facts)
  }

  /* -------------------------------------------------------- heat map */
  if (config.type === 'heatmap') {
    const reduced = reduceByGroup(rows, config.x, config.y, config.series, config.aggregation, xType)
    if (!reduced.categories.length) return empty
    const rowKeys = reduced.seriesKeys
    const data: Array<[number, number, number]> = []
    let min = Infinity
    let max = -Infinity
    reduced.categories.forEach((_, xIndex) => {
      rowKeys.forEach((__, yIndex) => {
        const value = reduced.matrix[xIndex][yIndex] ?? 0
        if (Number.isFinite(value)) {
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
        data.push([xIndex, yIndex, Number.isFinite(value) ? Number(value.toFixed(3)) : 0])
      })
    })
    facts.push({ label: aggregationLabels[config.aggregation], value: `${formatNumber(min)} – ${formatNumber(max)}` })
    // A single row/column would pin the axis label to the edge of the grid; the
    // half-unit bound keeps it centred instead.
    const singleRow = rowKeys.length === 1
    const singleColumn = reduced.categories.length === 1
    // The continuous visualMap is deliberately not used here: its drag handles
    // dominate the plot at this size. The colour range is shown as an HTML
    // legend in the panel instead.
    heatRange = Number.isFinite(min) && min !== max
      ? { min, max }
      : null
    return finish({
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const value = (params as { value: [number, number, number] }).value
          const rowLabel = rowKeys[value[1]]
          const colLabel = reduced.categories[value[0]]
          const label = rowLabel === '__all__' ? colLabel : `${colLabel} · ${rowLabel}`
          return `${label}<br/><b>${formatNumber(value[2])}</b>`
        },
      },
      grid: { ...baseGrid, top: 40, right: 80, bottom: 110, left: 130 },
      xAxis: {
        type: 'category',
        data: reduced.categories,
        splitArea: { show: true },
        ...axisStyle(ct),
        ...(singleColumn ? { min: -0.5, max: 0.5 } : {}),
      },
      yAxis: {
        type: 'category',
        data: rowKeys,
        splitArea: { show: true },
        ...axisStyle(ct),
        ...(singleRow ? { min: -0.5, max: 0.5 } : {}),
      },
      // ECharts refuses to render a heatmap without a visualMap. It is kept for
      // the colour mapping but hidden, because its drag handles would dominate
      // the plot area; the range is shown as the HTML legend instead.
      visualMap: {
        show: false,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) && max !== min ? max : (Number.isFinite(min) ? min + 1 : 1),
        inRange: { color: ct.heatColors },
      },
      series: [{
        type: 'heatmap',
        data,
        label: {
          show: config.showLabels,
          fontSize: 10,
          formatter: (params: unknown) => {
            const value = (params as { value: [number, number, number] }).value
            return formatNumber(value[2])
          },
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.25)' } },
      }],
    }, reduced.rowIndexByGroup.get(reduced.categories[0]) ?? allIndexes, facts)
  }

  /* ----------------------------------------------------------- radar */
  if (config.type === 'radar') {
    const metrics = [config.y, ...(config.series && config.series !== config.y ? [config.series] : [])]
      .filter((metric) => metric && types[metric] === 'number')
    const axes = metrics.length ? metrics : [config.y]
    const grouped = new Map<string, DataRow[]>()
    rows.forEach((row) => {
      const key = String(row[config.x] ?? '(NaN)')
      const bucket = grouped.get(key) ?? []
      bucket.push(row)
      grouped.set(key, bucket)
    })
    const entries = Array.from(grouped.entries()).slice(0, Math.max(1, config.topN))
    if (!entries.length) return empty
    const indicators = axes.map((axis) => {
      const maxima = entries.map(([, items]) => {
        const values = items.map((row) => toNumber(row[axis])).filter((value): value is number => value !== null)
        return values.length ? maxOf(values) : 0
      })
      return { name: axis, max: maxOf(maxima) * 1.1 || 1 }
    })
    const series = entries.map(([name, items]) => ({
      name,
      value: axes.map((axis) => {
        const values = items.map((row) => toNumber(row[axis])).filter((value): value is number => value !== null)
        return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0
      }),
    }))
    facts.push({ label: 'observations', value: formatNumber(entries.reduce((total, [, items]) => total + items.length, 0)) })
    return finish({
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item' },
      radar: {
        indicator: indicators,
        radius: '62%',
        axisName: { fontSize: 11, color: ct.axisLabel },
        splitLine: { lineStyle: { color: ct.axisLine } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: ct.axisLine } },
      },
      series: [{ type: 'radar', data: series, areaStyle: { opacity: 0.18 }, symbolSize: 4 }],
    }, allIndexes, facts)
  }

  /* ---------------------------------------------------------- sankey */
  if (config.type === 'sankey') {
    const source = config.x
    const target = config.series
    if (!source || !target || source === target) return empty
    const reduced = reduceByGroup(rows, source, config.y, target, config.aggregation, xType)
    const ranked = applySortAndTop(reduced.categories, reduced.matrix, reduced.totals, config)
    const links: Array<{ source: string; target: string; value: number }> = []
    const nodeValue = new Map<string, number>()
    ranked.categories.forEach((category, catIndex) => {
      reduced.seriesKeys.forEach((seriesKey, seriesIndex) => {
        const value = ranked.payload[catIndex][seriesIndex]
        if (seriesKey === '__all__' || !Number.isFinite(value) || value <= 0 || seriesKey === category) return
        links.push({ source: category, target: seriesKey, value: Number(value.toFixed(2)) })
        nodeValue.set(category, (nodeValue.get(category) ?? 0) + value)
        nodeValue.set(seriesKey, (nodeValue.get(seriesKey) ?? 0) + value)
      })
    })
    if (!links.length) return empty
    const nodes = Array.from(nodeValue.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name], index) => ({
        name,
        itemStyle: { color: ct.palette[index % ct.palette.length] },
      }))
    facts.push({ label: aggregationLabels[config.aggregation], value: formatNumber(links.reduce((total, link) => total + link.value, 0)) })
    facts.push({ label: 'observations', value: formatNumber(nodes.length) })
    return finish({
      ...base,
      legend: undefined,
      tooltip: { ...base.tooltip, trigger: 'item', formatter: '{b}: {c}' },
      series: [{
        type: 'sankey',
        left: 20, right: 100, top: 14, bottom: 22,
        nodeWidth: 14, nodeGap: 10,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
        label: { fontSize: 11, color: ct.axisLabel },
        data: nodes,
        links,
      }],
    }, allIndexes, facts)
  }

  /* -------------------------------------------------------- sunburst */
  if (config.type === 'sunburst') {
    const inner = config.series && config.series !== config.x && types[config.series] !== 'number' ? config.series : ''
    const reduced = reduceByGroup(rows, config.x, config.y, inner, config.aggregation, xType)
    if (!reduced.categories.length) return empty
    const ranked = applySortAndTop(reduced.categories, reduced.matrix, reduced.totals.map((total) => Math.abs(total)), config)
    const data = ranked.categories.map((category, catIndex) => {
      const children = inner
        ? reduced.seriesKeys
            .map((seriesKey, seriesIndex) => ({
              name: seriesKey,
              value: Math.abs(ranked.payload[catIndex][seriesIndex] ?? 0),
            }))
            .filter((child) => child.value > 0)
        : []
      const value = children.length
        ? children.reduce((total, child) => total + child.value, 0)
        : Math.abs(ranked.totals[catIndex] ?? 0)
      return {
        name: category,
        value: Number(value.toFixed(2)),
        children,
        itemStyle: { color: ct.palette[catIndex % ct.palette.length] },
      }
    }).filter((node) => node.value > 0)
    if (!data.length) return empty
    facts.push({ label: aggregationLabels[config.aggregation], value: formatNumber(data.reduce((total, node) => total + node.value, 0)) })
    return finish({
      ...base,
      legend: undefined,
      tooltip: { ...base.tooltip, trigger: 'item', formatter: '{b}: {c}' },
      series: [{
        type: 'sunburst',
        radius: ['16%', '82%'],
        center: ['50%', '50%'],
        emphasis: { focus: 'ancestor' },
        itemStyle: { borderColor: ct.tileBorder, borderWidth: 2 },
        label: { fontSize: 10, color: ct.tooltipFg, minAngle: 10 },
        levels: [{}, { r0: '16%', r: '52%' }, ...(inner ? [{ r0: '52%', r: '82%' }] : [])],
        data,
      }],
    }, allIndexes, facts)
  }

  /* -------------------------------------------------------- parallel */
  if (config.type === 'parallel') {
    const columns = Object.keys(rows[0] ?? {})
    const dims = columns.filter((column) => types[column] === 'number').slice(0, 6)
    if (dims.length < 2) return empty
    const colorBy = config.series && types[config.series] !== 'number' ? config.series : ''
    const groupRows = new Map<string, number[]>()
    rows.forEach((row, index) => {
      if (dims.some((column) => toNumber(row[column]) === null)) return
      const key = colorBy ? String(row[colorBy] ?? '(NaN)') : '__all__'
      const bucket = groupRows.get(key) ?? []
      bucket.push(index)
      groupRows.set(key, bucket)
    })
    const groups = Array.from(groupRows.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
    if (!groups.length) return empty
    const kept = new Set(groups.flatMap(([, indexes]) => indexes))
    const ranges = dims.map((column) => minMax(rows
      .map((row) => toNumber(row[column]))
      .filter((value): value is number => value !== null)))
    facts.push({ label: 'observations', value: formatNumber(kept.size) })
    return finish({
      ...base,
      legend: colorBy
        ? { bottom: 0, type: 'scroll', icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11, color: ct.axisLabel } }
        : undefined,
      tooltip: { ...base.tooltip, trigger: 'item' },
      parallel: { left: 70, right: 70, top: 40, bottom: colorBy ? 60 : 32 },
      parallelAxis: dims.map((column, index) => ({
        dim: index,
        name: column,
        min: ranges[index].min,
        max: ranges[index].max,
        nameTextStyle: { fontSize: 10, color: ct.tooltipFg },
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { fontSize: 9, color: ct.axisLabel },
      })),
      series: groups.map(([name, indexes], groupIndex) => ({
        type: 'parallel' as const,
        name: name === '__all__' ? (config.y || 'rows') : name,
        data: indexes.map((rowIndex) => dims.map((column) => toNumber(rows[rowIndex][column]) ?? 0)),
        lineStyle: { width: 1.6, opacity: 0.4, color: ct.palette[groupIndex % ct.palette.length] },
        emphasis: { lineStyle: { width: 2.4, opacity: 0.95 } },
      })),
    }, Array.from(kept), facts)
  }

  /* ------------------------------------------------------------ splom */
  if (config.type === 'splom') {
    const columns = Object.keys(rows[0] ?? {})
    const dims = columns.filter((column) => types[column] === 'number').slice(0, 5)
    if (dims.length < 2) return empty
    const n = dims.length
    const ranges = dims.map((column) => minMax(rows
      .map((row) => toNumber(row[column]))
      .filter((value): value is number => value !== null)))
    const cells: Array<{ xIndex: number; yIndex: number; gridIndex: number; data: Array<[number, number]> }> = []
    let gridIndex = 0
    for (let y = 1; y < n; y += 1) {
      for (let x = 0; x < y; x += 1) {
        const data: Array<[number, number]> = []
        rows.forEach((row) => {
          const xValue = toNumber(row[dims[x]])
          const yValue = toNumber(row[dims[y]])
          if (xValue === null || yValue === null) return
          data.push([xValue, yValue])
        })
        if (data.length) {
          cells.push({ xIndex: x, yIndex: y, gridIndex, data })
          gridIndex += 1
        }
      }
    }
    if (!cells.length) return empty
    const cellW = 88 / n
    const cellH = 84 / n
    facts.push({ label: 'variables', value: String(n) })
    facts.push({ label: 'observations', value: formatNumber(rows.length) })
    return finish({
      ...base,
      legend: undefined,
      grid: cells.map((cell) => ({
        left: `${6 + cell.xIndex * cellW}%`,
        top: `${7 + cell.yIndex * cellH}%`,
        width: `${cellW - 3.5}%`,
        height: `${cellH - 3.5}%`,
      })),
      xAxis: cells.map((cell) => ({
        gridIndex: cell.gridIndex,
        type: 'value' as const,
        min: ranges[cell.xIndex].min,
        max: ranges[cell.xIndex].max,
        axisLabel: { fontSize: 8, color: ct.axisLabel },
        splitLine: { show: false },
        name: cell.yIndex === n - 1 ? dims[cell.xIndex] : '',
        nameLocation: 'middle' as const,
        nameGap: 16,
        nameTextStyle: { fontSize: 10, color: ct.tooltipFg },
      })),
      yAxis: cells.map((cell) => ({
        gridIndex: cell.gridIndex,
        type: 'value' as const,
        min: ranges[cell.yIndex].min,
        max: ranges[cell.yIndex].max,
        axisLabel: { fontSize: 8, color: ct.axisLabel },
        splitLine: { show: false },
        name: cell.xIndex === 0 ? dims[cell.yIndex] : '',
        nameLocation: 'middle' as const,
        nameGap: 28,
        nameRotate: 90,
        nameTextStyle: { fontSize: 10, color: ct.tooltipFg },
      })),
      series: cells.map((cell, index) => ({
        type: 'scatter' as const,
        xAxisIndex: cell.gridIndex,
        yAxisIndex: cell.gridIndex,
        symbolSize: 4,
        itemStyle: { color: ct.palette[index % ct.palette.length], opacity: 0.55 },
        data: cell.data,
      })),
    }, allIndexes, facts)
  }

  /* --------------------------------------------------------- treemap */
  if (config.type === 'treemap' || config.type === 'pie' || config.type === 'funnel') {
    const reduced = reduceByGroup(rows, config.x, config.y, '', config.aggregation, xType)
    const positive = reduced.categories
      .map((category, index) => ({ name: category, value: Math.abs(reduced.totals[index]) }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, config.topN > 0 ? config.topN : undefined)
    if (!positive.length) return empty
    const total = positive.reduce((sum, item) => sum + item.value, 0)
    facts.push({ label: aggregationLabels[config.aggregation], value: formatNumber(total) })
    facts.push({ label: 'observations', value: formatNumber(rows.length) })

    if (config.type === 'treemap') {
      return finish({
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item' },
        series: [{
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { show: true, formatter: '{b}', fontSize: 11 },
          upperLabel: { show: false },
          itemStyle: { borderColor: ct.tileBorder, borderWidth: 2, gapWidth: 2 },
          data: positive.map((item) => ({
            name: item.name,
            value: Number(item.value.toFixed(2)),
          })),
        }],
      }, allIndexes, facts)
    }

    if (config.type === 'funnel') {
      return finish({
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: '{b}: {c}' },
        series: [{
          type: 'funnel',
          left: '12%',
          width: '76%',
          top: 20,
          bottom: 30,
          sort: 'descending',
          gap: 3,
          label: { show: true, position: 'inside', formatter: '{b}', fontSize: 11 },
          itemStyle: { borderWidth: 0 },
          data: positive.map((item) => ({ name: item.name, value: Number(item.value.toFixed(2)) })),
        }],
      }, allIndexes, facts)
    }

    return finish({
      ...base,
      tooltip: { ...base.tooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: config.showLegend ? { bottom: 0, type: 'scroll', icon: 'circle', textStyle: { fontSize: 11, color: ct.axisLabel } } : undefined,
      series: [{
        type: 'pie',
        radius: ['46%', '70%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: ct.tileBorder, borderWidth: 3, borderRadius: 6 },
        label: { show: config.showLabels, formatter: '{b}\n{d}%', fontSize: 10 },
        data: positive.map((item) => ({ name: item.name, value: Number(item.value.toFixed(2)) })),
      }],
    }, allIndexes, facts)
  }

  /* ------------------------------------------------- bar / line / area */
  const reduced = reduceByGroup(rows, config.x, config.y, config.type === 'barGrouped' || config.type === 'barStacked' ? config.series : '', config.aggregation, xType)
  if (!reduced.categories.length) return empty
  const sorted = applySortAndTop(reduced.categories, reduced.matrix, reduced.totals, config)
  const order: number[] = []
  sorted.categories.forEach((category) => {
    ;(reduced.rowIndexByGroup.get(category) ?? []).forEach((index) => order.push(index))
  })
  if (!order.length) return empty

  const named = sorted.payload
  const stacked = config.type === 'barStacked'
  const smooth = config.type === 'area' || (config.type === 'line' && config.smooth)

  const series = reduced.seriesKeys.map((seriesKey, seriesIndex) => {
    const data = sorted.payload.map((values) => Number((values[seriesIndex] ?? 0).toFixed(2)))
    if (config.type === 'line' || config.type === 'area') {
      return {
        name: seriesKey === '__all__' ? config.y : seriesKey,
        type: 'line' as const,
        data,
        smooth,
        symbolSize: 6,
        lineStyle: { width: 2.4 },
        areaStyle: config.type === 'area' ? { opacity: 0.16 } : undefined,
        emphasis: { focus: 'series' as const },
      }
    }
    return {
      name: seriesKey === '__all__' ? (config.aggregation === 'count' ? 'count' : config.y) : seriesKey,
      type: 'bar' as const,
      data,
      stack: stacked ? 'total' : undefined,
      barMaxWidth: 46,
      itemStyle: { borderRadius: stacked ? 0 : config.horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
      label: config.showLabels
        ? { show: true, position: config.horizontal ? 'right' : 'top', fontSize: 10, formatter: (params: { value: number }) => formatNumber(params.value) }
        : undefined,
      emphasis: { focus: 'series' as const },
    }
  })

  const total = sorted.totals.reduce((sum, value) => sum + value, 0)
  facts.push({ label: aggregationLabels[config.aggregation], value: formatNumber(total) })
  facts.push({ label: 'observations', value: formatNumber(order.length) })
  if (config.type === 'line' || config.type === 'area') {
    const first = sorted.totals[0] ?? 0
    const last = sorted.totals[sorted.totals.length - 1] ?? 0
    facts.push({ label: 'pctChange', value: first === 0 ? '—' : `${(((last - first) / Math.abs(first)) * 100).toFixed(1)}%` })
  }

  const categoryAxis = {
    type: 'category' as const,
    data: sorted.categories,
    axisLabel: { rotate: sorted.categories.length > 8 ? 32 : 0, fontSize: 10, interval: 0, color: ct.axisLabel },
    axisLine: { lineStyle: { color: ct.axisLine } },
  }
  const valueAxis = {
    type: 'value' as const,
    name: config.aggregation === 'count' ? 'count' : config.y,
    nameTextStyle: { fontSize: 10, color: ct.axisLabel },
    axisLabel: { fontSize: 10, color: ct.axisLabel },
    splitLine: config.showGrid ? { lineStyle: { color: ct.splitLine } } : { show: false },
  }

  return finish({
    ...base,
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: config.type === 'bar' ? 'shadow' : 'line' } },
    xAxis: config.horizontal && config.type === 'bar' ? valueAxis : categoryAxis,
    yAxis: config.horizontal && config.type === 'bar' ? categoryAxis : valueAxis,
    series: series as EChartsOption['series'],
  }, order, facts)
}

/* ------------------------------------------------------------------ *
 * Extra analytical views (not the plot builder)
 * ------------------------------------------------------------------ */

export const buildCorrelationOption = (
  rows: DataRow[],
  columns: string[],
  method: 'pearson' | 'spearman',
  theme: Theme = 'light',
): EChartsOption => {
  const ct = CHART_THEMES[theme]
  const matrix = correlationMatrix(rows, columns, method)
  const data: Array<[number, number, number | null]> = []
  matrix.matrix.forEach((line, y) => {
    line.forEach((value, x) => {
      data.push([x, y, value === null ? null : Number(value.toFixed(3))])
    })
  })
  return {
    animationDuration: 320,
    tooltip: {
      position: 'top',
      confine: true,
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: ct.tooltipFg, fontSize: 12 },
      formatter: (params: unknown) => {
        const value = (params as { value: [number, number, number | null] }).value
        const [x, y, correlation] = value
        return `${columns[x]} × ${columns[y]}<br/><b>${correlation === null ? '—' : correlation.toFixed(3)}</b>`
      },
    },
    grid: { top: 20, right: 20, bottom: 78, left: 96, containLabel: false },
    xAxis: {
      type: 'category', data: columns, splitArea: { show: true }, axisLabel: { rotate: 40, fontSize: 10, color: ct.axisLabel },
      axisLine: { lineStyle: { color: ct.axisLine } },
    },
    yAxis: {
      type: 'category', data: columns, splitArea: { show: true }, axisLabel: { fontSize: 10, color: ct.axisLabel },
      axisLine: { lineStyle: { color: ct.axisLine } },
    },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      itemWidth: 12, itemHeight: 110, precision: 2,
      textStyle: { color: ct.axisLabel, fontSize: 10 },
      inRange: { color: ct.corrColors },
    },
    series: [{
      type: 'heatmap',
      data,
      label: {
        show: columns.length <= 8,
        fontSize: 9,
        formatter: (params: unknown) => {
          const value = (params as { value: [number, number, number | null] }).value
          return value[2] === null ? '' : value[2].toFixed(2)
        },
      },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.3)' } },
    }],
  }
}

/** Grouped result used by the analyze workspace preview chart. */
export const buildGroupedBarOption = (
  rows: DataRow[],
  keys: string[],
  aggs: Array<{ column: string; aggregation: Aggregation }>,
  theme: Theme = 'light',
): { option: EChartsOption; result: DataRow[]; columns: string[] } => {
  const ct = CHART_THEMES[theme]
  const { rows: result, columns } = groupByAggregate(rows, keys, aggs)
  const valueColumns = columns.filter((column) => !keys.includes(column))
  return {
    result,
    columns,
    option: {
      color: ct.palette,
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      legend: valueColumns.length > 1 ? { bottom: 0, icon: 'roundRect', itemWidth: 9, itemHeight: 9, textStyle: { color: ct.axisLabel, fontSize: 11 } } : undefined,
      grid: { ...baseGrid, bottom: valueColumns.length > 1 ? 42 : 30 },
      xAxis: {
        type: 'category',
        data: result.map((row) => keys.map((key) => String(row[key] ?? '')).join(' · ')),
        axisLabel: { rotate: result.length > 8 ? 32 : 0, interval: 0, fontSize: 10, color: ct.axisLabel },
        axisLine: { lineStyle: { color: ct.axisLine } },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: ct.axisLabel }, splitLine: { lineStyle: { color: ct.splitLine } } },
      series: valueColumns.map((column) => ({
        name: column,
        type: 'bar',
        data: result.map((row) => toNumber(row[column]) ?? 0),
        barMaxWidth: 44,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      })),
    },
  }
}
