import { useEffect, useMemo, useState } from 'react'
import { EChart } from './EChart'
import { AlertTriangle, CheckCircle2, GitCompareArrows, Sparkles, X } from 'lucide-react'
import type { DataFrame, Op, Theme } from '../types'
import type { MessageKey as Key } from '../i18n'
import { correlationMatrix, countDuplicates, detectOutliers, profileColumns, topCorrelations } from '../analysis'
import { buildCorrelationOption, CHART_THEMES } from '../charts'
import { formatNumber, formatRatio, toNumber } from '../utils'
import { Button, EmptyState, Field, Panel, Select, TextInput } from './ui'
import { DataTable } from './DataTable'

interface AutoEdaProps {
  sourceFrame: DataFrame
  frame: DataFrame
  stepCount: number
  theme: Theme
  msg: (key: Key) => string
  onClose: () => void
  addStep: (op: Op, labels?: { zh: string; en: string }) => void
}

interface OutlierColumn {
  column: string
  count: number
  ratio: number
}

const summarize = (frame: DataFrame) => {
  const profiles = profileColumns(frame.rows, frame.columns)
  const missing = profiles.reduce((total, profile) => total + profile.missing, 0)
  const duplicates = countDuplicates(frame.rows)
  const outliers: OutlierColumn[] = profiles
    .filter((profile) => profile.type === 'number' && profile.q1 !== undefined && profile.q3 !== undefined)
    .map((profile) => {
      const iqr = (profile.q3 ?? 0) - (profile.q1 ?? 0)
      const low = (profile.q1 ?? 0) - iqr * 1.5
      const high = (profile.q3 ?? 0) + iqr * 1.5
      const count = frame.rows.reduce((total, row) => {
        const value = toNumber(row[profile.name])
        return total + (value !== null && (value < low || value > high) ? 1 : 0)
      }, 0)
      return { column: profile.name, count, ratio: frame.rows.length ? count / frame.rows.length : 0 }
    })
    .sort((a, b) => b.count - a.count)
  return {
    profiles,
    missing,
    duplicates,
    outliers,
    outlierCells: outliers.reduce((total, item) => total + item.count, 0),
  }
}

export function AutoEdaPanel({ sourceFrame, frame, stepCount, theme, msg, onClose, addStep }: AutoEdaProps) {
  const before = useMemo(() => summarize(sourceFrame), [sourceFrame])
  const current = useMemo(() => summarize(frame), [frame])
  const numericColumns = frame.columns.filter((column) => frame.types[column] === 'number')
  const [outlierColumn, setOutlierColumn] = useState(numericColumns[0] ?? '')
  const [outlierMethod, setOutlierMethod] = useState<'iqr' | 'zscore'>('iqr')
  const [outlierThreshold, setOutlierThreshold] = useState(1.5)
  const [outlierAction, setOutlierAction] = useState<'drop' | 'clip' | 'median'>('clip')

  useEffect(() => {
    if (!numericColumns.includes(outlierColumn)) setOutlierColumn(numericColumns[0] ?? '')
  }, [numericColumns.join('\u0001'), outlierColumn])

  const detected = useMemo(
    () => outlierColumn ? detectOutliers(frame.rows, outlierColumn, outlierMethod, outlierThreshold) : null,
    [frame.rows, outlierColumn, outlierMethod, outlierThreshold],
  )
  const outlierRows = useMemo(() => detected ? detected.indexes.map((index) => frame.rows[index]) : [], [detected, frame.rows])

  const boxStats = (rows: DataFrame['rows'], column: string) => {
    const values = rows.map((row) => toNumber(row[column])).filter((value): value is number => value !== null).sort((a, b) => a - b)
    if (!values.length) return [0, 0, 0, 0, 0]
    const at = (ratio: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))]
    return [values[0], at(.25), at(.5), at(.75), values[values.length - 1]]
  }
  const outlierComparisonOption = useMemo(() => {
    const ct = CHART_THEMES[theme]
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      grid: { left: 28, right: 24, top: 20, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category', data: [msg('beforeCleaning'), msg('afterCleaning')],
        axisLabel: { color: ct.axisLabel }, axisLine: { lineStyle: { color: ct.axisLine } },
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: ct.axisLabel }, splitLine: { lineStyle: { color: ct.splitLine } },
      },
      series: [{
        type: 'boxplot',
        data: [boxStats(sourceFrame.rows, outlierColumn), boxStats(frame.rows, outlierColumn)],
        itemStyle: { color: ct.boxFill, borderColor: ct.palette[0] },
      }],
    }
  }, [frame.rows, msg, outlierColumn, sourceFrame.rows, theme])

  const missingColumns = current.profiles
    .filter((profile) => profile.missing > 0)
    .sort((a, b) => b.missingRatio - a.missingRatio)

  const missingOption = useMemo(() => {
    const ct = CHART_THEMES[theme]
    return {
      animationDuration: 320,
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      grid: { left: 18, right: 24, top: 12, bottom: 20, containLabel: true },
      xAxis: {
        type: 'value', max: 100,
        axisLabel: { formatter: '{value}%', color: ct.axisLabel },
        splitLine: { lineStyle: { color: ct.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: missingColumns.map((profile) => profile.name).reverse(),
        axisLabel: { width: 110, overflow: 'truncate', color: ct.axisLabel },
        axisLine: { lineStyle: { color: ct.axisLine } },
      },
      series: [{
        type: 'bar',
        data: missingColumns.map((profile) => Number((profile.missingRatio * 100).toFixed(2))).reverse(),
        barMaxWidth: 24,
        itemStyle: { color: '#155EEF', borderRadius: [0, 2, 2, 0] },
        label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10, color: ct.axisLabel },
      }],
    }
  }, [missingColumns, theme])

  const visibleOutliers = current.outliers.filter((item) => item.count > 0)
  useEffect(() => {
    if (detected && detected.indexes.length === 0 && visibleOutliers.length > 0) {
      setOutlierColumn(visibleOutliers[0].column)
    }
  }, [detected, visibleOutliers])
  const outlierOption = useMemo(() => {
    const ct = CHART_THEMES[theme]
    return {
      animationDuration: 320,
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      grid: { left: 18, right: 30, top: 12, bottom: 20, containLabel: true },
      xAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { color: ct.axisLabel }, splitLine: { lineStyle: { color: ct.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: visibleOutliers.map((item) => item.column).reverse(),
        axisLabel: { width: 110, overflow: 'truncate', color: ct.axisLabel },
        axisLine: { lineStyle: { color: ct.axisLine } },
      },
      series: [{
        type: 'bar',
        data: visibleOutliers.map((item) => item.count).reverse(),
        barMaxWidth: 24,
        itemStyle: { color: '#C7F000', borderRadius: [0, 2, 2, 0] },
        label: { show: true, position: 'right', fontSize: 10, color: ct.axisLabel },
      }],
    }
  }, [visibleOutliers, theme])

  const comparisonOption = useMemo(() => {
    const ct = CHART_THEMES[theme]
    return {
      animationDuration: 320,
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, borderWidth: 1,
        textStyle: { color: ct.tooltipFg, fontSize: 12 },
      },
      legend: { bottom: 0, icon: 'circle', textStyle: { color: ct.axisLabel, fontSize: 11 } },
      grid: { left: 22, right: 18, top: 18, bottom: 42, containLabel: true },
      xAxis: {
        type: 'category', data: [msg('rows'), msg('missing'), msg('duplicates'), msg('outlierCells')],
        axisLabel: { color: ct.axisLabel, interval: 0 }, axisLine: { lineStyle: { color: ct.axisLine } },
      },
      yAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { color: ct.axisLabel }, splitLine: { lineStyle: { color: ct.splitLine } },
      },
      series: [
        { name: msg('beforeCleaning'), type: 'bar', data: [sourceFrame.rows.length, before.missing, before.duplicates, before.outlierCells], itemStyle: { color: '#C9CED8', borderRadius: [2, 2, 0, 0] } },
        { name: msg('afterCleaning'), type: 'bar', data: [frame.rows.length, current.missing, current.duplicates, current.outlierCells], itemStyle: { color: '#155EEF', borderRadius: [2, 2, 0, 0] } },
      ],
    }
  }, [before, current, frame.rows.length, msg, sourceFrame.rows.length, theme])

  const strongest = useMemo(() => {
    if (numericColumns.length < 2) return null
    return topCorrelations(correlationMatrix(frame.rows, numericColumns), 1)[0] ?? null
  }, [frame.rows, numericColumns])

  const highestMissing = missingColumns[0]
  const highestOutlier = visibleOutliers[0]
  const changes = [
    { label: msg('rows'), before: sourceFrame.rows.length, after: frame.rows.length },
    { label: msg('missing'), before: before.missing, after: current.missing },
    { label: msg('duplicates'), before: before.duplicates, after: current.duplicates },
    { label: msg('outlierCells'), before: before.outlierCells, after: current.outlierCells },
  ]

  return (
    <section className="auto-eda" aria-label={msg('autoEda')}>
      <div className="auto-eda-head">
        <div>
          <span className="kicker">Auto EDA · pandas profiling</span>
          <h2>{msg('autoEda')}</h2>
          <p>{msg('autoEdaHint')}</p>
        </div>
        <Button variant="subtle" icon={<X size={14} />} onClick={onClose}>{msg('close')}</Button>
      </div>

      <div className="eda-change-grid">
        {changes.map((item) => {
          const delta = item.after - item.before
          return (
            <article key={item.label}>
              <span>{item.label}</span>
              <div><small>{formatNumber(item.before)}</small><b>→</b><strong>{formatNumber(item.after)}</strong></div>
              <em className={delta < 0 ? 'good' : delta > 0 ? 'warn' : ''}>
                {delta > 0 ? '+' : ''}{formatNumber(delta)}
              </em>
            </article>
          )
        })}
      </div>

      <div className="eda-insights">
        <div><Sparkles size={16} /><span>{msg('pipelineSteps')}</span><strong>{stepCount}</strong></div>
        <div><AlertTriangle size={16} /><span>{msg('highestMissing')}</span><strong>{highestMissing ? `${highestMissing.name} · ${formatRatio(highestMissing.missingRatio)}` : msg('none')}</strong></div>
        <div><AlertTriangle size={16} /><span>{msg('highestOutlier')}</span><strong>{highestOutlier ? `${highestOutlier.column} · ${formatNumber(highestOutlier.count)}` : msg('none')}</strong></div>
        <div><GitCompareArrows size={16} /><span>{msg('strongestRelationship')}</span><strong>{strongest ? `${strongest.x} × ${strongest.y} · ${strongest.value.toFixed(2)}` : msg('needsTwoNumeric')}</strong></div>
      </div>

      <div className="split-2">
        <Panel kicker="isna().mean()" title={msg('missingAnalysis')} dense>
          {missingColumns.length
            ? <EChart option={missingOption} style={{ height: Math.max(250, missingColumns.length * 34) }} notMerge />
            : <EdaClear title={msg('noMissing')} />}
        </Panel>
        <Panel kicker="IQR · 1.5×" title={msg('outlierAnalysis')} dense>
          {visibleOutliers.length
            ? <EChart option={outlierOption} style={{ height: Math.max(250, visibleOutliers.length * 34) }} notMerge onEvents={{ click: (params: { name?: string }) => { if (params.name) setOutlierColumn(params.name) } }} />
            : <EdaClear title={msg('noOutliers')} />}
          <p className="eda-method">{msg('outlierRule')}</p>
        </Panel>
      </div>

      <div className="split-2">
        <Panel kicker="source → pipeline" title={msg('beforeAfter')} dense>
          <EChart option={comparisonOption} style={{ height: 330 }} notMerge />
          {!stepCount && <p className="eda-method">{msg('beforeAfterEmpty')}</p>}
        </Panel>
        <Panel kicker="DataFrame.corr()" title={msg('correlation')} dense>
          {numericColumns.length >= 2
            ? <EChart option={buildCorrelationOption(frame.rows, numericColumns, 'pearson', theme)} style={{ height: 330 }} notMerge />
            : <EmptyState title={msg('needsTwoNumeric')} />}
        </Panel>
      </div>

      {numericColumns.length > 0 && (
        <Panel kicker="IQR · Z-score · winsorize" title={msg('outlierWorkbench')} dense>
          <div className="outlier-controls grid-4">
            <Field label={msg('column')}><Select value={outlierColumn} options={numericColumns} onChange={setOutlierColumn} /></Field>
            <Field label={msg('operation')}><Select value={outlierMethod} options={['iqr', 'zscore']} labels={(value) => msg(value === 'iqr' ? 'iqrMethod' : 'zscoreMethod')} onChange={(value) => { const method = value as 'iqr' | 'zscore'; setOutlierMethod(method); setOutlierThreshold(method === 'iqr' ? 1.5 : 3) }} /></Field>
            <Field label={msg('threshold')}><TextInput type="number" value={String(outlierThreshold)} onChange={(value) => setOutlierThreshold(Math.max(.1, Number(value) || 1.5))} /></Field>
            <Field label={msg('treatment')}><Select value={outlierAction} options={['drop', 'clip', 'median']} labels={(value) => msg(value === 'drop' ? 'dropOutliers' : value === 'clip' ? 'winsorize' : 'replaceMedian')} onChange={(value) => setOutlierAction(value as 'drop' | 'clip' | 'median')} /></Field>
          </div>
          <div className="outlier-summary">
            <span>{msg('detectedRows')} <strong>{formatNumber(outlierRows.length)}</strong></span>
            <span>{msg('outlierBounds')} <strong>{detected ? `${formatNumber(detected.low)} — ${formatNumber(detected.high)}` : '—'}</strong></span>
          </div>
          <div className="split-2 outlier-workspace">
            <div><EChart option={outlierComparisonOption} style={{ height: 300 }} notMerge /><p className="eda-method">{msg('outlierBeforeAfter')}</p></div>
            <DataTable columns={frame.columns} rows={outlierRows.slice(0, 100)} types={frame.types} maxHeight={315} />
          </div>
          <div className="row gap outlier-apply">
            <Button variant="primary" disabled={!outlierRows.length} onClick={() => addStep({ kind: 'outliers', column: outlierColumn, method: outlierMethod, threshold: outlierThreshold, action: outlierAction })}>{msg('applyTreatment')}</Button>
            <code>df[{outlierColumn}] · {outlierMethod === 'iqr' ? `IQR × ${outlierThreshold}` : `|z| &gt; ${outlierThreshold}`}</code>
          </div>
        </Panel>
      )}
    </section>
  )
}

function EdaClear({ title }: { title: string }) {
  return (
    <div className="eda-clear">
      <CheckCircle2 size={28} />
      <strong>{title}</strong>
    </div>
  )
}
