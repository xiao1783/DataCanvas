import { useMemo, useState } from 'react'
import {
  ArrowDownAZ, ArrowUpAZ, Braces, Calendar, CalendarClock, Calculator, Combine, Eraser,
  Filter, Merge, Repeat, Scissors, Sigma, Split, Table2, Trash2, Type, Wand2,
} from 'lucide-react'
import type {
  Aggregation, DataRow, DataFrame, DataType, FillStrategy, FilterCondition, FilterOperator,
  GroupAgg, JoinSpec, Language, Op, PipelineStep, SortDirection, SortKey,
} from '../types'
import type { MessageKey as Key } from '../i18n'
import { AGGREGATIONS, aggregationLabels } from '../i18n'
import { countDuplicates, newCondition } from '../analysis'
import { deriveColumnDefaults } from '../defaults'
import { formatCell, formatNumber, inferType, uid } from '../utils'
import { Button, Chip, EmptyState, Field, MultiSelect, Panel, Select, TextInput, Toggle } from './ui'

const OPERATORS: FilterOperator[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
  'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'notEmpty', 'in', 'notIn',
]

const OPERATOR_LABEL: Record<FilterOperator, Key> = {
  contains: 'contains', notContains: 'notContains', equals: 'equals',
  notEquals: 'notEquals', startsWith: 'startsWith', endsWith: 'endsWith',
  gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', between: 'between',
  isEmpty: 'isEmpty', notEmpty: 'notEmpty', in: 'inList', notIn: 'notInList',
}

const NO_VALUE_OPERATORS: FilterOperator[] = ['isEmpty', 'notEmpty']

const FILL_STRATEGIES: FillStrategy[] = [
  'mean', 'median', 'mode', 'zero', 'constant', 'ffill', 'bfill', 'interpolate',
]

const FILL_LABEL: Record<FillStrategy, Key> = {
  mean: 'fillMean', median: 'fillMedian', mode: 'fillMode', zero: 'fillZero',
  constant: 'fillConstant', ffill: 'fillForward', bfill: 'fillBackward',
  interpolate: 'fillInterpolate',
}

export interface TransformProps {
  frame: DataFrame
  language: Language
  msg: (key: Key) => string
  addStep: (op: Op, labels?: { zh: string; en: string }) => void
  rightFrame: { name: string; rows: DataRow[] } | null
  onPickRight: (file: File) => void
  notify: (text: string) => void
}

export function TransformPanel({
  frame, language, msg, addStep, rightFrame, onPickRight, notify,
}: TransformProps) {
  const { columns, rows, types } = frame
  const duplicateRows = useMemo(() => countDuplicates(rows), [rows])
  const numericColumns = columns.filter((column) => types[column] === 'number')
  const defaults = useMemo(() => deriveColumnDefaults(columns, types), [columns, types])
  const first = defaults.dimension || columns[0] || ''
  const firstNumeric = defaults.measure || numericColumns[0] || ''

  /* filter -------------------------------------------------------- */
  const [conditions, setConditions] = useState<FilterCondition[]>([newCondition(first)])
  const [conjunction, setConjunction] = useState<'and' | 'or'>('and')

  /* sort ---------------------------------------------------------- */
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ id: uid('sort'), column: first, direction: 'asc' }])

  /* missing ------------------------------------------------------- */
  const [missColumn, setMissColumn] = useState(first)
  const [fillStrategy, setFillStrategy] = useState<FillStrategy>('mean')
  const [fillValue, setFillValue] = useState('')
  const [dropHow, setDropHow] = useState<'any' | 'all'>('any')

  /* duplicates ---------------------------------------------------- */
  const [dupSubset, setDupSubset] = useState<string[]>([])

  /* columns ------------------------------------------------------- */
  const [keepSelection, setKeepSelection] = useState<string[]>(columns)
  const [dropSelection, setDropSelection] = useState<string[]>([])
  const [renameFrom, setRenameFrom] = useState(first)
  const [renameTo, setRenameTo] = useState('')
  const [castColumn, setCastColumn] = useState(first)
  const [castTo, setCastTo] = useState<DataType>('number')
  const [headCount, setHeadCount] = useState('100')
  const [sampleSize, setSampleSize] = useState(String(Math.max(1, Math.min(rows.length, 50))))
  const [withReplacement, setWithReplacement] = useState(false)

  /* calculate ----------------------------------------------------- */
  const [newColumn, setNewColumn] = useState('ProfitMargin')
  const [formula, setFormula] = useState(
    columns.includes('Profit') && columns.includes('Sales') ? 'Profit / Sales' : '',
  )

  /* numeric ------------------------------------------------------- */
  const [numColumn, setNumColumn] = useState(firstNumeric)
  const [cumMethod, setCumMethod] = useState<'cumsum' | 'cummax' | 'cummin' | 'cumprod'>('cumsum')
  const [pctPeriods, setPctPeriods] = useState('1')
  const [shiftPeriods, setShiftPeriods] = useState('-1')
  const [rankMethod, setRankMethod] = useState<'average' | 'min' | 'max' | 'dense' | 'ordinal'>('average')
  const [rankAscending, setRankAscending] = useState(false)
  const [rollWindow, setRollWindow] = useState('7')
  const [rollAgg, setRollAgg] = useState<'mean' | 'sum' | 'max' | 'min' | 'std'>('mean')
  const [clipLower, setClipLower] = useState('')
  const [clipUpper, setClipUpper] = useState('')
  const [binCount, setBinCount] = useState('4')
  const [binLabels, setBinLabels] = useState('Q1,Q2,Q3,Q4')

  /* text ---------------------------------------------------------- */
  const textColumns = defaults.dimensions.length ? defaults.dimensions : columns
  const [textColumn, setTextColumn] = useState(textColumns[0] ?? first)
  const [textOperation, setTextOperation] = useState<'upper' | 'lower' | 'title' | 'trim' | 'strip' | 'length' | 'substring'>('upper')
  const [subStart, setSubStart] = useState('0')
  const [subEnd, setSubEnd] = useState('5')
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [matchColumn, setMatchColumn] = useState(textColumns[0] ?? first)
  const [matchPattern, setMatchPattern] = useState('')
  const [matchResult, setMatchResult] = useState('HasMatch')
  const [splitColumn, setSplitColumn] = useState(textColumns[0] ?? first)
  const [splitSeparator, setSplitSeparator] = useState('-')
  const [splitPart, setSplitPart] = useState('0')
  const [concatSelection, setConcatSelection] = useState<string[]>([])
  const [concatSeparator, setConcatSeparator] = useState(' ')
  const [concatResult, setConcatResult] = useState('Combined')

  /* date ---------------------------------------------------------- */
  const dateColumns = columns.filter((column) => types[column] === 'date')
  const [dateColumn, setDateColumn] = useState(dateColumns[0] ?? first)
  const [datePart, setDatePart] = useState<'year' | 'month' | 'day' | 'quarter' | 'weekday' | 'week' | 'ym'>('month')
  const [dateOther, setDateOther] = useState(dateColumns[1] ?? dateColumns[0] ?? first)
  const [dateUnit, setDateUnit] = useState<'days' | 'weeks' | 'months'>('days')

  /* reshape ------------------------------------------------------- */
  const [pivotIndex, setPivotIndex] = useState(defaults.dimension)
  const [pivotColumns, setPivotColumns] = useState(defaults.secondDimension)
  const [pivotValues, setPivotValues] = useState(firstNumeric)
  const [pivotAgg, setPivotAgg] = useState<Aggregation>('mean')
  const [crossRow, setCrossRow] = useState(defaults.dimension)
  const [crossCol, setCrossCol] = useState(defaults.secondDimension)
  const [crossNormalize, setCrossNormalize] = useState<'none' | 'index' | 'columns' | 'all'>('none')
  const [meltIds, setMeltIds] = useState<string[]>(defaults.dimensions.slice(0, 1))
  const [meltValues, setMeltValues] = useState<string[]>(numericColumns)
  const [joinSpec, setJoinSpec] = useState<JoinSpec>({
    rightName: '', rightRows: [], leftOn: defaults.dimension, rightOn: '', how: 'left', suffix: '_right',
  })

  const groupAggs: GroupAgg[] = useMemo(
    () => (firstNumeric ? [{ id: 'g1', column: firstNumeric, aggregation: 'sum' as Aggregation }] : []),
    [firstNumeric],
  )

  const setCondition = (id: string, patch: Partial<FilterCondition>) =>
    setConditions((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const setSortKey = (id: string, patch: Partial<SortKey>) =>
    setSortKeys((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const submitFilter = () => {
    const active = conditions.filter((condition) => condition.column
      && (NO_VALUE_OPERATORS.includes(condition.operator) || condition.value.trim() !== ''))
    if (!active.length) return
    addStep(
      { kind: 'filter', conditions: active, conjunction },
      {
        zh: `筛选：${active.map((condition) => `${condition.column} ${msg(OPERATOR_LABEL[condition.operator])} ${condition.value}`.trim()).join(conjunction === 'and' ? ' 且 ' : ' 或 ')}`,
        en: `Filter: ${active.map((condition) => `${condition.column} ${condition.operator} ${condition.value}`.trim()).join(conjunction === 'and' ? ' AND ' : ' OR ')}`,
      },
    )
    setConditions([newCondition(columns[0] ?? '')])
  }

  const submitSort = () => {
    const active = sortKeys.filter((key) => key.column)
    if (!active.length) return
    addStep(
      { kind: 'sort', keys: active },
      {
        zh: `排序：${active.map((key) => `${key.column} ${key.direction === 'asc' ? '升序' : '降序'}`).join('，')}`,
        en: `Sort: ${active.map((key) => `${key.column} ${key.direction}`).join(', ')}`,
      },
    )
  }

  return (
    <div className="transform-layout">
      <div className="stack">
        <div className="page-intro">
          <span className="kicker">DataFrame pipeline</span>
          <h2>{msg('operationCenter')}</h2>
          <p>{msg('pipelineHint')}</p>
        </div>

        {/* ---------------------------------------------- filter & sort */}
        <Panel kicker="df.query() · df.sort_values()" title={msg('filterSort')} actions={<Filter size={16} />}>
          <div className="condition-list">
            {conditions.map((condition) => {
              const columnType = types[condition.column]
              const numericOnly = columnType === 'number'
              return (
                <div className="condition-row" key={condition.id}>
                  <Select
                    value={condition.column}
                    options={columns}
                    onChange={(column) => setCondition(condition.id, { column })}
                  />
                  <Select
                    value={condition.operator}
                    options={OPERATORS}
                    labels={(value) => msg(OPERATOR_LABEL[value])}
                    onChange={(operator) => setCondition(condition.id, { operator })}
                  />
                  <TextInput
                    value={condition.value}
                    disabled={NO_VALUE_OPERATORS.includes(condition.operator)}
                    placeholder={numericOnly && ['gt', 'gte', 'lt', 'lte'].includes(condition.operator)
                      ? msg('numberPlaceholder')
                      : msg('valuePlaceholder')}
                    onChange={(value) => setCondition(condition.id, { value })}
                  />
                  {condition.operator === 'between' && (
                    <TextInput
                      value={condition.value2 ?? ''}
                      placeholder={msg('upperPlaceholder')}
                      onChange={(value2) => setCondition(condition.id, { value2 })}
                    />
                  )}
                  <Button
                    variant="subtle"
                    disabled={conditions.length === 1}
                    onClick={() => setConditions((list) => list.filter((item) => item.id !== condition.id))}
                    icon={<Trash2 size={14} />}
                  />
                </div>
              )
            })}
          </div>
          <div className="row gap wrap">
            <Button
              variant="ghost"
              icon={<Filter size={14} />}
              onClick={() => setConditions((list) => [...list, newCondition(columns[0] ?? '')])}
            >
              {msg('addCondition')}
            </Button>
            <Select
              value={conjunction}
              options={['and', 'or'] as const}
              labels={(value) => msg(value)}
              onChange={setConjunction}
            />
            <Button variant="primary" onClick={submitFilter}>{msg('applyFilter')}</Button>
          </div>

          <div className="divider" />

          <div className="condition-list">
            {sortKeys.map((key) => (
              <div className="condition-row short" key={key.id}>
                <Select value={key.column} options={columns} onChange={(column) => setSortKey(key.id, { column })} />
                <Select
                  value={key.direction}
                  options={['asc', 'desc'] as const}
                  labels={(value) => (value === 'asc' ? msg('sortAsc') : msg('sortDesc'))}
                  onChange={(direction) => setSortKey(key.id, { direction })}
                />
                <Button
                  variant="subtle"
                  disabled={sortKeys.length === 1}
                  onClick={() => setSortKeys((list) => list.filter((item) => item.id !== key.id))}
                  icon={<Trash2 size={14} />}
                />
              </div>
            ))}
          </div>
          <div className="row gap wrap">
            <Button
              variant="ghost"
              icon={<ArrowDownAZ size={14} />}
              onClick={() => setSortKeys((list) => [...list, { id: uid('sort'), column: first, direction: 'asc' }])}
            >
              {msg('addSortKey')}
            </Button>
            <Button variant="primary" icon={<ArrowUpAZ size={14} />} onClick={submitSort}>{msg('applySort')}</Button>
          </div>
        </Panel>

        {/* ------------------------------------------- missing values */}
        <Panel kicker="df.dropna() · df.fillna()" title={msg('missingValues')} actions={<Wand2 size={16} />}>
          <div className="grid-3">
            <Field label={msg('column')}>
              <Select value={missColumn} options={columns} onChange={setMissColumn} />
            </Field>
            <Field label={msg('fillStrategy')}>
              <Select
                value={fillStrategy}
                options={FILL_STRATEGIES}
                labels={(value) => msg(FILL_LABEL[value])}
                onChange={setFillStrategy}
              />
            </Field>
            <Field label={msg('fillValue')}>
              <TextInput
                value={fillValue}
                disabled={fillStrategy !== 'constant'}
                onChange={setFillValue}
              />
            </Field>
          </div>
          <div className="row gap wrap">
            <Button
              variant="primary"
              icon={<Wand2 size={14} />}
              disabled={types[missColumn] !== 'number' && ['mean', 'median', 'interpolate'].includes(fillStrategy)}
              onClick={() => addStep({ kind: 'fillna', column: missColumn, strategy: fillStrategy, value: fillValue })}
            >
              {msg('applyFill')}
            </Button>
            <Field label={msg('dropHow')} className="inline-field">
              <Select
                value={dropHow}
                options={['any', 'all'] as const}
                labels={(value) => (value === 'any' ? msg('howAny') : msg('howAll'))}
                onChange={setDropHow}
              />
            </Field>
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => addStep({ kind: 'dropna', columns: [], how: dropHow })}
            >
              {msg('dropMissing')}
            </Button>
          </div>
        </Panel>

        {/* ------------------------------------------------ duplicates */}
        <Panel kicker="df.drop_duplicates()" title={msg('duplicatesTitle')} actions={<Eraser size={16} />}>
          <Field
            label={msg('duplicateSubset')}
            hint={dupSubset.length ? undefined : msg('fullRow')}
          >
            <MultiSelect
              values={dupSubset}
              options={columns}
              onChange={setDupSubset}
              height={132}
            />
          </Field>
          <div className="row gap between">
            <span className={`badge ${duplicateRows ? 'warn' : 'ok'}`}>
              {duplicateRows ? `${formatNumber(duplicateRows)} ${msg('duplicates')}` : msg('noDuplicates')}
            </span>
            <Button
              variant="primary"
              icon={<Eraser size={14} />}
              disabled={!duplicateRows}
              onClick={() => addStep({ kind: 'dropDuplicates', subset: dupSubset })}
            >
              {msg('removeDuplicates')}
            </Button>
          </div>
        </Panel>

        {/* --------------------------------------------- column tools */}
        <Panel kicker="df.rename · astype · drop" title={msg('columnTools')} actions={<Braces size={16} />}>
          <div className="grid-2">
            <Field label={msg('selectColumns')} hint={`${keepSelection.length} / ${columns.length}`}>
              <MultiSelect values={keepSelection} options={columns} onChange={setKeepSelection} height={150} />
            </Field>
            <Field label={msg('dropColumns')} hint={`${dropSelection.length} ${msg('columns')}`}>
              <MultiSelect values={dropSelection} options={columns} onChange={setDropSelection} height={150} />
            </Field>
          </div>
          <div className="row gap wrap">
            <Button
              variant="ghost"
              disabled={!keepSelection.length || keepSelection.length === columns.length}
              onClick={() => addStep({ kind: 'selectColumns', columns: keepSelection })}
            >
              {msg('selectColumns')}
            </Button>
            <Button
              variant="ghost"
              disabled={!dropSelection.length}
              onClick={() => {
                addStep({ kind: 'dropColumns', columns: dropSelection })
                setDropSelection([])
              }}
            >
              {msg('dropColumns')}
            </Button>
            <Button variant="ghost" onClick={() => addStep({ kind: 'dropConstant' })}>
              {msg('dropConstant')}
            </Button>
          </div>

          <div className="divider" />

          <div className="grid-3">
            <Field label={msg('column')}>
              <Select value={renameFrom} options={columns} onChange={setRenameFrom} />
            </Field>
            <Field label={msg('newName')}>
              <TextInput value={renameTo} onChange={setRenameTo} />
            </Field>
            <div className="field align-end">
              <Button
                variant="primary"
                disabled={!renameTo.trim() || renameTo.trim() === renameFrom}
                onClick={() => {
                  if (columns.includes(renameTo.trim())) {
                    notify(msg('renameFailed'))
                    return
                  }
                  addStep({ kind: 'renameColumn', from: renameFrom, to: renameTo.trim() })
                  setRenameTo('')
                }}
              >
                {msg('rename')}
              </Button>
            </div>
          </div>

          <div className="grid-3">
            <Field label={msg('column')}>
              <Select value={castColumn} options={columns} onChange={setCastColumn} />
            </Field>
            <Field label={msg('castTo')} hint={`${msg('dtype')}: ${types[castColumn] ?? 'text'}`}>
              <Select
                value={castTo}
                options={['number', 'text', 'date', 'boolean'] as const}
                onChange={setCastTo}
              />
            </Field>
            <div className="field align-end">
              <Button variant="primary" onClick={() => addStep({ kind: 'castColumn', column: castColumn, to: castTo })}>
                {msg('castTo')}
              </Button>
            </div>
          </div>

          <div className="divider" />

          <div className="grid-4">
            <Field label={msg('head')}>
              <TextInput type="number" value={headCount} onChange={setHeadCount} />
            </Field>
            <div className="field align-end">
              <Button variant="ghost" onClick={() => addStep({ kind: 'head', n: Number(headCount) || 0 })}>
                head()
              </Button>
            </div>
            <Field label={msg('sampleSize')}>
              <TextInput type="number" value={sampleSize} onChange={setSampleSize} />
            </Field>
            <div className="field align-end">
              <Button
                variant="ghost"
                onClick={() => addStep({ kind: 'sample', size: Number(sampleSize) || 1, withReplacement })}
              >
                sample()
              </Button>
            </div>
          </div>
          <Toggle checked={withReplacement} onChange={setWithReplacement} label={msg('withReplacement')} />
          <div className="row gap wrap">
            <Button variant="ghost" icon={<Repeat size={14} />} onClick={() => addStep({ kind: 'transpose' })}>
              {msg('transpose')}
            </Button>
            <Button variant="ghost" onClick={() => addStep({ kind: 'resetIndex' })}>{msg('resetIndex')}</Button>
          </div>
        </Panel>

        {/* --------------------------------------------- calculate */}
        <Panel kicker="df.assign()" title={msg('computeColumn')} actions={<Calculator size={16} />}>
          <div className="grid-2">
            <Field label={msg('newColumn')}>
              <TextInput value={newColumn} onChange={setNewColumn} />
            </Field>
            <Field label={msg('formula')} hint={msg('formulaHint')}>
              <TextInput value={formula} onChange={setFormula} />
            </Field>
          </div>
          <div className="formula-chips">
            {['Sales - Cost', 'Profit / Sales', 'Quantity * UnitPrice', '[Unit Price] * Quantity * (1 - Discount)'].map((sample) => (
              <Chip key={sample} tone="accent" onClick={() => setFormula(sample)}>{sample}</Chip>
            ))}
          </div>
          <Button
            variant="primary"
            disabled={!newColumn.trim() || !formula.trim()}
            icon={<Calculator size={14} />}
            onClick={() => addStep({ kind: 'assign', name: newColumn.trim(), formula })}
          >
            {msg('add')}
          </Button>
        </Panel>

        {/* --------------------------------------------- numeric ops */}
        <Panel kicker="cumsum · rank · rolling · qcut" title={msg('numericOps')} actions={<Sigma size={16} />}>
          {!numericColumns.length ? (
            <EmptyState title={msg('noNumeric')} />
          ) : (
            <>
              <div className="grid-3">
                <Field label={msg('aggregation')} className="span-1">
                  <Select value={numColumn} options={numericColumns} onChange={setNumColumn} />
                </Field>
                <Field label={msg('cumulative')}>
                  <Select
                    value={cumMethod}
                    options={['cumsum', 'cummax', 'cummin', 'cumprod'] as const}
                    labels={(value) => ({
                      cumsum: msg('cumsum'), cummax: msg('cummax'), cummin: msg('cummin'), cumprod: msg('cumprod'),
                    })[value]}
                    onChange={setCumMethod}
                  />
                </Field>
                <div className="field align-end">
                  <Button variant="ghost" onClick={() => addStep({ kind: 'cumulative', column: numColumn, method: cumMethod })}>
                    {msg('apply')}
                  </Button>
                </div>
              </div>

              <div className="grid-4">
                <Field label={msg('pctChange')}>
                  <TextInput type="number" value={pctPeriods} onChange={setPctPeriods} />
                </Field>
                <div className="field align-end">
                  <Button variant="ghost" onClick={() => addStep({ kind: 'pctChange', column: numColumn, periods: Number(pctPeriods) || 1 })}>
                    pct_change()
                  </Button>
                </div>
                <Field label={msg('shift')}>
                  <TextInput type="number" value={shiftPeriods} onChange={setShiftPeriods} />
                </Field>
                <div className="field align-end">
                  <Button variant="ghost" onClick={() => addStep({ kind: 'shift', column: numColumn, periods: Number(shiftPeriods) || 0 })}>
                    shift()
                  </Button>
                </div>
              </div>

              <div className="grid-4">
                <Field label={msg('rank')}>
                  <Select
                    value={rankMethod}
                    options={['average', 'min', 'max', 'dense', 'ordinal'] as const}
                    labels={(value) => ({
                      average: msg('rankAverage'), min: msg('rankMin'), max: msg('rankMax'),
                      dense: msg('rankDense'), ordinal: msg('rankOrdinal'),
                    })[value]}
                    onChange={setRankMethod}
                  />
                </Field>
                <Field label={msg('ascending')}>
                  <Toggle checked={rankAscending} onChange={setRankAscending} label={rankAscending ? msg('sortAsc') : msg('sortDesc')} />
                </Field>
                <div className="field align-end span-2">
                  <Button
                    variant="ghost"
                    onClick={() => addStep({ kind: 'rank', column: numColumn, method: rankMethod, ascending: rankAscending })}
                  >
                    rank()
                  </Button>
                </div>
              </div>

              <div className="grid-3">
                <Field label={msg('window')}>
                  <TextInput type="number" value={rollWindow} onChange={setRollWindow} />
                </Field>
                <Field label={msg('aggregation')}>
                  <Select value={rollAgg} options={['mean', 'sum', 'max', 'min', 'std'] as const} onChange={setRollAgg} />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    onClick={() => addStep({ kind: 'rolling', column: numColumn, window: Number(rollWindow) || 3, aggregation: rollAgg })}
                  >
                    rolling()
                  </Button>
                </div>
              </div>

              <div className="grid-4">
                <Field label={msg('clipLower')}>
                  <TextInput value={clipLower} placeholder="0" onChange={setClipLower} />
                </Field>
                <Field label={msg('clipUpper')}>
                  <TextInput value={clipUpper} placeholder="∞" onChange={setClipUpper} />
                </Field>
                <div className="field align-end span-2">
                  <Button variant="ghost" onClick={() => addStep({ kind: 'clip', column: numColumn, lower: clipLower, upper: clipUpper })}>
                    clip()
                  </Button>
                </div>
              </div>

              <div className="grid-3">
                <Field label={msg('bins')}>
                  <TextInput type="number" value={binCount} onChange={setBinCount} />
                </Field>
                <Field label={msg('binLabels')}>
                  <TextInput value={binLabels} onChange={setBinLabels} />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    onClick={() => addStep({ kind: 'qcut', column: numColumn, bins: Number(binCount) || 4, labels: binLabels })}
                  >
                    qcut()
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>

        {/* ------------------------------------------------ text ops */}
        <Panel kicker="Series.str.*" title={msg('textOps')} actions={<Type size={16} />}>
          {!textColumns.length ? (
            <EmptyState title={msg('noData')} />
          ) : (
            <>
              <div className="grid-3">
                <Field label={msg('column')}>
                  <Select value={textColumn} options={textColumns} onChange={setTextColumn} />
                </Field>
                <Field label={msg('textOperation')}>
                  <Select
                    value={textOperation}
                    options={['upper', 'lower', 'title', 'trim', 'strip', 'length', 'substring'] as const}
                    labels={(value) => ({
                      upper: msg('textUpper'), lower: msg('textLower'), title: msg('title'),
                      trim: msg('trim'), strip: msg('strip'), length: msg('length'), substring: msg('substring'),
                    })[value]}
                    onChange={setTextOperation}
                  />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    onClick={() => addStep({
                      kind: 'textOp', column: textColumn, operation: textOperation,
                      start: Number(subStart) || 0, end: Number(subEnd) || 0,
                    })}
                  >
                    {msg('apply')}
                  </Button>
                </div>
              </div>
              {textOperation === 'substring' && (
                <div className="grid-2">
                  <Field label={msg('start')}>
                    <TextInput type="number" value={subStart} onChange={setSubStart} />
                  </Field>
                  <Field label={msg('end')}>
                    <TextInput type="number" value={subEnd} onChange={setSubEnd} />
                  </Field>
                </div>
              )}

              <div className="divider" />

              <div className="grid-4">
                <Field label={msg('find')}>
                  <TextInput value={findText} onChange={setFindText} />
                </Field>
                <Field label={msg('replaceWith')}>
                  <TextInput value={replaceText} onChange={setReplaceText} />
                </Field>
                <Field label={msg('useRegex')}>
                  <Toggle checked={useRegex} onChange={setUseRegex} label={useRegex ? 'regex' : 'literal'} />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    disabled={!findText}
                    onClick={() => addStep({
                      kind: 'textReplace', column: textColumn, find: findText,
                      replace: replaceText, regex: useRegex,
                    })}
                  >
                    {msg('replace')}
                  </Button>
                </div>
              </div>

              <div className="grid-4">
                <Field label={msg('column')}>
                  <Select value={matchColumn} options={textColumns} onChange={setMatchColumn} />
                </Field>
                <Field label={msg('pattern')}>
                  <TextInput value={matchPattern} onChange={setMatchPattern} />
                </Field>
                <Field label={msg('newColumnName')}>
                  <TextInput value={matchResult} onChange={setMatchResult} />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    disabled={!matchPattern || !matchResult.trim()}
                    onClick={() => addStep({
                      kind: 'textContains', column: matchColumn, pattern: matchPattern, newColumn: matchResult.trim(),
                    })}
                  >
                    contains()
                  </Button>
                </div>
              </div>

              <div className="grid-4">
                <Field label={msg('splitColumn')}>
                  <Select value={splitColumn} options={textColumns} onChange={setSplitColumn} />
                </Field>
                <Field label={msg('separator')}>
                  <TextInput value={splitSeparator} onChange={setSplitSeparator} />
                </Field>
                <Field label={msg('part')}>
                  <TextInput type="number" value={splitPart} onChange={setSplitPart} />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    onClick={() => addStep({
                      kind: 'textSplit', column: splitColumn, separator: splitSeparator, part: Number(splitPart) || 0,
                    })}
                  >
                    {msg('splitColumn')}
                  </Button>
                </div>
              </div>

              <div className="grid-2">
                <Field label={msg('columnsToConcat')}>
                  <MultiSelect values={concatSelection} options={columns} onChange={setConcatSelection} height={130} />
                </Field>
                <div className="stack gap-sm">
                  <Field label={msg('separator')}>
                    <TextInput value={concatSeparator} onChange={setConcatSeparator} />
                  </Field>
                  <Field label={msg('newColumnName')}>
                    <TextInput value={concatResult} onChange={setConcatResult} />
                  </Field>
                  <Button
                    variant="ghost"
                    icon={<Combine size={14} />}
                    disabled={concatSelection.length < 2 || !concatResult.trim()}
                    onClick={() => addStep({
                      kind: 'concatColumns', columns: concatSelection, separator: concatSeparator,
                      newColumn: concatResult.trim(),
                    })}
                  >
                    {msg('concatColumns')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>

        {/* ------------------------------------------------ date ops */}
        <Panel kicker=".dt accessor" title={msg('dateOps')} actions={<Calendar size={16} />}>
          {!dateColumns.length ? (
            <EmptyState
              title={msg('noDateTitle')}
              hint={msg('noDateHint')}
            />
          ) : (
            <>
              <div className="grid-3">
                <Field label={msg('column')}>
                  <Select value={dateColumn} options={dateColumns} onChange={setDateColumn} />
                </Field>
                <Field label={msg('partToExtract')}>
                  <Select
                    value={datePart}
                    options={['year', 'month', 'day', 'quarter', 'weekday', 'week', 'ym'] as const}
                    labels={(value) => ({
                      year: msg('year'), month: msg('month'), day: msg('day'), quarter: msg('quarter'),
                      weekday: msg('weekday'), week: msg('week'), ym: msg('yearMonth'),
                    })[value]}
                    onChange={setDatePart}
                  />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    icon={<Calendar size={14} />}
                    onClick={() => addStep({
                      kind: 'datePart', column: dateColumn, part: datePart, newColumn: `${dateColumn}_${datePart}`,
                    })}
                  >
                    {msg('datePart')}
                  </Button>
                </div>
              </div>
              <div className="grid-3">
                <Field label={msg('otherColumn')}>
                  <Select value={dateOther} options={dateColumns} onChange={setDateOther} />
                </Field>
                <Field label={msg('unit')}>
                  <Select
                    value={dateUnit}
                    options={['days', 'weeks', 'months'] as const}
                    labels={(value) => msg(value)}
                    onChange={setDateUnit}
                  />
                </Field>
                <div className="field align-end">
                  <Button
                    variant="ghost"
                    icon={<CalendarClock size={14} />}
                    disabled={dateColumn === dateOther}
                    onClick={() => addStep({
                      kind: 'dateDiff', column: dateColumn, other: dateOther, unit: dateUnit,
                      newColumn: `${dateColumn}_minus_${dateOther}`,
                    })}
                  >
                    {msg('dateDiff')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>

        {/* ------------------------------------------------- reshape */}
        <Panel kicker="pivot_table · crosstab · melt" title={msg('reshape')} actions={<Table2 size={16} />}>
          <h4 className="sub-title">{msg('pivotTitle')}</h4>
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
          <Button
            variant="primary"
            disabled={pivotIndex === pivotColumns}
            onClick={() => addStep({
              kind: 'pivot', index: pivotIndex, columns: pivotColumns, values: pivotValues, aggregation: pivotAgg,
            })}
          >
            {msg('runAnalysis')}
          </Button>

          <div className="divider" />

          <h4 className="sub-title">{msg('crosstab')}</h4>
          <div className="grid-3">
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
          </div>
          <Button
            variant="primary"
            disabled={crossRow === crossCol}
            onClick={() => addStep({ kind: 'crosstab', row: crossRow, col: crossCol, normalize: crossNormalize })}
          >
            {msg('runAnalysis')}
          </Button>

          <div className="divider" />

          <h4 className="sub-title">{msg('meltTitle')}</h4>
          <div className="grid-2">
            <Field label={msg('idVars')}>
              <MultiSelect values={meltIds} options={columns} onChange={setMeltIds} height={132} />
            </Field>
            <Field label={msg('valueVars')}>
              <MultiSelect values={meltValues} options={columns} onChange={setMeltValues} height={132} />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!meltValues.length}
            icon={<Split size={14} />}
            onClick={() => addStep({
              kind: 'melt', idVars: meltIds, valueVars: meltValues,
              varName: 'variable', valueName: 'value',
            })}
          >
            {msg('runAnalysis')}
          </Button>

          <div className="divider" />

          <h4 className="sub-title">{msg('describe')} · {msg('correlation')}</h4>
          <div className="row gap wrap">
            <Button variant="ghost" onClick={() => addStep({ kind: 'describe' })}>{msg('describe')}</Button>
            <Button variant="ghost" onClick={() => addStep({ kind: 'corr' })}>{msg('correlation')}</Button>
          </div>
        </Panel>

        {/* ---------------------------------------------------- join */}
        <Panel kicker="pd.merge · pd.concat" title={msg('join')} actions={<Merge size={16} />}>
          <div className="row gap wrap align-end">
            <label className="file-button">
              <input
                type="file"
                accept=".csv,.xlsx,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onPickRight(file)
                  event.target.value = ''
                }}
              />
              {msg('uploadRight')}
            </label>
            {rightFrame && <span className="badge ok">{rightFrame.name} · {formatNumber(rightFrame.rows.length)} {msg('rows')}</span>}
          </div>

          {rightFrame && (
            <>
              <div className="grid-4">
                <Field label={msg('joinHow')}>
                  <Select
                    value={joinSpec.how}
                    options={['inner', 'left', 'right', 'outer'] as const}
                    labels={(value) => msg(value)}
                    onChange={(how) => setJoinSpec({ ...joinSpec, how })}
                  />
                </Field>
                <Field label={msg('leftOn')}>
                  <Select value={joinSpec.leftOn} options={columns} onChange={(leftOn) => setJoinSpec({ ...joinSpec, leftOn })} />
                </Field>
                <Field label={msg('rightOn')}>
                  <Select
                    value={joinSpec.rightOn}
                    options={rightFrame.rows.length ? Object.keys(rightFrame.rows[0]) : []}
                    onChange={(rightOn) => setJoinSpec({ ...joinSpec, rightOn })}
                  />
                </Field>
                <Field label={msg('suffix')}>
                  <TextInput value={joinSpec.suffix} onChange={(suffix) => setJoinSpec({ ...joinSpec, suffix })} />
                </Field>
              </div>
              <div className="row gap wrap">
                <Button
                  variant="primary"
                  icon={<Merge size={14} />}
                  onClick={() => addStep({
                    kind: 'join',
                    spec: { ...joinSpec, rightName: rightFrame.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_') || 'right', rightRows: rightFrame.rows },
                  })}
                >
                  {msg('join')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Combine size={14} />}
                  onClick={() => addStep({
                    kind: 'concat',
                    sourceName: rightFrame.name,
                    rows: rightFrame.rows,
                  })}
                >
                  {msg('concat')}
                </Button>
              </div>
              <p className="hint">{msg('concatHint')}</p>
            </>
          )}
        </Panel>
      </div>

      <aside className="transform-side">
        <Panel kicker="live" title={msg('preview')} dense>
          <div className="side-stats">
            <div><span>{msg('rows')}</span><strong>{formatNumber(rows.length)}</strong></div>
            <div><span>{msg('columns')}</span><strong>{columns.length}</strong></div>
          </div>
          <div className="column-legend">
            {columns.map((column) => (
              <span key={column} className={`legend-row type-${types[column]}`}>
                <i className={`type-dot ${types[column]}`} />
                {column}
              </span>
            ))}
          </div>
        </Panel>
        <Panel kicker="dtypes" title={msg('dtype')} dense>
          <ul className="dtype-list">
            {columns.map((column) => (
              <li key={column}>
                <span>{column}</span>
                <code>{types[column] ?? inferType(rows.map((row) => row[column]))}</code>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  )
}
