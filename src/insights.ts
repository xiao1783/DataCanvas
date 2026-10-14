import type { Aggregation, DataFrame, DataRow } from './types'
import type { ChartConfig } from './charts'
import { regression, type FrameQuality } from './analysis'
import { formatCell, formatNumber, isMissing, maxOf, mean, minMax, minOf, quantile, sorted, std, toNumber } from './utils'

export type InsightKind = 'trend' | 'leader' | 'volatility' | 'relationship' | 'cleaning' | 'risk'

export interface SmartInsight {
  kind: InsightKind
  titleZh: string
  titleEn: string
  textZh: string
  textEn: string
}

export interface SmartInsightBundle {
  items: SmartInsight[]
  noteZh: string
  noteEn: string
}

const aggregate = (rows: DataRow[], column: string, aggregation: Aggregation): number | null => {
  const present = rows.map((row) => row[column]).filter((value) => !isMissing(value))
  if (aggregation === 'count') return present.length
  if (aggregation === 'nunique') return new Set(present.map(formatCell)).size
  const values = present.map(toNumber).filter((value): value is number => value !== null)
  if (!values.length) return null
  if (aggregation === 'first') return values[0]
  if (aggregation === 'last') return values[values.length - 1]
  if (aggregation === 'sum') return values.reduce((total, value) => total + value, 0)
  if (aggregation === 'mean') return mean(values)
  if (aggregation === 'median') return quantile(sorted(values), .5)
  if (aggregation === 'min') return minOf(values)
  if (aggregation === 'max') return maxOf(values)
  if (aggregation === 'std') return std(values)
  if (aggregation === 'var') return std(values) ** 2
  if (aggregation === 'range') {
    const { min, max } = minMax(values)
    return max - min
  }
  return null
}

interface GroupedValue {
  label: string
  value: number
}

const groupedValues = (frame: DataFrame, config: ChartConfig): GroupedValue[] => {
  const groups = new Map<string, DataRow[]>()
  frame.rows.forEach((row) => {
    const key = formatCell(row[config.x]) || '(NaN)'
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  })
  const values = Array.from(groups, ([label, rows]) => ({
    label,
    value: aggregate(rows, config.y, config.aggregation),
  })).filter((item): item is GroupedValue => item.value !== null && Number.isFinite(item.value))
  if (frame.types[config.x] === 'date') {
    values.sort((a, b) => new Date(a.label).getTime() - new Date(b.label).getTime())
  }
  return values
}

/** Chart types whose insight text is based on grouped/aggregated categories. */
const GROUPED_TYPES = ['bar', 'barGrouped', 'barStacked', 'line', 'area', 'pie', 'funnel', 'treemap', 'radar', 'heatmap']

const mappedRows = (frame: DataFrame, config: ChartConfig) => {
  const fields = [config.x, config.y, config.series, config.size].filter((field, index, all) => field && all.indexOf(field) === index)
  const missing = frame.rows.reduce((total, row) => total + fields.reduce((sum, field) => sum + (isMissing(row[field]) ? 1 : 0), 0), 0)
  const complete = frame.rows.filter((row) => fields.every((field) => !isMissing(row[field]))).length
  return { fields, missing, complete }
}

const buildTrendInsights = (config: ChartConfig, values: GroupedValue[], isDateAxis: boolean): SmartInsight[] => {
  if (!['line', 'area'].includes(config.type) || values.length < 2) return []
  const first = values[0]
  const last = values[values.length - 1]
  const change = first.value === 0 ? null : ((last.value - first.value) / Math.abs(first.value)) * 100
  const peak = values.reduce((best, item) => item.value > best.value ? item : best, values[0])
  const directionZh = change === null ? '无法计算相对变化' : `${change >= 0 ? '上升' : '下降'} ${Math.abs(change).toFixed(1)}%`
  const directionEn = change === null ? 'the relative change is unavailable' : `${change >= 0 ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(1)}%`
  const items: SmartInsight[] = [{
    kind: 'trend',
    titleZh: '趋势总结',
    titleEn: 'Trend summary',
    textZh: `${config.y} 从 ${first.label} 的 ${formatNumber(first.value)} 到 ${last.label} 的 ${formatNumber(last.value)}，整体${directionZh}；峰值出现在 ${peak.label}（${formatNumber(peak.value)}）。`,
    textEn: `${config.y} ${directionEn}, from ${formatNumber(first.value)} in ${first.label} to ${formatNumber(last.value)} in ${last.label}; the peak was ${formatNumber(peak.value)} in ${peak.label}.`,
  }]

  if (isDateAxis && values.length >= 4) {
    const changes = values.slice(1).map((item, index) => ({
      from: values[index],
      to: item,
      delta: item.value - values[index].value,
    }))
    const deltas = changes.map((item) => item.delta)
    const avg = mean(deltas)
    const spread = std(deltas)
    const largest = changes.reduce((best, item) => Math.abs(item.delta) > Math.abs(best.delta) ? item : best, changes[0])
    const unusual = spread > 0 && Math.abs(largest.delta - avg) > spread * 2
    items.push({
      kind: 'volatility',
      titleZh: '波动提示',
      titleEn: 'Movement check',
      textZh: `${largest.from.label} 至 ${largest.to.label} 的变化最大（${largest.delta >= 0 ? '+' : ''}${formatNumber(largest.delta)}）${unusual ? '，按相邻期变化的 2σ 规则属于异常波动，建议结合业务事件核查原因。' : '；按相邻期变化的 2σ 规则未达到异常阈值。'}`,
      textEn: `The largest adjacent move was from ${largest.from.label} to ${largest.to.label} (${largest.delta >= 0 ? '+' : ''}${formatNumber(largest.delta)}). ${unusual ? 'It exceeds the 2σ threshold for adjacent changes; review relevant business events before assigning a cause.' : 'It does not exceed the 2σ threshold for adjacent changes.'}`,
    })
  }
  return items
}

const buildLeaderInsight = (config: ChartConfig, values: GroupedValue[]): SmartInsight | null => {
  if (!config.x || !config.y || !GROUPED_TYPES.includes(config.type)) return null
  if (!values.length) return null
  const ranked = [...values].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const total = ranked.reduce((sum, item) => sum + Math.abs(item.value), 0)
  const top = ranked[0]
  const share = total ? Math.abs(top.value) / total * 100 : 0
  return {
    kind: 'leader',
    titleZh: '最大贡献类别',
    titleEn: 'Leading category',
    textZh: `${top.label} 的 ${config.y} 为 ${formatNumber(top.value)}，在当前显示类别的绝对总量中占 ${share.toFixed(1)}%，排名第一。`,
    textEn: `${top.label} ranks first with ${formatNumber(top.value)} ${config.y}, representing ${share.toFixed(1)}% of the absolute total across the displayed categories.`,
  }
}

const buildRelationshipInsight = (frame: DataFrame, config: ChartConfig): SmartInsight | null => {
  if (!['scatter', 'bubble'].includes(config.type) || !config.x || !config.y) return null
  const pairs = frame.rows.map((row) => [toNumber(row[config.x]), toNumber(row[config.y])] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null)
    .map(([x, y]) => [x, y] as [number, number])
  const fit = regression(pairs)
  if (!fit) return null
  const correlation = Math.sign(fit.slope) * Math.sqrt(Math.max(0, fit.r2))
  const strengthZh = Math.abs(correlation) >= .7 ? '强' : Math.abs(correlation) >= .4 ? '中等' : Math.abs(correlation) >= .2 ? '弱' : '很弱'
  const strengthEn = Math.abs(correlation) >= .7 ? 'strong' : Math.abs(correlation) >= .4 ? 'moderate' : Math.abs(correlation) >= .2 ? 'weak' : 'very weak'
  return {
    kind: 'relationship',
    titleZh: '相关性说明',
    titleEn: 'Relationship',
    textZh: `${config.x} 与 ${config.y} 呈${strengthZh}${correlation >= 0 ? '正' : '负'}相关（r=${correlation.toFixed(2)}，R²=${fit.r2.toFixed(2)}，n=${fit.n}）。该结果描述关联而非因果。`,
    textEn: `${config.x} and ${config.y} have a ${strengthEn} ${correlation >= 0 ? 'positive' : 'negative'} association (r=${correlation.toFixed(2)}, R²=${fit.r2.toFixed(2)}, n=${fit.n}). This describes association, not causation.`,
  }
}

const buildDistributionInsight = (frame: DataFrame, config: ChartConfig): SmartInsight | null => {
  if (!['histogram', 'box'].includes(config.type)) return null
  const field = config.type === 'histogram' ? config.x : config.y
  const values = frame.rows.map((row) => toNumber(row[field])).filter((value): value is number => value !== null)
  if (!values.length) return null
  const ordered = sorted(values)
  const avg = mean(values)
  const median = quantile(ordered, .5)
  const q1 = quantile(ordered, .25)
  const q3 = quantile(ordered, .75)
  const iqr = q3 - q1
  const outliers = values.filter((value) => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr).length
  return {
    kind: 'trend',
    titleZh: '分布总结',
    titleEn: 'Distribution summary',
    textZh: `${field} 的均值为 ${formatNumber(avg)}，中位数为 ${formatNumber(median)}；IQR 规则识别到 ${formatNumber(outliers)} 个异常观测。`,
    textEn: `${field} has a mean of ${formatNumber(avg)} and a median of ${formatNumber(median)}; the IQR rule flags ${formatNumber(outliers)} observations.`,
  }
}

const buildCleaningInsight = (
  frame: DataFrame,
  sourceFrame: DataFrame,
  frameQuality: FrameQuality,
  sourceQuality: FrameQuality,
): SmartInsight => {
  const beforeMissing = sourceQuality.missing
  const afterMissing = frameQuality.missing
  const beforeDuplicates = sourceQuality.duplicates
  const afterDuplicates = frameQuality.duplicates
  const rowDelta = frame.rows.length - sourceFrame.rows.length
  const changed = rowDelta !== 0 || beforeMissing !== afterMissing || beforeDuplicates !== afterDuplicates
  return {
    kind: 'cleaning',
    titleZh: '清洗效果',
    titleEn: 'Cleaning impact',
    textZh: changed
      ? `与原始数据相比，当前数据${rowDelta === 0 ? '行数不变' : `${rowDelta < 0 ? '减少' : '增加'} ${formatNumber(Math.abs(rowDelta))} 行`}；缺失单元格由 ${formatNumber(beforeMissing)} 变为 ${formatNumber(afterMissing)}，重复行由 ${formatNumber(beforeDuplicates)} 变为 ${formatNumber(afterDuplicates)}。`
      : `当前图表使用全部 ${formatNumber(frame.rows.length)} 行；行数、缺失单元格和重复行相较原始数据均未变化。`,
    textEn: changed
      ? `Compared with the source, the current data ${rowDelta === 0 ? 'keeps the same row count' : `${rowDelta < 0 ? 'has' : 'adds'} ${formatNumber(Math.abs(rowDelta))} ${rowDelta < 0 ? 'fewer' : 'additional'} rows`}; missing cells changed from ${formatNumber(beforeMissing)} to ${formatNumber(afterMissing)}, and duplicate rows from ${formatNumber(beforeDuplicates)} to ${formatNumber(afterDuplicates)}.`
      : `The chart uses all ${formatNumber(frame.rows.length)} rows; row count, missing cells, and duplicate rows are unchanged from the source.`,
  }
}

const buildRiskInsight = (frame: DataFrame, config: ChartConfig): SmartInsight => {
  const mapped = mappedRows(frame, config)
  const risksZh: string[] = []
  const risksEn: string[] = []
  if (mapped.complete < 30) {
    risksZh.push(`完整观测仅 ${formatNumber(mapped.complete)} 条，结论稳定性有限`)
    risksEn.push(`only ${formatNumber(mapped.complete)} complete observations are available, so the result may be unstable`)
  }
  if (mapped.missing > 0) {
    risksZh.push(`映射字段包含 ${formatNumber(mapped.missing)} 个缺失值，绘图时会被忽略`)
    risksEn.push(`${formatNumber(mapped.missing)} missing mapped values are omitted from the chart`)
  }
  if (['scatter', 'bubble'].includes(config.type)) {
    risksZh.push('相关关系不能单独证明因果')
    risksEn.push('correlation alone does not establish causation')
  }
  return {
    kind: 'risk',
    titleZh: '风险提示',
    titleEn: 'Risk note',
    textZh: risksZh.length ? `${risksZh.join('；')}。` : '当前映射字段未发现明显的样本量或缺失值风险，仍建议结合字段口径解释结果。',
    textEn: risksEn.length ? `${risksEn.join('; ')}.` : 'No obvious sample-size or missing-value risk was found in the mapped fields; interpret the result with the field definitions.',
  }
}

export const generateSmartInsights = (
  frame: DataFrame,
  sourceFrame: DataFrame,
  config: ChartConfig,
  frameQuality: FrameQuality,
  sourceQuality: FrameQuality,
): SmartInsightBundle => {
  // The trend and leader reads need the same grouped/aggregated series;
  // quality stats are passed in cached per frame so toggling chart options
  // never rescans unchanged rows.
  const grouped = config.x && config.y && GROUPED_TYPES.includes(config.type)
    ? groupedValues(frame, config)
    : []
  const items: SmartInsight[] = []
  items.push(...buildTrendInsights(config, grouped, frame.types[config.x] === 'date'))
  const leader = buildLeaderInsight(config, grouped)
  if (leader) items.push(leader)
  const relationship = buildRelationshipInsight(frame, config)
  if (relationship) items.push(relationship)
  const distribution = buildDistributionInsight(frame, config)
  if (distribution) items.push(distribution)
  items.push(buildCleaningInsight(frame, sourceFrame, frameQuality, sourceQuality))
  items.push(buildRiskInsight(frame, config))
  return {
    items,
    noteZh: items.map((item) => `${item.titleZh}：${item.textZh}`).join(' '),
    noteEn: items.map((item) => `${item.titleEn}: ${item.textEn}`).join(' '),
  }
}
