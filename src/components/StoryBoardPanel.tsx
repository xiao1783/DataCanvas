import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { EChart } from './EChart'
import {
  ChevronLeft, ChevronRight, Crosshair, Download, GripVertical, Image, Pause, Play,
  Presentation, Printer, Trash2, X,
} from 'lucide-react'
import type { DataFrame, Language } from '../types'
import type { MessageKey as Key } from '../i18n'
import type { StoryItem } from '../story'
import type { ChartConfig } from '../charts'
import { buildChartOption } from '../charts'
import { countDuplicates, profileColumns } from '../analysis'
import { formatNumber } from '../utils'
import { Button, EmptyState, Field, IconButton, Panel, Select, TextInput } from './ui'

interface StoryBoardProps {
  frame: DataFrame
  items: StoryItem[]
  setItems: React.Dispatch<React.SetStateAction<StoryItem[]>>
  language: Language
  msg: (key: Key) => string
  notify: (text: string) => void
}

const StoryChart = memo(function StoryChart({
  rows, config, types, language, msg, height = 330, onElementClick,
}: {
  rows: DataFrame['rows']
  config: StoryItem['config']
  types: DataFrame['types']
  language: Language
  msg: (key: Key) => string
  height?: number
  onElementClick?: (config: ChartConfig, name: string) => void
}) {
  const built = useMemo(
    () => buildChartOption(rows, config, types, language, msg, 'light'),
    [config, language, msg, rows, types],
  )
  // Cross-filtering: a click on a category element (bar, pie slice, treemap
  // tile…) drives the board-wide dimension filter.
  const onEvents = useMemo(() => (onElementClick ? {
    click: (params: { name?: string }) => {
      if (params.name !== undefined && params.name !== '') onElementClick(config, String(params.name))
    },
  } : undefined), [config, onElementClick])
  return <EChart option={built.option} style={{ height }} notMerge lazyUpdate onEvents={onEvents} />
})

export function StoryBoardPanel({ frame, items, setItems, language, msg, notify }: StoryBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [dimension, setDimension] = useState('')
  const [dimensionValue, setDimensionValue] = useState('')
  // Presentation mode: fullscreen one-chart-at-a-time playback
  const [presenting, setPresenting] = useState(false)
  const [presentIndex, setPresentIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const dateColumns = frame.columns.filter((column) => frame.types[column] === 'date')
  const categorical = frame.columns.filter((column) => frame.types[column] === 'text' || frame.types[column] === 'boolean')
  const [dateColumn, setDateColumn] = useState(dateColumns[0] ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const values = useMemo(() => dimension
    ? Array.from(new Set(frame.rows.map((row) => String(row[dimension] ?? msg('none'))))).sort().slice(0, 200)
    : [], [dimension, frame.rows, msg])

  const rows = useMemo(() => frame.rows.filter((row) => {
    if (dimension && dimensionValue && String(row[dimension] ?? msg('none')) !== dimensionValue) return false
    if (dateColumn && (start || end)) {
      const time = new Date(String(row[dateColumn] ?? '')).getTime()
      if (Number.isNaN(time)) return false
      if (start && time < new Date(start).getTime()) return false
      if (end && time > new Date(`${end}T23:59:59`).getTime()) return false
    }
    return true
  }), [dateColumn, dimension, dimensionValue, end, frame.rows, msg, start])

  const missing = useMemo(() => profileColumns(rows, frame.columns).reduce((total, profile) => total + profile.missing, 0), [frame.columns, rows])
  const duplicates = useMemo(() => countDuplicates(rows), [rows])

  const patchItem = (id: string, patch: Partial<StoryItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))

  /* Cross-filter: clicking a category element on any pinned chart turns that
     category into the board-wide dimension filter; clicking it again clears. */
  const handleChartClick = (config: ChartConfig, name: string) => {
    const dim = config.x
    if (!dim || frame.types[dim] === 'number') return
    if (dimension === dim && dimensionValue === name) {
      setDimensionValue('')
      return
    }
    setDimension(dim)
    setDimensionValue(name)
  }

  /* Presentation-mode keyboard: ← / → navigate, Space toggles play, Esc exits. */
  useEffect(() => {
    if (!presenting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresenting(false)
      else if (event.key === 'ArrowRight') setPresentIndex((index) => Math.min(items.length - 1, index + 1))
      else if (event.key === 'ArrowLeft') setPresentIndex((index) => Math.max(0, index - 1))
      else if (event.key === ' ') {
        event.preventDefault()
        setPlaying((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presenting, items.length])

  // Auto-advance every 8 seconds while playing.
  useEffect(() => {
    if (!presenting || !playing || items.length < 2) return
    const timer = window.setInterval(() => {
      setPresentIndex((index) => (index + 1) % items.length)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [presenting, playing, items.length])

  const openPresent = () => {
    setPresentIndex(0)
    setPlaying(true)
    setPresenting(true)
  }

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    setItems((current) => {
      const next = [...current]
      const from = next.findIndex((item) => item.id === dragId)
      const to = next.findIndex((item) => item.id === targetId)
      if (from < 0 || to < 0) return current
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDragId(null)
  }

  const exportPng = async () => {
    if (!boardRef.current) return
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(boardRef.current, { backgroundColor: '#f2f7fc', scale: 1.5, useCORS: true })
    const link = document.createElement('a')
    link.download = `datacanvas-story-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    notify(msg('storyExported'))
  }

  return (
    <div className="stack">
      <Panel kicker="compose · filter · export" title={msg('storyBoard')} actions={<Presentation size={17} />}>
        <div className="story-toolbar">
          <Field label={msg('globalDimension')}><Select value={dimension} options={['', ...categorical]} labels={(value) => value || msg('none')} onChange={(value) => { setDimension(value); setDimensionValue('') }} /></Field>
          <Field label={msg('filterValue')}><Select value={dimensionValue} options={['', ...values]} labels={(value) => value || msg('all')} onChange={setDimensionValue} /></Field>
          <Field label={msg('dateColumn')}><Select value={dateColumn} options={['', ...dateColumns]} labels={(value) => value || msg('none')} onChange={setDateColumn} /></Field>
          <Field label={msg('startDate')}><input className="control" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <Field label={msg('endDate')}><input className="control" type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
          <div className="story-export row gap">
            <Button variant="ghost" icon={<Image size={14} />} disabled={!items.length} onClick={() => { void exportPng() }}>{msg('exportPng')}</Button>
            <Button variant="ghost" icon={<Printer size={14} />} disabled={!items.length} onClick={() => window.print()}>{msg('printPdf')}</Button>
            <Button variant="primary" icon={<Presentation size={14} />} disabled={items.length < 2} onClick={openPresent}>{msg('presentMode')}</Button>
          </div>
        </div>
        <div className="story-crossfilter">
          <span className="badge brush-badge"><Crosshair size={13} /> {msg('storyClickFilter')}</span>
          {dimension && dimensionValue && (
            <span className="badge filter-on">
              {msg('storyFilterOn')}: <strong>{dimension} = {dimensionValue}</strong>
              <button type="button" onClick={() => setDimensionValue('')}>{msg('storyFilterClear')}</button>
            </span>
          )}
        </div>
      </Panel>

      <div ref={boardRef} className="story-canvas">
        <header className="story-header">
          <div><span>DataCanvas</span><h2>{msg('storyTitle')}</h2></div>
          <small>{formatNumber(rows.length)} {msg('rows')} · {new Date().toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')}</small>
        </header>
        <div className="story-kpis">
          <article><span>{msg('rows')}</span><strong>{formatNumber(rows.length)}</strong></article>
          <article><span>{msg('columns')}</span><strong>{frame.columns.length}</strong></article>
          <article><span>{msg('missing')}</span><strong>{formatNumber(missing)}</strong></article>
          <article><span>{msg('duplicates')}</span><strong>{formatNumber(duplicates)}</strong></article>
        </div>

        {!items.length ? (
          <EmptyState title={msg('emptyStory')} icon={<Presentation size={28} />} />
        ) : (
          <div className="story-grid">
            {items.map((item) => (
                <article
                  className="story-card"
                  key={item.id}
                  draggable
                  onDragStart={() => setDragId(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOn(item.id)}
                >
                  <header>
                    <span className="story-grip"><GripVertical size={15} />{msg('dragToSort')}</span>
                    <IconButton title={msg('remove')} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={14} /></IconButton>
                  </header>
                  <StoryChart rows={rows} config={item.config} types={frame.types} language={language} msg={msg} onElementClick={handleChartClick} />
                  <div className="story-notes">
                    <Field label={msg('noteZhLabel')}><TextInput value={item.noteZh} placeholder={msg('noteZhPlaceholder')} onChange={(noteZh) => patchItem(item.id, { noteZh })} /></Field>
                    <Field label={msg('noteEnLabel')}><TextInput value={item.noteEn} placeholder={msg('noteEnPlaceholder')} onChange={(noteEn) => patchItem(item.id, { noteEn })} /></Field>
                  </div>
                  {(language === 'zh' ? item.noteZh : item.noteEn) && <p className="story-caption">{language === 'zh' ? item.noteZh : item.noteEn}</p>}
                </article>
            ))}
          </div>
        )}
        {items.length > 0 && <footer className="story-footer"><Download size={13} />{msg('storyFooter')}</footer>}
      </div>

      {presenting && items.length > 0 && (
        <div className="present-overlay" role="dialog" aria-modal="true" aria-label={msg('presentMode')}>
          <header className="present-header">
            <span>DataCanvas · {msg('presentMode')}</span>
            <small>{presentIndex + 1} / {items.length}</small>
            <IconButton className="present-close" title={msg('close')} onClick={() => setPresenting(false)}><X size={18} /></IconButton>
          </header>
          <div className="present-stage">
            <div className="present-card">
              <StoryChart
                rows={rows}
                config={items[presentIndex].config}
                types={frame.types}
                language={language}
                msg={msg}
                height={Math.max(360, Math.round(window.innerHeight * 0.62))}
              />
            </div>
            {(language === 'zh'
              ? items[presentIndex].noteZh || items[presentIndex].noteEn
              : items[presentIndex].noteEn || items[presentIndex].noteZh) && (
              <p className="present-caption">
                {language === 'zh'
                  ? items[presentIndex].noteZh || items[presentIndex].noteEn
                  : items[presentIndex].noteEn || items[presentIndex].noteZh}
              </p>
            )}
          </div>
          <footer className="present-controls">
            <IconButton title={msg('previous')} disabled={presentIndex === 0} onClick={() => setPresentIndex((index) => Math.max(0, index - 1))}><ChevronLeft size={18} /></IconButton>
            <IconButton title={msg('presentMode')} onClick={() => setPlaying((current) => !current)}>{playing ? <Pause size={18} /> : <Play size={18} />}</IconButton>
            <IconButton title={msg('next')} disabled={presentIndex === items.length - 1} onClick={() => setPresentIndex((index) => Math.min(items.length - 1, index + 1))}><ChevronRight size={18} /></IconButton>
            <span className="present-hint">{msg('presentHint')}</span>
          </footer>
        </div>
      )}
    </div>
  )
}
