import { useMemo, useState } from 'react'
import { EChart } from './EChart'
import { BarChart3, Grid3X3, Hash, Layers, Plus, Sigma, Trash2, X } from 'lucide-react'
import type {
  Aggregation, DataRow, DataFrame, DataType, GroupAgg, Language, Op, Theme,
} from '../types'
import type { MessageKey as Key } from '../i18n'
import { AGGREGATIONS, aggregationLabels } from '../i18n'
import {
  correlationMatrix, crossTab, describeColumn, groupByAggregate, pivotTable, topCorrelations, topValues,
} from '../analysis'
import { buildChartOption, buildCorrelationOption, buildGroupedBarOption, defaultChartConfig } from '../charts'
import { formatNumber, formatRatio, uid } from '../utils'
import { DataTable } from './DataTable'
import { Button, EmptyState, Field, IconButton, MultiSelect, Panel, Select, TextInput, Toggle } from './ui'

type Mode = 'group' | 'pivot' | 'correlation' | 'describe'

export interface AnalyzeProps {
  frame: DataFrame
  language: Language
  theme: Theme
  msg: (key: Key) => string
  addStep: (op: Op, labels?: { zh: string; en: string }) => void
}

export function AnalyzePanel({ frame, language, theme, msg, addStep }: AnalyzeProps) {
  const { rows, columns, types } = frame
  const numericColumns = columns.filter((column) => types[column] === 'number')
  const categorical = columns.filter((column) => types[column] !== 'number')
  const [mode, setMode] = useState<Mode>('group')

  /* ------------------------------------------------------ groupby */
  const [groupKeys, setGroupKeys] = useState<string[]>(
    categorical.includes('Category') ? ['Category'] : categorical.slice(0, 1),
  )
  const [aggs, setAggs] = useState<Array<{ id: string; column: string; aggregation: Aggregation }>>(
    numericColumns.includes('Sales') ? [{ id: 'a1', column: 'Sales', aggregation: 'sum' }] : [],
  )
  const [groupChart, setGroupChart] = useState(true)
  const [showTotals, setShowTotals] = useState(false)

  const grouped = useMemo(() => {
    if (!groupKeys.length) return { result: [] as DataRow[], columns: [] as string[], option: null }
    const built = buildGroupedBarOption(rows, groupKeys, aggs, theme)
    return { result: built.result, columns: built.columns, option: built.option }
  }, [rows, groupKeys, aggs, theme])

  /* -------------------------------------------------------- pivot */
  const [pivotIndex, setPivotIndex] = useState(categorical[0] ?? columns[0] ?? '')
  const [pivotColumns, setPivotColumns] = useState(categorical[1] ?? categorical[0] ?? columns[0] ?? '')
  const [pivotValues, setPivotValues] = useState(numericColumns[0] ?? '')
  const [pivotAgg, setPivotAgg] = useState<Aggregation>('mean')
  const pivotResult = useMemo(() => {
    if (!pivotIndex || !pivotColumns || !pivotValues) return { rows: [] as DataRow[], columns: [] as string[] }
    return pivotTable(rows, pivotIndex, pivotColumns, pivotValues, pivotAgg)
  }, [rows, pivotIndex, pivotColumns, pivotValues, pivotAgg])

  /* ------------------------------------------------------ crosstab */
  const [crossRow, setCrossRow] = useState(categorical[0] ?? columns[0] ?? '')
  const [crossCol, setCrossCol] = useState(categorical[1] ?? categorical[0] ?? columns[0] ?? '')
  const [crossNormalize, setCrossNormalize] = useState<'none' | 'index' | 'columns' | 'all'>('none')
  const crossResult = useMemo(() => {
    if (!crossRow || !crossCol) return { rows: [] as DataRow[], columns: [] as string[] }
    return crossTab(rows, crossRow, crossCol, crossNormalize)
  }, [rows, crossRow, crossCol, crossNormalize])

  /* ---------------------------------------------------- value counts */
  const [countColumn, setCountColumn] = useState(categorical[0] ?? columns[0] ?? '')
  const valueCounts = useMemo(() => topValues(rows, countColumn, 12), [rows, countColumn])

  /* --------------------------------------------------- correlation */
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman'>('pearson')
  const [corrColumns, setCorrColumns] = useState<string[]>(numericColumns)
  const activeCorr = useMemo(
    () => (corrColumns.length >= 2 ? corrColumns : numericColumns),
    [corrColumns, numericColumns],
  )
  const corrMatrix = useMemo(
    () => correlationMatrix(rows, activeCorr, corrMethod),
    [rows, activeCorr, corrMethod],
  )
  const strongPairs = useMemo(() => topCorrelations(corrMatrix, 8), [corrMatrix])
  const [corrDrill, setCorrDrill] = useState<{ x: string; y: string } | null>(null)
  const corrDrillOption = useMemo(() => {
    if (!corrDrill) return null
    const config = {
      ...defaultChartConfig(columns, numericColumns, types),
      type: 'scatter' as const, x: corrDrill.x, y: corrDrill.y, trendline: true,
    }
    return buildChartOption(rows, config, types, language, msg, theme).option
  }, [columns, corrDrill, language, msg, numericColumns, rows, theme, types])

  /* ------------------------------------------------------ describe */
  const [describeColumns, setDescribeColumns] = useState<string[]>(numericColumns)
  const describeStats = useMemo(() => {
    const target = describeColumns.length ? describeColumns : numericColumns
    return target.map((column) => ({ column, stats: describeColumn(rows, column) }))
  }, [rows, describeColumns, numericColumns])

  const modes: Array<{ id: Mode; icon: React.ReactNode; label: Key }> = [
    { id: 'group', icon: <Layers size={15} />, label: 'groupBy' },
    { id: 'pivot', icon: <Grid3X3 size={15} />, label: 'pivotTitle' },
    { id: 'correlation', icon: <Sigma size={15} />, label: 'correlation' },
    { id: 'describe', icon: <BarChart3 size={15} />, label: 'describe' },
  ]

  const describeFields: Array<{ key: keyof ReturnType<typeof describeColumn>; label: Key; percent?: boolean }> = [
    { key: 'count', label: 'count' },
    { key: 'missing', label: 'missing' },
    { key: 'mean', label: 'aggmean' },
    { key: 'std', label: 'aggstd' },
    { key: 'min', label: 'aggmin' },
    { key: 'q1', label: 'q1' },
    { key: 'median', label: 'aggmedian' },
    { key: 'q3', label: 'q3' },
    { key: 'max', label: 'aggmax' },
    { key: 'sum', label: 'aggsum' },
    { key: 'skew', label: 'skew' },
    { key: 'kurtosis', label: 'kurtosis' },
    { key: 'iqr', label: 'iqr' },
    { key: 'cv', label: 'cv' },
  ]

  return (
    <div className="stack">
      <div className="page-intro">
        <span className="kicker">groupby · pivot_table · corr · describe</span>
        <h2>{msg('analyze')}</h2>
        <p>{msg('analyzeIntro')}</p>
      </div>

      <div className="mode-tabs">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mode-tab ${mode === item.id ? 'active' : ''}`}
            onClick={() => setMode(item.id)}
          >
            {item.icon}
            {msg(item.label)}
          </button>
        ))}
      </div>

      {/* ================================================== groupby */}
      {mode === 'group' && (
        <div className="stack">
          <Panel kicker="df.groupby().agg()" title={msg('groupBy')} actions={<Layers size={16} />}>
            <div className="grid-2">
              <Field label={msg('groupKeys')} hint={msg('compositeGroupHint')}>
                <MultiSelect values={groupKeys} options={columns} onChange={setGroupKeys} height={140} />
              </Field>
              <div className="stack gap-sm">
                <span className="field-label">{msg('metrics')}</span>
                {aggs.map((agg) => (
                  <div className="condition-row short" key={agg.id}>
                    <Select
                      value={agg.column}
                      options={columns}
                      onChange={(column) => setAggs((list) => list.map((item) => (item.id === agg.id ? { ...item, column } : item)))}
                    />
                    <Select
                      value={agg.aggregation}
                      options={AGGREGATIONS}
                      labels={(value) => msg(aggregationLabels[value])}
                      onChange={(aggregation) => setAggs((list) => list.map((item) => (item.id === agg.id ? { ...item, aggregation } : item)))}
                    />
                    <IconButton
                      title={msg('remove')}
                      disabled={aggs.length <= 1}
                      onClick={() => setAggs((list) => list.filter((item) => item.id !== agg.id))}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
                <div className="row gap wrap">
                  <Button
                    variant="ghost"
                    icon={<Plus size={14} />}
                    onClick={() => setAggs((list) => [...list, { id: uid('agg'), column: numericColumns[0] ?? columns[0] ?? '', aggregation: 'mean' }])}
                  >
                    {msg('addMetric')}
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Layers size={14} />}
                    disabled={!groupKeys.length || !aggs.length}
                    onClick={() => addStep({
                      kind: 'groupby',
                      keys: groupKeys,
                      aggs: aggs.map<GroupAgg>((agg) => ({ id: agg.id, column: agg.column, aggregation: agg.aggregation })),
                    })}
                  >
                    {msg('runAnalysis')}
                  </Button>
                </div>
                <div className="row gap wrap">
                  <Toggle checked={groupChart} onChange={setGroupChart} label={msg('groupResultChart')} />
                  <Toggle checked={showTotals} onChange={setShowTotals} label={msg('subtotals')} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel kicker={grouped.columns.join(' · ') || 'result'} title={msg('analysisResult')} dense>
            {grouped.result.length ? (
              <>
                {groupChart && grouped.option && (
                  <div className="chart-box">
                    <EChart
                      option={grouped.option}
                      style={{ height: 320 }}
                      notMerge
                    />
                  </div>
                )}
                <DataTable
                  columns={showTotals ? grouped.columns : grouped.columns}
                  rows={showTotals ? withTotals(grouped.result, grouped.columns, groupKeys, msg) : grouped.result}
                  maxHeight={340}
                />
              </>
            ) : (
              <EmptyState title={msg('noData')} icon={<Layers size={22} />} />
            )}
          </Panel>
        </div>
      )}

      {/* ==================================================== pivot */}
      {mode === 'pivot' && (
        <div className="stack">
          <Panel kicker="df.pivot_table()" title={msg('pivotTitle')} actions={<Grid3X3 size={16} />}>
            <div className="grid-4">
              <Field label={msg('pivotIndex')}>
                <Select value={pivotIndex} options={columns} onChange={setPivotIndex} />
              </Field>
              <Field label={msg('pivotColumns')}>
                <Select value={pivotColumns} options={columns} onChange={setPivotColumns} />
              </Field>
              <Field label={msg('pivotValues')}>
                <Select value={pivotValues} options={numericColumns.length ? numericColumns : columns} onChange={setPivotValues} />
              </Field>
              <Field label={msg('aggregation')}>
                <Select
                  value={pivotAgg}
                  options={AGGREGATIONS}
                  labels={(value) => msg(aggregationLabels[value])}
                  onChange={setPivotAgg}
                />
              </Field>
            </div>
            <div className="row gap wrap">
              <Button
                variant="primary"
                disabled={pivotIndex === pivotColumns}
                onClick={() => addStep({
                  kind: 'pivot', index: pivotIndex, columns: pivotColumns, values: pivotValues, aggregation: pivotAgg,
                })}
              >
                {msg('runAnalysis')}
              </Button>
              <span className="badge">
                {pivotResult.rows.length} × {pivotResult.columns.length}
              </span>
            </div>
          </Panel>

          <Panel title={`${msg('pivotTitle')} · ${pivotValues}`} dense>
            {pivotResult.rows.length ? (
              <DataTable columns={pivotResult.columns} rows={pivotResult.rows} maxHeight={420} />
            ) : (
              <EmptyState title={msg('noData')} />
            )}
          </Panel>

          <Panel kicker="pd.crosstab()" title={msg('crosstab')} actions={<Hash size={16} />}>
            <div className="grid-4">
              <Field label={msg('rowField')}>
                <Select value={crossRow} options={columns} onChange={setCrossRow} />
              </Field>
              <Field label={msg('columnField')}>
                <Select value={crossCol} options={columns} onChange={setCrossCol} />
              </Field>
              <Field label={msg('normalize')}>
                <Select
                  value={crossNormalize}
                  options={['none', 'index', 'columns', 'all'] as const}
                  labels={(value) => ({
                    none: msg('normNone'), index: msg('normIndex'),
                    columns: msg('normColumns'), all: msg('normAll'),
                  })[value]}
                  onChange={setCrossNormalize}
                />
              </Field>
              <div className="field align-end">
                <Button
                  variant="primary"
                  disabled={crossRow === crossCol}
                  onClick={() => addStep({ kind: 'crosstab', row: crossRow, col: crossCol, normalize: crossNormalize })}
                >
                  {msg('runAnalysis')}
                </Button>
              </div>
            </div>
            {crossResult.rows.length ? (
              <DataTable columns={crossResult.columns} rows={crossResult.rows} maxHeight={300} />
            ) : (
              <EmptyState title={msg('noData')} />
            )}
          </Panel>

          <Panel kicker="value_counts()" title={`${msg('valueCounts')} · ${countColumn}`}>
            <div className="grid-2">
              <Field label={msg('column')}>
                <Select value={countColumn} options={columns} onChange={setCountColumn} />
              </Field>
              <div className="field align-end">
                <Button variant="ghost" onClick={() => addStep({ kind: 'valueCounts', column: countColumn })}>
                  value_counts()
                </Button>
              </div>
            </div>
            <ul className="freq-list">
              {valueCounts.map((item) => {
                const max = valueCounts[0]?.count || 1
                return (
                  <li key={item.value}>
                    <span className="freq-label" title={item.value}>{item.value}</span>
                    <span className="freq-track"><i style={{ width: `${(item.count / max) * 100}%` }} /></span>
                    <b>{formatNumber(item.count)}</b>
                    <em>{formatRatio(item.count / (rows.length || 1), 1)}</em>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      )}

      {/* ============================================== correlation */}
      {mode === 'correlation' && (
        <div className="stack">
          <Panel kicker="df.corr()" title={msg('correlation')} actions={<Sigma size={16} />}>
            <div className="grid-3 top-align">
              <Field label={msg('correlation')} hint={msg('correlationHint')}>
                <Select
                  value={corrMethod}
                  options={['pearson', 'spearman'] as const}
                  labels={(value) => msg(value)}
                  onChange={setCorrMethod}
                />
              </Field>
              <div className="stack gap-sm">
                <span className="field-label">
                  {msg('columns')} · {activeCorr.length}
                </span>
                <MultiSelect values={activeCorr} options={numericColumns} onChange={setCorrColumns} height={132} />
              </div>
              <div className="field align-end">
                <Button
                  variant="primary"
                  disabled={activeCorr.length < 2}
                  onClick={() => addStep({ kind: 'corr' })}
                >
                  {msg('runAnalysis')}
                </Button>
              </div>
            </div>
          </Panel>

          {activeCorr.length >= 2 ? (
            <div className="split-2-uneven">
              <Panel title={`${msg('correlation')} · ${msg(corrMethod)}`} dense>
                <EChart
                  option={buildCorrelationOption(rows, activeCorr, corrMethod, theme)}
                  style={{ height: Math.max(360, activeCorr.length * 46) }}
                  notMerge
                  onEvents={{ click: (params: { value?: [number, number, number | null] }) => {
                    const value = params.value
                    if (!value) return
                    const x = activeCorr[value[0]]
                    const y = activeCorr[value[1]]
                    if (x && y && x !== y) setCorrDrill({ x, y })
                  } }}
                />
              </Panel>
              <Panel kicker="|r| ranking" title={msg('strongPairs')}>
                <ul className="pair-list">
                  {strongPairs.map((pair) => {
                    const magnitude = Math.abs(pair.value)
                    const tone = magnitude >= 0.7 ? 'strong' : magnitude >= 0.4 ? 'medium' : 'weak'
                    return (
                      <li key={`${pair.x}-${pair.y}`} className={tone}>
                        <div>
                          <strong>{pair.x}</strong>
                          <span>×</span>
                          <strong>{pair.y}</strong>
                        </div>
                        <span className="pair-bar">
                          <i style={{ width: `${magnitude * 100}%` }} className={pair.value >= 0 ? 'pos' : 'neg'} />
                        </span>
                        <b>{pair.value.toFixed(3)}</b>
                        <em>
                          {magnitude >= 0.7
                            ? msg('magnitudeStrong')
                            : magnitude >= 0.4 ? msg('magnitudeModerate') : msg('weakCorrelation')}
                        </em>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            </div>
          ) : (
            <Panel><EmptyState title={msg('needsTwoNumeric')} /></Panel>
          )}
          {corrDrill && corrDrillOption && (
            <Panel kicker={`${corrDrill.x} × ${corrDrill.y}`} title={msg('drillDown')} actions={<Button variant="subtle" icon={<X size={13} />} onClick={() => setCorrDrill(null)}>{msg('clearDrill')}</Button>} dense>
              <EChart option={corrDrillOption} style={{ height: 390 }} notMerge />
            </Panel>
          )}
        </div>
      )}

      {/* ================================================= describe */}
      {mode === 'describe' && (
        <div className="stack">
          <Panel kicker="df.describe()" title={msg('describe')} actions={<BarChart3 size={16} />}>
            <div className="grid-2">
              <Field label={msg('columns')} hint={msg('describeHint')}>
                <MultiSelect values={describeColumns} options={numericColumns} onChange={setDescribeColumns} height={132} />
              </Field>
              <div className="field align-end">
                <Button variant="primary" onClick={() => addStep({ kind: 'describe' })}>{msg('runAnalysis')}</Button>
              </div>
            </div>
          </Panel>

          <Panel title={msg('stat')} dense>
            {describeStats.length ? (
              <div className="table-scroll" style={{ maxHeight: 460 }}>
                <table className="data-table describe-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">{msg('column')}</th>
                      {describeFields.map((field) => <th key={String(field.key)} className="numeric">{msg(field.label)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {describeStats.map(({ column, stats }) => (
                      <tr key={column}>
                        <td className="sticky-col"><strong>{column}</strong></td>
                        {describeFields.map((field) => (
                          <td key={String(field.key)} className="numeric">
                            {formatNumber(stats[field.key] as number)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={msg('noNumeric')} />
            )}
          </Panel>

          <div className="distribution-grid">
            {describeStats.slice(0, 6).map(({ column, stats }) => (
              <Panel key={column} kicker={column} title={msg('distribution')} dense>
                <div className="dist-row">
                  <span>{msg('aggmin')}</span><b>{formatNumber(stats.min)}</b>
                </div>
                <div className="dist-row">
                  <span>{msg('q1')}</span><b>{formatNumber(stats.q1)}</b>
                </div>
                <div className="dist-row accent">
                  <span>{msg('aggmedian')}</span><b>{formatNumber(stats.median)}</b>
                </div>
                <div className="dist-row">
                  <span>{msg('q3')}</span><b>{formatNumber(stats.q3)}</b>
                </div>
                <div className="dist-row">
                  <span>{msg('aggmax')}</span><b>{formatNumber(stats.max)}</b>
                </div>
                <div className="dist-note">
                  {msg('skew')} {formatNumber(stats.skew)} · {msg('cv')} {formatNumber(stats.cv)}
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Append an "All" row so the grouped table can show its own totals. */
const withTotals = (
  rows: DataRow[],
  columns: string[],
  keys: string[],
  msg: (key: Key) => string,
): DataRow[] => {
  const total: DataRow = {}
  columns.forEach((column) => {
    if (keys.includes(column)) return
    const values = rows.map((row) => row[column]).filter((value): value is number => typeof value === 'number')
    total[column] = values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)) : null
  })
  keys.forEach((key, index) => {
    total[key] = index === 0 ? msg('totalRow') : ''
  })
  return [...rows, total]
}
