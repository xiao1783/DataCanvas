import { useMemo, useState } from 'react'
import { EChart } from './EChart'
import { Activity, CalendarRange, CircleAlert, TrendingUp } from 'lucide-react'
import type { Aggregation, DataFrame, Language, Theme } from '../types'
import type { MessageKey as Key } from '../i18n'
import { aggregationLabels } from '../i18n'
import { deriveColumnDefaults } from '../defaults'
import { formatNumber, maxOf, minOf, toNumber } from '../utils'
import { CHART_THEMES } from '../charts'
import { Field, Panel, Select, Toggle } from './ui'

type Grain = 'day' | 'week' | 'month' | 'quarter'
type MetricMode = 'actual' | 'change' | 'yoy' | 'cumulative'
type RaceMode = 'bar' | 'bubble'

interface TimeSeriesProps {
  frame: DataFrame
  language: Language
  theme: Theme
  msg: (key: Key) => string
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

const periodKey = (date: Date, grain: Grain) => {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (grain === 'quarter') return `${year}-Q${Math.floor(month / 3) + 1}`
  if (grain === 'month') return `${year}-${String(month + 1).padStart(2, '0')}`
  if (grain === 'week') {
    const monday = new Date(Date.UTC(year, month, date.getUTCDate()))
    const day = monday.getUTCDay() || 7
    monday.setUTCDate(monday.getUTCDate() - day + 1)
    return isoDay(monday)
  }
  return isoDay(date)
}

const aggregate = (values: number[], method: Aggregation) => {
  if (method === 'count') return values.length
  if (!values.length) return 0
  if (method === 'sum') return values.reduce((a, b) => a + b, 0)
  if (method === 'min') return minOf(values)
  if (method === 'max') return maxOf(values)
  return values.reduce((a, b) => a + b, 0) / values.length
}

const movingAverage = (values: Array<number | null>, window: number) => values.map((_, index) => {
  const slice = values.slice(Math.max(0, index - window + 1), index + 1).filter((value): value is number => value !== null)
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null
})

const lagFor = (grain: Grain) => grain === 'quarter' ? 4 : grain === 'month' ? 12 : grain === 'week' ? 52 : 365

export function TimeSeriesPanel({ frame, language, theme, msg }: TimeSeriesProps) {
  const defaults = useMemo(() => deriveColumnDefaults(frame.columns, frame.types), [frame.columns, frame.types])
  const dateColumns = frame.columns.filter((column) => frame.types[column] === 'date')
  const numericColumns = frame.columns.filter((column) => frame.types[column] === 'number')
  const dimensionColumns = frame.columns.filter((column) => frame.types[column] === 'text' || frame.types[column] === 'boolean')
  const [dateColumn, setDateColumn] = useState(defaults.date || dateColumns[0] || '')
  const [measure, setMeasure] = useState(defaults.measure || numericColumns[0] || '')
  const [dimension, setDimension] = useState('')
  const [grain, setGrain] = useState<Grain>('month')
  const [aggregation, setAggregation] = useState<Aggregation>('sum')
  const [mode, setMode] = useState<MetricMode>('actual')
  const [moving, setMoving] = useState(true)
  const [window, setWindow] = useState(3)
  const [showAnomalies, setShowAnomalies] = useState(true)

  /* Timeline race state — Rosling-style animated playback over periods. */
  const primaryMeasure = defaults.measure || numericColumns[0] || ''
  const [raceMode, setRaceMode] = useState<RaceMode>('bar')
  const [raceCategory, setRaceCategory] = useState('')
  const [raceGrain, setRaceGrain] = useState<Grain>('month')
  const [raceMeasure, setRaceMeasure] = useState(primaryMeasure)
  const [raceX, setRaceX] = useState(primaryMeasure)
  const [raceY, setRaceY] = useState(numericColumns.find((column) => column !== primaryMeasure) ?? primaryMeasure)
  const [raceSize, setRaceSize] = useState(numericColumns.find((column) => column !== primaryMeasure && column !== (numericColumns.find((c) => c !== primaryMeasure) ?? '')) ?? primaryMeasure)
  const [speed, setSpeed] = useState(1200)

  const bounds = useMemo(() => {
    const dates = frame.rows.map((row) => new Date(String(row[dateColumn] ?? ''))).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => a.getTime() - b.getTime())
    return { min: dates[0] ? isoDay(dates[0]) : '', max: dates.at(-1) ? isoDay(dates.at(-1)!) : '' }
  }, [dateColumn, frame.rows])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const analysis = useMemo(() => {
    const startTime = start ? new Date(start).getTime() : -Infinity
    const endTime = end ? new Date(`${end}T23:59:59Z`).getTime() : Infinity
    const buckets = new Map<string, Map<string, number[]>>()
    const totals = new Map<string, number>()
    frame.rows.forEach((row) => {
      const date = new Date(String(row[dateColumn] ?? ''))
      const value = toNumber(row[measure])
      if (Number.isNaN(date.getTime()) || value === null || date.getTime() < startTime || date.getTime() > endTime) return
      const period = periodKey(date, grain)
      const series = dimension ? String(row[dimension] ?? msg('none')) : measure
      const bySeries = buckets.get(period) ?? new Map<string, number[]>()
      const values = bySeries.get(series) ?? []
      values.push(value)
      bySeries.set(series, values)
      buckets.set(period, bySeries)
      totals.set(series, (totals.get(series) ?? 0) + value)
    })
    const periods = Array.from(buckets.keys()).sort()
    const seriesNames = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name)
    const lag = lagFor(grain)
    const series = seriesNames.map((name) => {
      const actual = periods.map((period) => aggregate(buckets.get(period)?.get(name) ?? [], aggregation))
      let values = actual
      if (mode === 'change') values = actual.map((value, index) => index && actual[index - 1] !== 0 ? ((value - actual[index - 1]) / Math.abs(actual[index - 1])) * 100 : 0)
      if (mode === 'yoy') values = actual.map((value, index) => index >= lag && actual[index - lag] !== 0 ? ((value - actual[index - lag]) / Math.abs(actual[index - lag])) * 100 : 0)
      if (mode === 'cumulative') {
        let total = 0
        values = actual.map((value) => (total += value))
      }
      return { name, actual, values, moving: movingAverage(values, Math.max(2, window)) }
    })
    const combined = series.flatMap((item) => item.values)
    const avg = combined.length ? combined.reduce((a, b) => a + b, 0) / combined.length : 0
    const std = Math.sqrt(combined.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, combined.length - 1))
    const points = series.flatMap((item) => item.values.map((value, index) => ({ name: item.name, period: periods[index], value })))
    const peak = [...points].sort((a, b) => b.value - a.value)[0]
    const trough = [...points].sort((a, b) => a.value - b.value)[0]
    const anomalies = points.filter((point) => std > 0 && Math.abs((point.value - avg) / std) >= 2)
    let gaps = 0
    for (let index = 1; index < periods.length; index += 1) {
      const previous = periods[index - 1]
      const current = periods[index]
      if (grain === 'month') {
        const [py, pm] = previous.split('-').map(Number)
        const [cy, cm] = current.split('-').map(Number)
        if ((cy * 12 + cm) - (py * 12 + pm) > 1) gaps += 1
      } else if (grain === 'quarter') {
        const [py, pq] = previous.replace('Q', '').split('-').map(Number)
        const [cy, cq] = current.replace('Q', '').split('-').map(Number)
        if ((cy * 4 + cq) - (py * 4 + pq) > 1) gaps += 1
      } else {
        const diff = (new Date(current).getTime() - new Date(previous).getTime()) / 86400000
        if (diff > (grain === 'week' ? 7 : 1) * 1.5) gaps += 1
      }
    }
    return { periods, series, peak, trough, anomalies, gaps }
  }, [aggregation, dateColumn, dimension, end, frame.rows, grain, measure, mode, msg, start, window])

  const option = useMemo(() => {
    const ct = CHART_THEMES[theme]
    return {
      animationDuration: 350,
      color: ct.palette,
      tooltip: {
        trigger: 'axis',
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      legend: { top: 0, type: 'scroll', icon: 'circle', textStyle: { color: ct.axisLabel, fontSize: 11 } },
      grid: { left: 60, right: 26, top: 48, bottom: 62 },
      xAxis: {
        type: 'category', data: analysis.periods, boundaryGap: false,
        axisLabel: { rotate: 0, hideOverlap: true, color: ct.axisLabel },
        axisLine: { lineStyle: { color: ct.axisLine } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: mode === 'change' || mode === 'yoy' ? '{value}%' : '{value}',
          color: ct.axisLabel,
        },
        splitLine: { lineStyle: { color: ct.splitLine } },
      },
      dataZoom: analysis.periods.length > 18
        ? [{ type: 'inside' }, {
            type: 'slider', height: 18, bottom: 12,
            backgroundColor: 'transparent',
            fillerColor: 'rgba(21,94,239,.13)',
            borderColor: 'transparent',
            moveHandleStyle: { color: ct.axisLabel },
            textStyle: { color: ct.axisLabel },
          }]
        : [],
      series: analysis.series.flatMap((item, seriesIndex) => {
        const anomalyData = showAnomalies
          ? analysis.anomalies.filter((point) => point.name === item.name).map((point) => ({ coord: [point.period, point.value], value: formatNumber(point.value) }))
          : []
        const base = {
          name: item.name,
          type: 'line',
          data: item.values.map((value) => Number(value.toFixed(3))),
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 2.4 },
          markPoint: { symbolSize: 44, label: { fontSize: 9 }, data: anomalyData },
          markLine: seriesIndex === 0 ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: ct.markLine }, data: [{ type: 'average', name: msg('averageLine') }] } : undefined,
        }
        return moving
          ? [base, { name: `${item.name} · MA${window}`, type: 'line', data: item.moving.map((value) => value === null ? null : Number(value.toFixed(3))), showSymbol: false, lineStyle: { width: 1.5, type: 'dashed', opacity: .72 } }]
          : [base]
      }),
    }
  }, [analysis, mode, moving, msg, showAnomalies, theme, window])

  /* ---------------------------------------------------------------- *
   * Timeline race — per-period aggregates per category, replayed as
   * either an auto-ranking bar race or a two-metric bubble race.
   * ---------------------------------------------------------------- */
  const race = useMemo(() => {
    const textColumns = frame.columns.filter((column) => frame.types[column] === 'text' || frame.types[column] === 'boolean')
    const category = textColumns.includes(raceCategory)
      ? raceCategory
      // Smart default: prefer the lowest-cardinality text field (a Region-like
      // dimension makes a readable race; an ID field does not).
      : (() => {
        const stride = Math.max(1, Math.floor(frame.rows.length / 500))
        let best: string | null = null
        let bestCount = Infinity
        textColumns.forEach((column) => {
          const uniques = new Set<string>()
          for (let index = 0; index < frame.rows.length; index += stride) {
            uniques.add(String(frame.rows[index][column] ?? '').trim())
            if (uniques.size > 12) break
          }
          if (uniques.size >= 2 && uniques.size < bestCount) {
            best = column
            bestCount = uniques.size
          }
        })
        return best ?? textColumns[0] ?? ''
      })()
    const metrics = raceMode === 'bubble' ? [raceX, raceY, raceSize] : [raceMeasure]
    if (!category || metrics.some((metric) => !metric || !frame.columns.includes(metric))) return null
    const buckets = new Map<string, Map<string, Map<string, number[]>>>()
    frame.rows.forEach((row) => {
      const date = new Date(String(row[dateColumn] ?? ''))
      if (Number.isNaN(date.getTime())) return
      const cat = String(row[category] ?? '').trim() || msg('none')
      const period = periodKey(date, raceGrain)
      const perPeriod = buckets.get(period) ?? new Map<string, Map<string, number[]>>()
      const perCat = perPeriod.get(cat) ?? new Map<string, number[]>()
      metrics.forEach((metric) => {
        const value = toNumber(row[metric])
        if (value !== null) {
          const list = perCat.get(metric) ?? []
          list.push(value)
          perCat.set(metric, list)
        }
      })
      perPeriod.set(cat, perCat)
      buckets.set(period, perPeriod)
    })
    const periods = Array.from(buckets.keys()).sort()
    if (!periods.length) return null
    const primary = metrics[0]
    const totals = new Map<string, number>()
    buckets.forEach((perCat) => perCat.forEach((perMetric, cat) => {
      const list = perMetric.get(primary) ?? []
      totals.set(cat, (totals.get(cat) ?? 0) + list.reduce((a, b) => a + b, 0))
    }))
    const categories = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name)
    const cells = new Map<string, Map<string, { x: number; y: number; size: number }>>()
    let maxSize = 0
    buckets.forEach((perCat, period) => {
      const frameMap = new Map<string, { x: number; y: number; size: number }>()
      categories.forEach((cat) => {
        const perMetric = perCat.get(cat)
        if (!perMetric) return
        const values = metrics.map((metric) => (perMetric.get(metric)?.length ? aggregate(perMetric.get(metric)!, 'sum') : null))
        if (values.some((value) => value === null)) return
        const point = raceMode === 'bubble'
          ? { x: values[0]!, y: values[1]!, size: values[2]! }
          : { x: 0, y: 0, size: values[0]! }
        frameMap.set(cat, point)
        if (point.size > maxSize) maxSize = point.size
      })
      cells.set(period, frameMap)
    })
    return { category, periods, categories, cells, maxSize }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateColumn, frame.columns, frame.rows, frame.types, raceCategory, raceGrain, raceMeasure, raceMode, raceSize, raceX, raceY, msg])

  const raceOption = useMemo(() => {
    if (!race) return null
    const ct = CHART_THEMES[theme]
    const timeline = {
      axisType: 'category' as const,
      data: race.periods,
      autoPlay: true,
      playInterval: speed,
      loop: true,
      lineStyle: { color: ct.axisLine },
      itemStyle: { color: ct.axisLabel },
      checkpointStyle: { color: ct.palette[0], borderWidth: 2, label: { color: ct.tooltipFg, fontSize: 10 } },
      controlStyle: { color: ct.axisLabel, borderColor: ct.axisLabel, itemGap: 6 },
      label: { color: ct.axisLabel, fontSize: 10 },
      emphasis: { itemStyle: { color: ct.palette[0] } },
    }
    if (raceMode === 'bar') {
      return {
        timeline,
        baseOption: {
          grid: { left: 112, right: 96, top: 26, bottom: 84 },
          tooltip: {
            trigger: 'item',
            backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
            textStyle: { color: ct.tooltipFg, fontSize: 12 },
            formatter: (params: unknown) => {
              const item = (Array.isArray(params) ? params[0] : params) as { name?: string; value?: number }
              return `${item.name ?? ''}: ${formatNumber(item.value ?? 0)}`
            },
          },
          xAxis: {
            type: 'value', max: 'dataMax',
            axisLabel: { color: ct.axisLabel, formatter: (value: number) => formatNumber(value) },
            splitLine: { lineStyle: { color: ct.splitLine } },
          },
          yAxis: {
            type: 'category', data: race.categories, animationDuration: 250, animationDurationUpdate: 250,
            axisLabel: { color: ct.axisLabel, fontSize: 11, width: 92, overflow: 'truncate' },
            axisLine: { lineStyle: { color: ct.axisLine } },
          },
          series: [{
            type: 'bar', barMaxWidth: 26,
            itemStyle: { color: ct.palette[0], borderRadius: [0, 5, 5, 0] },
            label: { show: true, position: 'right', valueAnimation: true, color: ct.tooltipFg, formatter: (params: { value: number }) => formatNumber(params.value) },
          }],
          title: {
            text: '', right: 48, bottom: 88,
            textStyle: { fontSize: 34, fontWeight: 700, color: ct.palette[0], fontFamily: 'JetBrains Mono, Consolas, monospace' },
          },
        },
        options: race.periods.map((period) => {
          const rows = race.categories
            .map((name) => ({ name, value: race.cells.get(period)?.get(name)?.size ?? null }))
            .filter((item): item is { name: string; value: number } => item.value !== null && item.value > 0)
            .sort((a, b) => b.value - a.value)
          return {
            title: { text: period },
            yAxis: { data: rows.map((row) => row.name) },
            series: [{ data: rows }],
          }
        }),
      }
    }
    return {
      timeline,
      baseOption: {
        grid: { left: 74, right: 34, top: 46, bottom: 88 },
        legend: { top: 0, type: 'scroll', icon: 'circle', textStyle: { color: ct.axisLabel, fontSize: 11 } },
        tooltip: {
          trigger: 'item',
          backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
          textStyle: { color: ct.tooltipFg, fontSize: 12 },
          formatter: (params: unknown) => {
            const item = (Array.isArray(params) ? params[0] : params) as { seriesName?: string; value?: number[] }
            if (!item?.value) return ''
            return `<b>${item.seriesName ?? ''}</b><br/>${raceX}: ${formatNumber(item.value[0])}<br/>${raceY}: ${formatNumber(item.value[1])}<br/>${raceSize}: ${formatNumber(item.value[2])}`
          },
        },
        xAxis: {
          type: 'value', scale: true, name: raceX, nameTextStyle: { color: ct.axisLabel, fontSize: 10 },
          axisLabel: { color: ct.axisLabel, formatter: (value: number) => formatNumber(value) },
          splitLine: { lineStyle: { color: ct.splitLine } },
          axisLine: { lineStyle: { color: ct.axisLine } },
        },
        yAxis: {
          type: 'value', scale: true, name: raceY, nameTextStyle: { color: ct.axisLabel, fontSize: 10 },
          axisLabel: { color: ct.axisLabel, formatter: (value: number) => formatNumber(value) },
          splitLine: { lineStyle: { color: ct.splitLine } },
        },
        series: race.categories.map((name, index) => ({
          name,
          type: 'scatter',
          itemStyle: { color: ct.palette[index % ct.palette.length], opacity: 0.85 },
          label: { show: true, position: 'right', fontSize: 10, color: ct.tooltipFg, formatter: () => name },
          data: [] as number[][],
        })),
        title: {
          text: '', right: 44, top: 44,
          textStyle: { fontSize: 32, fontWeight: 700, color: ct.palette[0], fontFamily: 'JetBrains Mono, Consolas, monospace' },
        },
      },
      options: race.periods.map((period) => ({
        title: { text: period },
        series: race.categories.map((name) => {
          const cell = race.cells.get(period)?.get(name)
          return {
            data: cell ? [[cell.x, cell.y, cell.size]] : [] as number[][],
            symbolSize: cell ? 10 + 44 * Math.sqrt(Math.max(0, cell.size) / (race.maxSize || 1)) : 10,
          }
        }),
      })),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, raceMode, raceX, raceY, speed, theme, msg])


  if (!dateColumns.length || !numericColumns.length) return <div className="no-data">{msg('timeSeriesNeedsFields')}</div>

  return (
    <div className="stack">
      <div className="time-controls panel">
        <div className="panel-head"><div><span className="kicker">resample · rolling · pct_change</span><h2>{msg('timeSeriesCenter')}</h2></div></div>
        <div className="grid-4">
          <Field label={msg('dateColumn')}><Select value={dateColumn} options={dateColumns} onChange={setDateColumn} /></Field>
          <Field label={msg('measure')}><Select value={measure} options={numericColumns} onChange={setMeasure} /></Field>
          <Field label={msg('timeGrain')}><Select value={grain} options={['day', 'week', 'month', 'quarter']} labels={(value) => msg(value as Key)} onChange={(value) => setGrain(value as Grain)} /></Field>
          <Field label={msg('aggregation')}><Select value={aggregation} options={['sum', 'mean', 'min', 'max', 'count']} labels={(value) => msg(aggregationLabels[value as Aggregation])} onChange={(value) => setAggregation(value as Aggregation)} /></Field>
          <Field label={msg('seriesDimension')}><Select value={dimension} options={['', ...dimensionColumns]} labels={(value) => value || msg('none')} onChange={setDimension} /></Field>
          <Field label={msg('metricMode')}><Select value={mode} options={['actual', 'change', 'yoy', 'cumulative']} labels={(value) => msg(value as Key)} onChange={(value) => setMode(value as MetricMode)} /></Field>
          <Field label={msg('startDate')}><input className="control" type="date" min={bounds.min} max={bounds.max} value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <Field label={msg('endDate')}><input className="control" type="date" min={bounds.min} max={bounds.max} value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
        </div>
        <div className="row gap wrap time-toggles">
          <Toggle checked={moving} onChange={setMoving} label={msg('movingAverage')} />
          <label className="inline-number">{msg('window')} <input type="number" min="2" max="24" value={window} onChange={(event) => setWindow(Number(event.target.value) || 3)} /></label>
          <Toggle checked={showAnomalies} onChange={setShowAnomalies} label={msg('markAnomalies')} />
        </div>
      </div>

      <div className="time-kpis">
        <TimeKpi icon={<TrendingUp size={17} />} label={msg('peak')} value={analysis.peak ? `${analysis.peak.period} · ${formatNumber(analysis.peak.value)}` : '—'} />
        <TimeKpi icon={<Activity size={17} />} label={msg('trough')} value={analysis.trough ? `${analysis.trough.period} · ${formatNumber(analysis.trough.value)}` : '—'} />
        <TimeKpi icon={<CircleAlert size={17} />} label={msg('anomalyPoints')} value={formatNumber(analysis.anomalies.length)} />
        <TimeKpi icon={<CalendarRange size={17} />} label={msg('dateGaps')} value={formatNumber(analysis.gaps)} />
      </div>

      <Panel kicker={`${grain} · ${aggregation}`} title={`${measure} · ${msg(mode as Key)}`}>
        <EChart option={option} style={{ height: 500 }} notMerge />
        <p className="eda-method">{msg('timeSeriesMethod')}</p>
      </Panel>

      {race && raceOption && (
        <Panel kicker="timeline · play" title={msg('raceTitle')}>
          <div className="grid-4">
            <Field label={msg('raceMode')}>
              <Select value={raceMode} options={['bar', 'bubble']} labels={(value) => msg(value as Key)} onChange={(value) => setRaceMode(value as RaceMode)} />
            </Field>
            <Field label={msg('seriesDimension')}>
              <Select value={race.category} options={frame.columns.filter((column) => frame.types[column] === 'text' || frame.types[column] === 'boolean')} onChange={(value) => setRaceCategory(value)} />
            </Field>
            {raceMode === 'bar' ? (
              <Field label={msg('measure')}>
                <Select value={raceMeasure} options={numericColumns} onChange={setRaceMeasure} />
              </Field>
            ) : (
              <>
                <Field label={msg('raceX')}><Select value={raceX} options={numericColumns} onChange={setRaceX} /></Field>
                <Field label={msg('raceY')}><Select value={raceY} options={numericColumns} onChange={setRaceY} /></Field>
                <Field label={msg('raceSize')}><Select value={raceSize} options={numericColumns} onChange={setRaceSize} /></Field>
              </>
            )}
            <Field label={msg('timeGrain')}>
              <Select value={raceGrain} options={['day', 'week', 'month', 'quarter']} labels={(value) => msg(value as Key)} onChange={(value) => setRaceGrain(value as Grain)} />
            </Field>
            <Field label={msg('playSpeed')}>
              <Select
                value={String(speed)}
                options={['600', '1200', '2200']}
                labels={(value) => msg(value === '600' ? 'speedFast' : value === '1200' ? 'speedNormal' : 'speedSlow')}
                onChange={(value) => setSpeed(Number(value))}
              />
            </Field>
          </div>
          <EChart option={raceOption} style={{ height: 520 }} notMerge />
          <p className="eda-method">{msg('raceHint')}</p>
        </Panel>
      )}
    </div>
  )
}

function TimeKpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article><span>{icon}{label}</span><strong>{value}</strong></article>
}
