import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Braces, CircleHelp, Eraser, Grid3X3, Search, Sparkles, Table2, TrendingUp,
} from 'lucide-react'
import type { DataFrame, Language, Op, Theme } from '../types'
import type { MessageKey as Key } from '../i18n'
import { countDuplicates, profileColumns } from '../analysis'
import { formatCell, formatCompact, formatNumber, formatRatio } from '../utils'
import { DataTable } from './DataTable'
import { Button, EmptyState, Panel, Sparkline } from './ui'

export interface OverviewProps {
  frame: DataFrame
  sourceFrame: DataFrame
  stepCount: number
  language: Language
  theme: Theme
  msg: (key: Key) => string
  sourceName: string
  isSample: boolean
  view: { search: string; setSearch: (value: string) => void; page: number; setPage: (page: number) => void; pageSize: number; setPageSize: (size: number) => void }
  onOpenColumn: (column: string) => void
  addStep: (op: Op, labels?: { zh: string; en: string }) => void
}

const QUALITY_MISSING_WEIGHT = 55
const QUALITY_DUPLICATE_WEIGHT = 20

const AutoEdaPanel = lazy(() => import('./AutoEdaPanel').then((module) => ({ default: module.AutoEdaPanel })))

export function OverviewPanel({
  frame, sourceFrame, stepCount, language, theme, msg, sourceName, isSample,
  view, onOpenColumn, addStep,
}: OverviewProps) {
  const { rows, columns, types } = frame
  const [profileLimit, setProfileLimit] = useState(6)
  const [edaOpen, setEdaOpen] = useState(false)

  // Heavy full-scan profiling only runs while the overview tab is mounted.
  const profiles = useMemo(() => profileColumns(rows, columns), [rows, columns])
  const missingCells = useMemo(
    () => profiles.reduce((total, profile) => total + profile.missing, 0),
    [profiles],
  )
  const duplicateRows = useMemo(() => countDuplicates(rows), [rows])

  const totalCells = rows.length * columns.length
  const completeness = totalCells ? 1 - missingCells / totalCells : 1
  const duplicateRatio = rows.length ? duplicateRows / rows.length : 0
  const typedRatio = columns.length
    ? profiles.filter((profile) => profile.type !== 'text').length / columns.length
    : 0
  const quality = Math.max(
    0,
    Math.round(
      completeness * QUALITY_MISSING_WEIGHT
      + (1 - duplicateRatio) * QUALITY_DUPLICATE_WEIGHT
      + typedRatio * 25,
    ),
  )

  // Keep the input responsive: the expensive row scan follows the deferred
  // value instead of running on every keystroke. Only cell values are matched;
  // matching column names here would make almost any letter return every row.
  const deferredSearch = useDeferredValue(view.search)
  const filtered = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      columns.some((column) => formatCell(row[column]).toLowerCase().includes(needle)),
    )
  }, [rows, columns, deferredSearch])

  const totalPages = Math.max(1, Math.ceil(filtered.length / view.pageSize))
  const safePage = Math.min(view.page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * view.pageSize, safePage * view.pageSize)

  const numericCount = profiles.filter((profile) => profile.type === 'number').length
  const dateCount = profiles.filter((profile) => profile.type === 'date').length
  const approxBytes = useMemo(() => {
    let bytes = 0
    rows.forEach((row) => {
      columns.forEach((column) => {
        const value = row[column]
        if (value === null || value === undefined) return
        bytes += typeof value === 'number' ? 8 : String(value).length * 2
      })
    })
    return bytes
  }, [rows, columns])

  const insights = useMemo(() => {
    const numeric = profiles.filter((profile) => profile.type === 'number' && profile.mean !== undefined)
    const categorical = profiles
      .filter((profile) => profile.type === 'text' && profile.unique > 1 && profile.unique <= Math.max(20, rows.length / 4))
      .sort((a, b) => a.unique - b.unique)
    if (!numeric.length) return null

    // The metric we lead with: the widest-spread numeric column, since that is
    // usually the quantity a business question is actually about.
    const primary = [...numeric].sort((a, b) => (b.std ?? 0) - (a.std ?? 0))[0]
    const dimension = categorical[0]

    let topBucket: { label: string; value: number; share: number } | null = null
    if (dimension) {
      const buckets = dimension.topValues
      const leader = buckets[0]
      if (leader) {
        const total = dimension.topValues.reduce((sum, item) => sum + item.count, 0)
        topBucket = {
          label: leader.value,
          value: leader.count,
          share: total ? leader.count / total : 0,
        }
      }
    }

    const mostSkewed = [...numeric].sort((a, b) => Math.abs(b.skew ?? 0) - Math.abs(a.skew ?? 0))[0]
    const missingWorst = [...profiles].sort((a, b) => b.missingRatio - a.missingRatio)[0]
    return { primary, dimension, topBucket, mostSkewed, missingWorst }
  }, [profiles, rows.length])

  const visibleProfiles = profiles.slice(0, profileLimit)

  return (
    <div className="stack">
      <div className="eda-launch">
        <div>
          <span><Sparkles size={15} /> Auto EDA</span>
          <strong>{msg('autoEdaLaunch')}</strong>
          <small>{msg('autoEdaLaunchHint')}</small>
        </div>
        <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => setEdaOpen(true)}>
          {msg('runAutoEda')}
        </Button>
      </div>

      {edaOpen && (
        <Suspense fallback={<div className="view-loading" role="status">{language === 'zh' ? '正在生成自动分析…' : 'Preparing Auto EDA…'}</div>}>
          <AutoEdaPanel
            sourceFrame={sourceFrame}
            frame={frame}
            stepCount={stepCount}
            theme={theme}
            msg={msg}
            addStep={addStep}
            onClose={() => setEdaOpen(false)}
          />
        </Suspense>
      )}

      <div className="kpi-grid">
        <Kpi
          label={msg('rows')}
          numericValue={rows.length}
          note={`${formatCompact(totalCells)} ${msg('cells')}`}
          icon={<Table2 size={18} />}
          accent="blue"
        />
        <Kpi
          label={msg('columns')}
          numericValue={columns.length}
          note={`${numericCount} ${msg('numeric')} · ${dateCount} ${msg('dateColumns')}`}
          icon={<Braces size={18} />}
          accent="violet"
        />
        <Kpi
          label={msg('missing')}
          numericValue={missingCells}
          note={`${msg('completeness')} ${formatRatio(completeness)}`}
          icon={<CircleHelp size={18} />}
          accent="amber"
        />
        <Kpi
          label={msg('duplicates')}
          numericValue={duplicateRows}
          note={duplicateRows ? formatRatio(duplicateRatio) : msg('noDuplicates')}
          icon={<Eraser size={18} />}
          accent={duplicateRows ? 'rose' : 'mint'}
        />
      </div>

      <div className="split-2">
        <Panel
          kicker="DataFrame.info()"
          title={msg('dataQuality')}
          actions={<span className="pill">{sourceName}</span>}
        >
          <div className="quality-grid">
            <div className="quality-meter" title={msg('qualityHint')}>
              <svg viewBox="0 0 120 120" className="gauge">
                <circle cx="60" cy="60" r="50" className="gauge-track" />
                <circle
                  cx="60" cy="60"
                  r="50"
                  className={`gauge-value gauge-${qualityTier(quality)}`}
                  strokeDasharray={`${(quality / 100) * 314} 314`}
                />
              </svg>
              <div className="quality-score">
                <strong>{quality}</strong>
                <span>{msg('qualityScore')}</span>
              </div>
            </div>
            <dl className="stat-list">
              <div>
                <dt>{msg('completeness')}</dt>
                <dd>{formatRatio(completeness, 2)}</dd>
              </div>
              <div>
                <dt>{msg('missing')}</dt>
                <dd>{formatNumber(missingCells)}</dd>
              </div>
              <div>
                <dt>{msg('duplicates')}</dt>
                <dd>{formatNumber(duplicateRows)}</dd>
              </div>
              <div>
                <dt>{msg('memory')}</dt>
                <dd>{approxBytes > 1048576
                  ? `${(approxBytes / 1048576).toFixed(1)} MB`
                  : `${Math.round(approxBytes / 1024)} KB`}</dd>
              </div>
              <div>
                <dt>{msg('numeric')}</dt>
                <dd>{numericCount}</dd>
              </div>
              <div>
                <dt>{msg('categorical')}</dt>
                <dd>{columns.length - numericCount - dateCount}</dd>
              </div>
            </dl>
          </div>
          <p className="quality-hint">{msg('qualityHint')}</p>
        </Panel>

        <Panel kicker="pandas insights" title={msg('quickInsights')} actions={<Sparkles size={16} />}>
          {insights ? (
            <ul className="insight-list">
              <li>
                <TrendingUp size={15} />
                <div>
                  <span>
                    {msg('insightWidest')} · <code>{insights.primary.name}</code>
                  </span>
                  <strong>
                    {msg('mean')} {formatNumber(insights.primary.mean)}
                    <small>σ {formatNumber(insights.primary.std)}</small>
                  </strong>
                </div>
              </li>
              {insights.topBucket && insights.dimension && (
                <li>
                  <Grid3X3 size={15} />
                  <div>
                    <span>
                      {msg('insightLeading')} · <code>{insights.dimension.name}</code>
                    </span>
                    <strong>
                      {insights.topBucket.label}
                      <small>{formatRatio(insights.topBucket.share)} · {formatNumber(insights.topBucket.value)} {msg('rows')}</small>
                    </strong>
                  </div>
                </li>
              )}
              {insights.mostSkewed && (
                <li>
                  <AlertTriangle size={15} />
                  <div>
                    <span>{msg('skew')} · <code>{insights.mostSkewed.name}</code></span>
                    <strong>
                      {formatNumber(insights.mostSkewed.skew)}
                      <small>
                        {Math.abs(insights.mostSkewed.skew ?? 0) > 1
                          ? msg('distSkewed')
                          : msg('distSymmetric')}
                      </small>
                    </strong>
                  </div>
                </li>
              )}
              {insights.missingWorst && insights.missingWorst.missing > 0 && (
                <li>
                  <CircleHelp size={15} />
                  <div>
                    <span>{msg('missingRatio')} · <code>{insights.missingWorst.name}</code></span>
                    <strong>
                      {formatRatio(insights.missingWorst.missingRatio)}
                      <small>{formatNumber(insights.missingWorst.missing)} {msg('missing')}</small>
                    </strong>
                  </div>
                </li>
              )}
            </ul>
          ) : (
            <EmptyState title={msg('noData')} />
          )}
        </Panel>
      </div>

      <Panel
        kicker="DataFrame.head()"
        title={msg('preview')}
        actions={
          <>
            <label className="search-box">
              <Search size={15} />
              <input
                value={view.search}
                placeholder={msg('searchValues')}
                onChange={(event) => {
                  view.setSearch(event.target.value)
                  view.setPage(1)
                }}
              />
            </label>
            <select
              className="control compact"
              value={String(view.pageSize)}
              onChange={(event) => {
                view.setPageSize(Number(event.target.value))
                view.setPage(1)
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size} / {msg('rowsPerPage')}</option>
              ))}
            </select>
          </>
        }
      >
        <DataTable columns={columns} rows={pageRows} types={types} rowOffset={(safePage - 1) * view.pageSize} />
        <footer className="table-footer">
          <span>
            {msg('showing')} {filtered.length ? (safePage - 1) * view.pageSize + 1 : 0}–
            {Math.min(safePage * view.pageSize, filtered.length)} / {formatNumber(filtered.length)}
          </span>
          <div className="pagination">
            <button type="button" disabled={safePage <= 1} onClick={() => view.setPage(safePage - 1)}>‹</button>
            <span>{msg('page')} {safePage} {msg('of')} {totalPages}</span>
            <button type="button" disabled={safePage >= totalPages} onClick={() => view.setPage(safePage + 1)}>›</button>
          </div>
        </footer>
      </Panel>

      <Panel
        kicker="DataFrame.describe()"
        title={msg('columnProfile')}
        actions={
          profiles.length > 6 ? (
            <button
              type="button"
              className="link-button"
              onClick={() => setProfileLimit(profileLimit >= profiles.length ? 6 : profiles.length)}
            >
              {profileLimit >= profiles.length
                ? msg('showLess')
                : `${msg('showAll')} ${profiles.length}`}
            </button>
          ) : null
        }
      >
        <div className="profile-grid">
          {visibleProfiles.map((profile) => (
            <button
              type="button"
              key={profile.name}
              className="profile-card"
              onClick={() => onOpenColumn(profile.name)}
              title={msg('columnDetailTitle')}
            >
              <header>
                <strong>{profile.name}</strong>
                <span className={`type-pill ${profile.type}`}>{profile.type}</span>
              </header>
              <div className="profile-spark">
                {profile.histogram.length
                  ? <Sparkline values={profile.histogram} />
                  : <Sparkline values={profile.topValues.map((item) => item.count)} tone="warn" />}
              </div>
              <dl className="profile-stats">
                <div>
                  <dt>{msg('unique')}</dt>
                  <dd>{formatNumber(profile.unique)}</dd>
                </div>
                <div>
                  <dt>{msg('missingRatio')}</dt>
                  <dd className={profile.missing ? 'warn' : ''}>{formatRatio(profile.missingRatio)}</dd>
                </div>
                {profile.type === 'number' ? (
                  <>
                    <div>
                      <dt>{msg('mean')}</dt>
                      <dd>{formatNumber(profile.mean)}</dd>
                    </div>
                    <div>
                      <dt>{msg('range')}</dt>
                      <dd>{formatNumber(profile.min)} – {formatNumber(profile.max)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>{msg('min')}</dt>
                      <dd title={profile.minLabel}>{profile.minLabel ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{msg('max')}</dt>
                      <dd title={profile.maxLabel}>{profile.maxLabel ?? '—'}</dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="profile-track">
                <i style={{ width: `${(1 - profile.missingRatio) * 100}%` }} />
              </div>
              {profile.topValues.length > 0 && (
                <footer className="profile-top">
                  <span>{msg('topValues')}</span>
                  <div>
                    {profile.topValues.slice(0, 3).map((item) => (
                      <em key={item.value} title={`${item.value}: ${item.count}`}>
                        {item.value.length > 12 ? `${item.value.slice(0, 11)}…` : item.value}
                        <b>{item.count}</b>
                      </em>
                    ))}
                  </div>
                </footer>
              )}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}

/** Ease-out count-up; respects the user's reduced-motion preference. */
function qualityTier(score: number): 'good' | 'ok' | 'warn' | 'bad' {
  if (score >= 90) return 'good'
  if (score >= 75) return 'ok'
  if (score >= 60) return 'warn'
  return 'bad'
}

function useCountUp(target: number, duration = 750): number {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      fromRef.current = target
      setDisplay(target)
      return
    }
    const start = performance.now()
    const from = fromRef.current
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      const value = Math.round(from + (target - from) * eased)
      setDisplay(value)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return display
}

function Kpi({
  label, numericValue, note, icon, accent,
}: {
  label: string
  numericValue: number
  note: string
  icon: React.ReactNode
  accent: string
}) {
  const animated = useCountUp(numericValue)
  return (
    <article className={`kpi-card ${accent}`}>
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{formatNumber(animated)}</strong>
      <small>{note}</small>
    </article>
  )
}
