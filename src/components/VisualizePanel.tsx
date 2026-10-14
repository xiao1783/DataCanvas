import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EChart, type EChartsInstance } from './EChart'
import {
  AlignHorizontalDistributeCenter, AreaChart, BarChart3, Box, Brush, ChartPie, CircleDot, Donut, Filter,
  Grid2X2, Grid3X3, Hash, Layers, LineChart, Minus, Network, Radar as RadarIcon, Rows3, ScatterChart,
  Settings2, Sigma, SlidersHorizontal, Target, LayoutGrid, Pin, ChevronRight, X, Sparkles,
} from 'lucide-react'
import type { DataFrame, DataRow, Language, Op, Aggregation, Theme } from '../types'
import type { MessageKey as Key } from '../i18n'
import { AGGREGATIONS, aggregationLabels } from '../i18n'
import { CHART_TYPES, buildChartOption, chartNeeds, defaultChartConfig, type ChartConfig, type ChartType } from '../charts'
import { deriveColumnDefaults } from '../defaults'
import { formatCell, formatNumber, toNumber } from '../utils'
import { generateSmartInsights } from '../insights'
import { measureQuality } from '../analysis'
import { Button, Field, Panel, Select, TextInput, Toggle } from './ui'
import { DataTable } from './DataTable'

const CHART_ICONS: Record<ChartType, React.ReactNode> = {
  bar: <BarChart3 size={16} />,
  barGrouped: <Rows3 size={16} />,
  barStacked: <Layers size={16} />,
  line: <LineChart size={16} />,
  area: <AreaChart size={16} />,
  pie: <ChartPie size={16} />,
  scatter: <ScatterChart size={16} />,
  bubble: <CircleDot size={16} />,
  histogram: <SlidersHorizontal size={16} />,
  box: <Box size={16} />,
  heatmap: <Grid3X3 size={16} />,
  radar: <RadarIcon size={16} />,
  treemap: <LayoutGrid size={16} />,
  funnel: <Filter size={16} />,
  gauge: <Target size={16} />,
  sankey: <Network size={16} />,
  sunburst: <Donut size={16} />,
  parallel: <AlignHorizontalDistributeCenter size={16} />,
  splom: <Grid2X2 size={16} />,
}

const BRUSHABLE: ChartType[] = ['scatter', 'bubble', 'bar', 'barGrouped', 'barStacked', 'line', 'area']

const HINTS: Partial<Record<ChartType, Key>> = {
  scatter: 'brushHint',
  bubble: 'brushHint',
  box: 'boxPlotHint',
  heatmap: 'heatmapHint',
  radar: 'radarHint',
  treemap: 'treemapHint',
  funnel: 'funnelHint',
  gauge: 'gaugeHint',
  sankey: 'sankeyHint',
  sunburst: 'sunburstHint',
  parallel: 'parallelHint',
  splom: 'splomHint',
}

export interface VisualizeProps {
  frame: DataFrame
  sourceFrame: DataFrame
  language: Language
  theme: Theme
  msg: (key: Key) => string
  addStep: (op: Op, labels?: { zh: string; en: string }) => void
  notify: (text: string) => void
  onPin: (config: ChartConfig, notes: { noteZh: string; noteEn: string }) => void
}

export function VisualizePanel({ frame, sourceFrame, language, theme, msg, addStep, notify, onPin }: VisualizeProps) {
  const { rows, columns, types } = frame
  const numericColumns = columns.filter((column) => types[column] === 'number')
  const defaults = useMemo(() => deriveColumnDefaults(columns, types), [columns, types])
  const [config, setConfig] = useState<ChartConfig>(() => defaultChartConfig(columns, numericColumns, types))
  const [brushed, setBrushed] = useState<number[] | null>(null)
  const [drill, setDrill] = useState<{ label: string; rows: DataRow[] } | null>(null)
  const chartRef = useRef<EChartsInstance | null>(null)

  // One pass per candidate dimension, reused by every recommendation check
  // instead of building a fresh Set for each dimension on every rows change.
  const uniqueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    defaults.dimensions.forEach((column) => {
      const seen = new Set<string>()
      rows.forEach((row) => seen.add(String(row[column] ?? '')))
      counts.set(column, seen.size)
    })
    return counts
  }, [defaults.dimensions, rows])

  const recommendations = useMemo(() => {
    const dimensions = defaults.dimensions
      .filter((column) => {
        const unique = uniqueCounts.get(column) ?? 0
        return unique > 1 && unique <= Math.max(24, Math.round(rows.length / 3))
      })
    const dimension = dimensions[0] ?? defaults.dimension
    const secondDimension = dimensions.find((column) => column !== dimension) ?? ''
    const measure = defaults.measure || numericColumns[0] || ''
    const secondMeasure = numericColumns.find((column) => column !== measure) ?? ''
    const result: Array<{ type: ChartType; reason: Key; patch: Partial<ChartConfig>; mapping: string }> = []

    if (defaults.date && measure) result.push({
      type: 'line', reason: 'recommendTrend',
      patch: { type: 'line', x: defaults.date, y: measure, aggregation: 'sum', sortCategories: false },
      mapping: `${defaults.date} → ${measure}`,
    })
    if (dimension && measure) result.push({
      type: 'bar', reason: 'recommendCompare',
      patch: { type: 'bar', x: dimension, y: measure, aggregation: 'sum', sortCategories: true },
      mapping: `${dimension} → ${measure}`,
    })
    if (dimension && measure && secondDimension) result.push({
      type: 'barGrouped', reason: 'recommendSegment',
      patch: { type: 'barGrouped', x: dimension, y: measure, series: secondDimension, aggregation: 'mean' },
      mapping: `${dimension} × ${secondDimension}`,
    })
    if (measure && secondMeasure) result.push({
      type: 'scatter', reason: 'recommendRelationship',
      patch: { type: 'scatter', x: measure, y: secondMeasure, trendline: true },
      mapping: `${measure} × ${secondMeasure}`,
    })
    if (measure) result.push({
      type: 'histogram', reason: 'recommendDistribution',
      patch: { type: 'histogram', x: measure, bins: 16 },
      mapping: measure,
    })
    if (!measure && dimension) result.push({
      type: 'bar', reason: 'recommendFrequency',
      patch: { type: 'bar', x: dimension, y: dimension, aggregation: 'count', sortCategories: true },
      mapping: dimension,
    })
    return result.slice(0, 5)
  }, [defaults, numericColumns, rows, uniqueCounts])

  useEffect(() => {
    setConfig(defaultChartConfig(columns, numericColumns, types))
    setBrushed(null)
    setDrill(null)
  }, [columns.join('\u0001'), numericColumns.join('\u0001'), types])

  /**
   * Switching chart type can invalidate the current field mapping: a scatter
   * plot cannot use a categorical X, and a bar chart cannot use a measure as
   * its category axis. Rather than render an empty chart, the mapping is
   * repaired to the nearest valid field whenever the type changes.
   */
  const patch = (next: Partial<ChartConfig>) => {
    setConfig((current) => {
      const merged = { ...current, ...next }
      if (next.type && next.type !== current.type) {
        const needsNumericX = ['scatter', 'bubble', 'histogram'].includes(merged.type)
        const needsCategoryX = ['bar', 'barGrouped', 'barStacked', 'line', 'area', 'pie', 'funnel', 'treemap', 'box', 'heatmap', 'radar', 'sankey', 'sunburst', 'parallel'].includes(merged.type)
        if (needsNumericX && types[merged.x] !== 'number') {
          merged.x = defaults.measure || numericColumns[0] || merged.x
        }
        if (needsCategoryX && types[merged.x] === 'number') {
          merged.x = defaults.dimension || columns[0] || merged.x
        }
        if (types[merged.y] !== 'number' && merged.type !== 'parallel' && merged.type !== 'splom') {
          const candidate = numericColumns.find((column) => column !== merged.x)
          merged.y = candidate ?? numericColumns[0] ?? merged.y
        }
        // Scatter needs two genuinely different numeric axes.
        if (needsNumericX && merged.y === merged.x) {
          merged.y = numericColumns.find((column) => column !== merged.x) ?? merged.y
        }
        if (merged.type === 'bubble' && !merged.size) {
          merged.size = numericColumns.find((column) => column !== merged.x && column !== merged.y) ?? ''
        }
      }
      return merged
    })
  }

  const needs = chartNeeds[config.type]
  const built = useMemo(
    () => buildChartOption(rows, config, types, language, msg, theme),
    [rows, config, types, language, msg, theme],
  )
  // Quality stats are constant for a given frame, so cache them: without this
  // every chart option change re-ran a full-table duplicate hash.
  const frameQuality = useMemo(() => measureQuality(frame), [frame])
  const sourceQuality = useMemo(() => measureQuality(sourceFrame), [sourceFrame])
  const insights = useMemo(
    () => generateSmartInsights(frame, sourceFrame, config, frameQuality, sourceQuality),
    [config, frame, sourceFrame, frameQuality, sourceQuality],
  )

  // Brush selection must survive re-renders, so the chart is told about the
  // current brush only when the user clears it — not on every option rebuild.
  const onEvents = useMemo(() => ({
    brushSelected: (params: { batch?: Array<{ selected: Array<{ dataIndex: number[] }> }> }) => {
      const indexes: number[] = []
      params.batch?.forEach((batch) => {
        batch.selected?.forEach((selection) => {
          selection.dataIndex.forEach((dataIndex) => {
            const mapped = built.sourceOrder[dataIndex]
            if (mapped !== undefined) indexes.push(mapped)
          })
        })
      })
      setBrushed(indexes.length ? Array.from(new Set(indexes)) : null)
    },
    click: (params: { name?: string; value?: unknown }) => {
      let matched: DataRow[] = []
      let label = String(params.name ?? '')
      if ((config.type === 'scatter' || config.type === 'bubble') && Array.isArray(params.value)) {
        const [xValue, yValue] = params.value as unknown[]
        matched = rows.filter((row) => toNumber(row[config.x]) === Number(xValue) && toNumber(row[config.y]) === Number(yValue))
        label = `${config.x} ${String(xValue ?? '')} · ${config.y} ${String(yValue ?? '')}`
      } else if (config.x && params.name !== undefined && config.type !== 'histogram') {
        matched = rows.filter((row) => formatCell(row[config.x]) === String(params.name))
        label = `${config.x} = ${String(params.name)}`
      }
      if (matched.length) setDrill({ label, rows: matched })
    },
  }), [built.sourceOrder, config, rows])

  const clearBrush = useCallback(() => {
    setBrushed(null)
    const instance = chartRef.current
    if (instance && typeof instance.dispatchAction === 'function') {
      instance.dispatchAction({ type: 'brush', areas: [] })
    }
  }, [])

  const applyBrush = (keep: boolean) => {
    if (!brushed || !brushed.length) return
    const selected = new Set(brushed)
    const kept = rows.filter((_, index) => (keep ? selected.has(index) : !selected.has(index)))
    const dropped = rows.length - kept.length
    if (!kept.length) return
    addStep({
      kind: 'keepRows',
      rows: kept,
      reason: language === 'zh'
        ? `图表框选：${keep ? '保留' : '排除'} ${dropped || kept.length} 行`
        : `Chart selection: ${keep ? 'kept' : 'excluded'} ${keep ? kept.length : dropped} row(s)`,
    })
    clearBrush()
    notify(msg('brushApplied'))
  }

  const availableX = config.type === 'histogram' || config.type === 'scatter'
    ? numericColumns
    : columns
  const availableY = config.type === 'heatmap' ? numericColumns : numericColumns

  return (
    <div className="visual-layout">
      <aside className="visual-config stack">
        <Panel kicker="ECharts" title={msg('plotBuilder')} actions={<Settings2 size={16} />} dense>
          <span className="field-label">{msg('chartType')}</span>
          <div className="chart-type-grid">
            {CHART_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`chart-type ${config.type === type ? 'active' : ''}`}
                onClick={() => patch({ type })}
                title={msg(type)}
              >
                {CHART_ICONS[type]}
                <span>{msg(type)}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel kicker="schema aware" title={msg('recommendedCharts')} dense>
          <p className="recommendation-hint">{msg('recommendedChartsHint')}</p>
          <div className="recommendation-list">
            {recommendations.map((recommendation, index) => (
              <button
                type="button"
                className="chart-recommendation"
                key={`${recommendation.type}-${recommendation.mapping}-${index}`}
                onClick={() => patch(recommendation.patch)}
              >
                <span className="recommendation-icon">{CHART_ICONS[recommendation.type]}</span>
                <span>
                  <strong>{msg(recommendation.type)}</strong>
                  <small>{recommendation.mapping}</small>
                  <em>{msg(recommendation.reason)}</em>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel kicker="mapping" title={msg('chartOptions')} dense>
          <div className="stack gap-sm">
            {needs.x && (
              <Field label={msg('xAxis')}>
                <Select
                  value={config.x}
                  options={availableX}
                  onChange={(x) => patch({ x })}
                />
              </Field>
            )}
            {needs.y && (
              <Field label={msg('yAxis')}>
                <Select value={config.y} options={availableY.length ? availableY : columns} onChange={(y) => patch({ y })} />
              </Field>
            )}
            {needs.series && (
              <Field
                label={msg('seriesBy')}
                hint={config.type === 'heatmap'
                  ? msg('singleRowHeatHint')
                  : ['sankey', 'sunburst', 'parallel'].includes(config.type)
                    ? msg('secondDimHint')
                    : undefined}
              >
                <Select
                  value={config.series}
                  options={['', ...columns.filter((column) => column !== config.x
                    && (['heatmap', 'sankey', 'sunburst', 'parallel'].includes(config.type) ? types[column] !== 'number' : true))]}
                  labels={(value) => (value === '' ? msg('none') : value)}
                  onChange={(series) => patch({ series })}
                />
              </Field>
            )}
            {needs.size && (
              <Field label={msg('sizeBy')}>
                <Select
                  value={config.size}
                  options={['', ...numericColumns]}
                  labels={(value) => (value === '' ? msg('none') : value)}
                  onChange={(size) => patch({ size })}
                />
              </Field>
            )}
            {!['scatter', 'bubble', 'box', 'histogram', 'radar', 'gauge', 'parallel', 'splom'].includes(config.type) && (
              <Field label={msg('aggregation')}>
                <Select
                  value={config.aggregation}
                  options={AGGREGATIONS}
                  labels={(value) => msg(aggregationLabels[value])}
                  onChange={(aggregation: Aggregation) => patch({ aggregation })}
                />
              </Field>
            )}
            <Field label={msg('chartTitle')}>
              <TextInput
                value={config.title}
                placeholder={`${config.y} ${msg('byWord')} ${config.x}`}
                onChange={(title) => patch({ title })}
              />
            </Field>
          </div>
        </Panel>

        <Panel kicker="options" title={msg('chartOptions')} dense>
          <div className="toggle-grid">
            <Toggle checked={config.showLegend} onChange={(showLegend) => patch({ showLegend })} label={msg('showLegend')} />
            <Toggle checked={config.showLabels} onChange={(showLabels) => patch({ showLabels })} label={msg('showLabels')} />
            <Toggle checked={config.showGrid} onChange={(showGrid) => patch({ showGrid })} label={msg('showGrid')} />
            {(config.type === 'line' || config.type === 'area') && (
              <Toggle checked={config.smooth} onChange={(smooth) => patch({ smooth })} label={msg('smooth')} />
            )}
            {(config.type === 'scatter' || config.type === 'bubble') && (
              <Toggle checked={config.trendline} onChange={(trendline) => patch({ trendline })} label={msg('trendline')} />
            )}
            {config.type === 'bar' && (
              <Toggle checked={config.horizontal} onChange={(horizontal) => patch({ horizontal })} label={msg('horizontal')} />
            )}
            <Toggle checked={config.sortCategories} onChange={(sortCategories) => patch({ sortCategories })} label={msg('sortCategories')} />
          </div>
          <div className="grid-2">
            <Field label={msg('topN')}>
              <TextInput type="number" value={String(config.topN)} onChange={(value) => patch({ topN: Number(value) || 0 })} />
            </Field>
            {config.type === 'histogram' && (
              <Field label={msg('histogramBins')}>
                <TextInput type="number" value={String(config.bins)} onChange={(value) => patch({ bins: Math.max(2, Number(value) || 16) })} />
              </Field>
            )}
          </div>
        </Panel>
      </aside>

      <section className="visual-main stack">
        <Panel
          kicker={`${msg(config.type)} · ${formatNumber(rows.length)} ${msg('rows')}`}
          title={config.title || `${config.y || config.x} ${msg('byWord')} ${config.x || msg('none')}`}
          actions={<div className="row gap wrap">
            <Button variant="subtle" icon={<Pin size={13} />} onClick={() => onPin({ ...config }, insights)}>{msg('pinToStory')}</Button>
            {BRUSHABLE.includes(config.type) ? <span className="badge brush-badge"><Brush size={13} /> {msg('brushHint')}</span> : null}
          </div>}
          dense
        >
          {built.empty ? (
            <div className="no-data">{msg('noData')}</div>
          ) : (
            <>
              <EChart
                option={built.option}
                style={{ height: 520 }}
                notMerge
                lazyUpdate
                onChartReady={(instance: EChartsInstance) => { chartRef.current = instance }}
                onEvents={onEvents}
              />
              {built.colorRange && (
                <div className="color-legend">
                  <span>{formatNumber(built.colorRange.min)}</span>
                  <i className="color-ramp" />
                  <span>{formatNumber(built.colorRange.max)}</span>
                </div>
              )}
              {built.facts.length > 0 && (
                <div className="fact-row">
                  {built.facts.map((fact) => (
                    <div className="fact" key={String(fact.label)}>
                      <span>
                        {typeof fact.label === 'string' && fact.label in aggregationLabels
                          ? msg(aggregationLabels[fact.label as Aggregation])
                          : /^[a-z][a-zA-Z]*$/.test(String(fact.label))
                            ? msg(fact.label as Key)
                            : String(fact.label)}
                      </span>
                      <strong>{fact.value}</strong>
                      {fact.hint && <em>{fact.hint}</em>}
                    </div>
                  ))}
                </div>
              )}
              <section className="smart-insights" aria-label={msg('smartInsights')}>
                <header>
                  <div>
                    <span><Sparkles size={15} />{msg('smartInsights')}</span>
                    <small>{msg('smartInsightsHint')}</small>
                  </div>
                  <Button
                    variant="primary"
                    icon={<Pin size={13} />}
                    onClick={() => onPin({ ...config }, insights)}
                  >
                    {msg('pinInsightsToStory')}
                  </Button>
                </header>
                <div className="smart-insight-grid">
                  {insights.items.map((item) => (
                    <article className={`smart-insight-item ${item.kind}`} key={item.kind}>
                      <span>{language === 'zh' ? item.titleZh : item.titleEn}</span>
                      <p>{language === 'zh' ? item.textZh : item.textEn}</p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </Panel>

        {HINTS[config.type] && (
          <div className="hint-banner">
            <Sigma size={15} />
            {msg(HINTS[config.type]!)}
          </div>
        )}

        <div className="hint-banner"><ChevronRight size={15} />{msg('clickToDrill')}</div>

        {drill && (
          <Panel kicker={`${msg('drilledRows')} · ${formatNumber(drill.rows.length)}`} title={msg('drillDown')} dense>
            <div className="drill-breadcrumb"><button type="button" onClick={() => setDrill(null)}>{msg('allData')}</button><ChevronRight size={13} /><strong>{drill.label}</strong></div>
            <DataTable columns={columns} rows={drill.rows.slice(0, 200)} types={types} maxHeight={300} />
            <div className="row gap drill-actions">
              <Button variant="primary" icon={<Filter size={14} />} onClick={() => addStep({ kind: 'keepRows', rows: drill.rows, reason: `${msg('drillDown')}: ${drill.label}` })}>{msg('applyDrill')}</Button>
              <Button variant="subtle" icon={<X size={14} />} onClick={() => setDrill(null)}>{msg('clearDrill')}</Button>
            </div>
          </Panel>
        )}

        {brushed && brushed.length > 0 && (
          <div className="brush-bar">
            <span className="brush-count">
              <CircleDot size={15} />
              {msg('brushedRows')}: <strong>{formatNumber(brushed.length)}</strong> / {formatNumber(rows.length)}
            </span>
            <div className="row gap">
              <Button variant="primary" icon={<Filter size={14} />} onClick={() => applyBrush(true)}>
                {msg('applyBrush')}
              </Button>
              <Button variant="ghost" icon={<Minus size={14} />} onClick={() => applyBrush(false)}>
                {msg('excludeBrush')}
              </Button>
              <Button variant="subtle" icon={<X size={14} />} onClick={clearBrush}>
                {msg('clearBrush')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <aside className="visual-side stack">
        <Panel kicker="columns" title={msg('columns')} dense>
          <ul className="dtype-list">
            {columns.map((column) => (
              <li key={column}>
                <span>{column}</span>
                <code className={`type-${types[column]}`}>{types[column] ?? 'text'}</code>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  )
}
