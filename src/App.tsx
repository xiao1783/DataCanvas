import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import readXlsxFile, { type Sheet } from 'read-excel-file/browser'
import {
  AlertTriangle, BarChart3, BookOpen, CalendarRange, ChevronDown, CircleHelp, ClipboardList, Code2, Database,
  Download, FileJson, FileSpreadsheet, FileText, GitBranch, LayoutDashboard, Loader2, Moon, Redo2, RotateCcw,
  Sigma, Presentation, Sun, Trash2, Undo2, Upload, Wand2, X,
} from 'lucide-react'
import type { DataFrame, DataRow, DataType, Language, Op, PipelineStep, Theme } from './types'
import type { MessageKey as Key } from './i18n'
import { t } from './i18n'
import { createSampleData } from './data'
import { rowsFromExcelSheet } from './excel'
import { profileColumns } from './analysis'
import { buildReportHtml } from './report'
import { buildFrame, buildPandasScript, makeStep, type PipelineError } from './operations'
import {
  loadDefaultDataset, loadLanguage, loadTheme, loadWorkspace, parseProjectFile,
  saveDefaultDataset, saveLanguage, saveTheme, saveWorkspace,
} from './persistence'
import { getColumns, normalizeRows, uid } from './utils'
import { OverviewPanel } from './components/OverviewPanel'
import type { StoryItem } from './story'
import type { ChartConfig } from './charts'
import { Button, EmptyState, Field, IconButton, Modal, Panel, Select, Toggle } from './components/ui'

type View = 'overview' | 'transform' | 'analyze' | 'visualize' | 'timeSeries' | 'storyboard' | 'pipeline'

const MAX_FILE_BYTES = 20 * 1024 * 1024

const AnalyzePanel = lazy(() => import('./components/AnalyzePanel').then((module) => ({ default: module.AnalyzePanel })))
const TransformPanel = lazy(() => import('./components/TransformPanel').then((module) => ({ default: module.TransformPanel })))
const VisualizePanel = lazy(() => import('./components/VisualizePanel').then((module) => ({ default: module.VisualizePanel })))
const TimeSeriesPanel = lazy(() => import('./components/TimeSeriesPanel').then((module) => ({ default: module.TimeSeriesPanel })))
const StoryBoardPanel = lazy(() => import('./components/StoryBoardPanel').then((module) => ({ default: module.StoryBoardPanel })))

export default function App() {
  const [language, setLanguage] = useState<Language>(() => loadLanguage() ?? 'zh')
  // The persisted session is restored asynchronously from IndexedDB; until then
  // a lightweight loading screen avoids flashing (and overwriting) the sample.
  const [hydrated, setHydrated] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => loadTheme() ?? 'light')
  const [view, setView] = useState<View>('overview')
  const [helpOpen, setHelpOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingExcel, setPendingExcel] = useState<{ file: File; asRight: boolean; sheets: Sheet[]; selectedSheet: string } | null>(null)
  const [rememberDefault, setRememberDefault] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  const [columnFocus, setColumnFocus] = useState<string | null>(null)
  const [rightFrame, setRightFrame] = useState<{ name: string; rows: DataRow[] } | null>(null)
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])

  /* The source rows plus the ordered operation list: the pipeline is the single
     source of truth, and every view is derived from it. */
  const [source, setSource] = useState<DataRow[]>(createSampleData)
  const [sourceName, setSourceName] = useState('retail_sample.csv')
  const [isSample, setIsSample] = useState(true)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [redoStack, setRedoStack] = useState<PipelineStep[][]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const msg = useCallback((key: Key) => t(language, key), [language])

  const notify = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((current) => (current === text ? '' : current)), 2800)
  }, [])

  /* ------------------------------------------------------------ derived */
  // The pipeline runs on a dedicated worker; this state carries its latest
  // result (and captured step error) back to the UI thread. It starts with
  // the synchronously-built source frame so first paint never waits.
  const [pipelineState, setPipelineState] = useState<{ frame: DataFrame; error?: PipelineError }>(
    () => ({ frame: buildFrame(source) }),
  )
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const pipelineWorkerRef = useRef<Worker | null>(null)
  const pipelineSeqRef = useRef(0)
  const { frame, error: pipelineError } = pipelineState
  const sourceFrame = useMemo(() => buildFrame(source), [source])

  /* ---------------------------------------------------------- pipeline */
  const addStep = useCallback((op: Op, labels?: { zh: string; en: string }) => {
    setSteps((current) => [
      ...current,
      makeStep(op, labels ? { labelZh: labels.zh, labelEn: labels.en } : undefined),
    ])
    setRedoStack([])
    setPage(1)
    notify(t(language, 'operationDone'))
  }, [language, notify])

  const undo = useCallback(() => {
    setSteps((current) => {
      if (!current.length) return current
      setRedoStack((stack) => [...stack, current])
      return current.slice(0, -1)
    })
    setPage(1)
  }, [])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack
      const restored = stack[stack.length - 1]
      setSteps(restored)
      return stack.slice(0, -1)
    })
    setPage(1)
  }, [])

  const moveStep = (id: string, direction: -1 | 1) => {
    setSteps((current) => {
      const index = current.findIndex((step) => step.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const toggleStep = (id: string) =>
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, enabled: !step.enabled } : step)))

  const removeStep = (id: string) => {
    setSteps((current) => current.filter((step) => step.id !== id))
    notify(t(language, 'stepRemoved'))
  }

  const resetAll = () => {
    setSource(createSampleData())
    setSourceName('retail_sample.csv')
    setIsSample(true)
    setSteps([])
    setRedoStack([])
    setSearch('')
    setPage(1)
    setRightFrame(null)
    setColumnFocus(null)
    setStoryItems([])
    notify(t(language, 'resetConfirm'))
  }

  /* ------------------------------------------------------------- import */
  const parseFile = useCallback(async (file: File): Promise<DataRow[]> => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'csv' || extension === 'txt') {
      // Parse on a dedicated Vite worker so a multi-MB file never freezes the
      // UI (and the "parsing" indicator can paint).
      const worker = new Worker(new URL('./csvWorker.ts', import.meta.url), { type: 'module' })
      try {
        const data = await new Promise<unknown[]>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<{ data?: unknown[]; error?: string }>) =>
            event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.data ?? [])
          worker.onerror = reject
          worker.postMessage(file)
        })
        return normalizeRows(data)
      } finally {
        worker.terminate()
      }
    }
    if (extension === 'json') {
      const json = JSON.parse(await file.text())
      const list = Array.isArray(json) ? json : json.data ?? json.rows ?? json.records ?? []
      return normalizeRows(Array.isArray(list) ? list : [])
    }
    return []
  }, [])

  const loadFile = useCallback(async (file: File | undefined, asRight = false, selectedSheet?: string) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      notify(t(language, 'tooLarge'))
      return
    }
    setParsing(true)
    try {
      // Portable project bundle: restore data, pipeline and storyboard whole.
      const lowerName = file.name.toLowerCase()
      if (!asRight && (lowerName.endsWith('.datacanvas.json') || lowerName.endsWith('.json'))) {
        const project = parseProjectFile(await file.text())
        if (project) {
          setSource(project.source)
          setSourceName(project.sourceName)
          setIsSample(false)
          setSteps(project.steps)
          setRedoStack([])
          setSearch('')
          setPage(1)
          setColumnFocus(null)
          setStoryItems(project.storyItems)
          setRightFrame(null)
          setImportOpen(false)
          if (rememberDefault) {
            void saveDefaultDataset({ source: project.source, sourceName: project.sourceName })
            setRememberDefault(false)
          }
          notify(`${t(language, 'projectRestored')} ${project.sourceName} · ${project.steps.length} ${t(language, 'pipelineSteps')}${rememberDefault ? ` · ${t(language, 'defaultSaved')}` : ''}`)
          return
        }
        if (lowerName.endsWith('.datacanvas.json')) throw new Error('invalid project')
      }
      let parsed: DataRow[]
      if (lowerName.endsWith('.xlsx')) {
        const sheets = pendingExcel?.file === file ? pendingExcel.sheets : await readXlsxFile(file)
        if (!sheets.length) throw new Error('empty workbook')
        if (sheets.length > 1 && !selectedSheet) {
          setPendingExcel({ file, asRight, sheets, selectedSheet: sheets[0].sheet })
          setImportOpen(false)
          return
        }
        const sheet = sheets.find((item) => item.sheet === selectedSheet) ?? sheets[0]
        parsed = rowsFromExcelSheet(sheet)
        setPendingExcel(null)
      } else {
        parsed = await parseFile(file)
      }
      if (!parsed.length || !getColumns(parsed).length) throw new Error('empty')
      if (asRight) {
        setRightFrame({ name: file.name, rows: parsed })
      } else {
        setSource(parsed)
        setSourceName(file.name)
        setIsSample(false)
        setSteps([])
        setRedoStack([])
        setSearch('')
        setPage(1)
        setColumnFocus(null)
        setStoryItems([])
        setImportOpen(false)
        if (rememberDefault) {
          void saveDefaultDataset({ source: parsed, sourceName: file.name })
          setRememberDefault(false)
        }
      }
      notify(`${t(language, 'imported')} ${file.name} · ${parsed.length} ${t(language, 'rows')}${rememberDefault ? ` · ${t(language, 'defaultSaved')}` : ''}`)
    } catch {
      notify(t(language, 'invalidFile'))
    } finally {
      setParsing(false)
    }
  }, [language, notify, parseFile, pendingExcel, rememberDefault])

  /* ------------------------------------------------------------- export */
  const download = useCallback((content: string, fileName: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    notify(t(language, 'exported'))
  }, [language, notify])

  const stamp = new Date().toISOString().slice(0, 10)

  const exportCsv = () => {
    download(
      `\ufeff${Papa.unparse(frame.rows, { columns: frame.columns })}`,
      `datacanvas-${stamp}.csv`,
      'text/csv;charset=utf-8',
    )
    setExportOpen(false)
  }

  const exportJson = () => {
    download(JSON.stringify(frame.rows, null, 2), `datacanvas-${stamp}.json`, 'application/json')
    setExportOpen(false)
  }

  // A project file bundles the raw data WITH the pipeline and storyboard,
  // so importing it reproduces the whole analysis rather than its end result.
  const exportProject = () => {
    const project = {
      app: 'DataCanvas',
      format: 'datacanvas-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceName,
      source,
      steps,
      storyItems,
    }
    download(
      JSON.stringify(project, null, 2),
      `datacanvas-${stamp}.datacanvas.json`,
      'application/json',
    )
    setExportOpen(false)
  }

  const exportXlsx = () => {
    // No SheetJS dependency, so the table is written as an Excel-readable HTML
    // table with an .xls extension — Excel and LibreOffice both open it.
    const escape = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const head = frame.columns.map((column) => `<th>${escape(column)}</th>`).join('')
    const body = frame.rows
      .map((row) => `<tr>${frame.columns.map((column) => `<td>${escape(row[column])}</td>`).join('')}</tr>`)
      .join('')
    const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head>'
      + `<body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
    download(`\ufeff${html}`, `datacanvas-${stamp}.xls`, 'application/vnd.ms-excel')
    setExportOpen(false)
  }

  const exportScript = () => {
    download(buildPandasScript(sourceName, steps, language), 'datacanvas_pipeline.py', 'text/x-python;charset=utf-8')
    setExportOpen(false)
  }

  // A self-contained HTML report: rendered off-screen from the CURRENT frame,
  // so it captures the analysis result (post-pipeline) as a shareable artifact.
  const exportReport = () => {
    download(
      buildReportHtml({ frame, sourceName, steps, language }),
      `datacanvas-report-${stamp}.html`,
      'text/html;charset=utf-8',
    )
    setExportOpen(false)
  }

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(buildPandasScript(sourceName, steps, language))
      notify(t(language, 'codeCopied'))
    } catch {
      notify(t(language, 'codeCopied'))
    }
  }

  /* --------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = !!target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (typing) return
      if (event.key === '/') {
        event.preventDefault()
        setView('overview')
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
      if (event.key.toLowerCase() === 'l') setLanguage((current) => (current === 'zh' ? 'en' : 'zh'))
      if (event.key === '?') setHelpOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, undo])

  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en' }, [language])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveTheme(theme)
  }, [theme])

  /* ---------------------------------------------------- pipeline worker */
  // One worker for the app's lifetime; the incremental frame cache persists
  // inside it across messages, so the UI thread never runs applyOp itself.
  useEffect(() => {
    const worker = new Worker(new URL('./pipelineWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ seq: number; frame: DataFrame; error?: PipelineError }>) => {
      // A later edit invalidates in-flight responses: only the newest seq lands.
      if (event.data.seq !== pipelineSeqRef.current) return
      setPipelineState({ frame: event.data.frame, error: event.data.error })
      setPipelineBusy(false)
    }
    worker.onerror = () => setPipelineBusy(false)
    pipelineWorkerRef.current = worker
    return () => {
      worker.terminate()
      pipelineWorkerRef.current = null
    }
  }, [])

  useEffect(() => {
    const worker = pipelineWorkerRef.current
    if (!worker || !hydrated) return
    pipelineSeqRef.current += 1
    setPipelineBusy(true)
    worker.postMessage({ seq: pipelineSeqRef.current, source, steps })
  }, [hydrated, source, steps])

  /* ------------------------------------------------------ persistence */
  // Restore the previous session exactly once on startup.
  useEffect(() => {
    let cancelled = false
    loadWorkspace()
      .then(async (saved) => {
        if (cancelled) return
        if (saved) {
          setSource(saved.source)
          setSourceName(saved.sourceName)
          setIsSample(saved.isSample)
          setSteps(saved.steps)
          setStoryItems(saved.storyItems ?? [])
          if (saved.rightFrame) setRightFrame(saved.rightFrame)
          if (saved.steps.length || saved.storyItems.length || !saved.isSample) {
            notify(t(language, 'workspaceRestored'))
          }
          return
        }
        // Fresh start (no saved session) — fall back to the remembered default
        // dataset before resorting to the built-in sample.
        const fallback = await loadDefaultDataset()
        if (cancelled || !fallback) return
        setSource(fallback.source)
        setSourceName(fallback.sourceName)
        setIsSample(false)
        notify(`${t(language, 'defaultLoaded')} · ${fallback.sourceName}`)
      })
      .finally(() => { if (!cancelled) setHydrated(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { saveLanguage(language) }, [language])

  // Debounced autosave: covers imported files, every pipeline edit and pins.
  useEffect(() => {
    if (!hydrated) return
    const handle = window.setTimeout(() => {
      void saveWorkspace({ source, sourceName, isSample, steps, storyItems, rightFrame })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [hydrated, source, sourceName, isSample, steps, storyItems, rightFrame])

  /* ------------------------------------------------------------ render */
  const navItems: Array<{ id: View; icon: React.ReactNode; label: Key; badge?: number }> = [
    { id: 'overview', icon: <LayoutDashboard size={17} />, label: 'overview' },
    { id: 'transform', icon: <Wand2 size={17} />, label: 'transform' },
    { id: 'analyze', icon: <Sigma size={17} />, label: 'analyze' },
    { id: 'visualize', icon: <BarChart3 size={17} />, label: 'visualize' },
    { id: 'timeSeries', icon: <CalendarRange size={17} />, label: 'timeSeries' },
    { id: 'storyboard', icon: <Presentation size={17} />, label: 'storyboard', badge: storyItems.length },
    { id: 'pipeline', icon: <GitBranch size={17} />, label: 'pipeline', badge: steps.length },
  ]

  if (!hydrated) {
    return (
      <div className="app-loading" role="status">
        <img src="./assets/datacanvas-logo.webp" alt="DataCanvas" width={48} height={48} />
        <span>{msg('preparing')}</span>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="./assets/datacanvas-logo.webp" alt="DataCanvas" width={40} height={40} />
          </div>
          <div>
            <strong>{msg('appName')}</strong>
            <span>{msg('appTagline')}</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`nav-button ${view === item.id ? 'active' : ''}`}
              title={msg(item.label)}
              onClick={() => setView(item.id)}
            >
              <small className="nav-index">{String(index + 1).padStart(2, '0')}</small>
              {item.icon}
              <span>{msg(item.label)}</span>
              {item.badge ? <em className="nav-badge">{item.badge}</em> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <Button variant="primary" icon={<Upload size={15} />} onClick={() => setImportOpen(true)}>
            {msg('import')}
          </Button>
          <Button variant="ghost" icon={<BookOpen size={15} />} onClick={() => setHelpOpen(true)}>
            {msg('help')}
          </Button>
        </div>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Database size={14} />
            <span>{msg('localSafe')}</span>
          </div>
          <div className="dataset-mini">
            <span>{msg('dataset')}</span>
            <strong title={sourceName}>{sourceName}</strong>
            <small>
              {frame.rows.length} × {frame.columns.length}
              {steps.length ? ` · ${steps.length}` : ''}
            </small>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">
              <span className={`source-dot ${isSample ? 'sample' : 'file'}`} />
              {isSample ? msg('sampleSource') : msg('uploadedSource')}
            </p>
            <h1 key={view} className="view-title">{msg(view)}</h1>
          </div>

          <div className="top-actions">
            <div className="segmented">
              <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中</button>
              <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
            </div>
            <IconButton
              className="theme-toggle"
              title={theme === 'dark' ? msg('switchToLight') : msg('switchToDark')}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <Button
              className="mobile-import-action"
              variant="primary"
              icon={<Upload size={15} />}
              onClick={() => setImportOpen(true)}
            >
              {msg('import')}
            </Button>
            <IconButton title={msg('undo')} disabled={!steps.length} onClick={undo}><Undo2 size={16} /></IconButton>
            <IconButton title={msg('redo')} disabled={!redoStack.length} onClick={redo}><Redo2 size={16} /></IconButton>
            <IconButton title={msg('codePreview')} onClick={() => setCodeOpen(true)}><Code2 size={16} /></IconButton>
            <div className="menu-wrap">
              <Button variant="ghost" icon={<Download size={15} />} onClick={() => setExportOpen((open) => !open)}>
                {msg('export')} <ChevronDown size={13} />
              </Button>
              {exportOpen && (
                <>
                  <div className="menu-scrim" onClick={() => setExportOpen(false)} />
                  <div className="menu">
                    <button type="button" onClick={exportCsv}><FileText size={15} />{msg('exportCsv')}</button>
                    <button type="button" onClick={exportXlsx}><FileSpreadsheet size={15} />{msg('exportXlsx')}</button>
                    <button type="button" onClick={exportJson}><FileJson size={15} />{msg('exportJson')}</button>
                    <button type="button" onClick={exportProject}><Database size={15} />{msg('exportProject')}</button>
                    <button type="button" onClick={exportScript}><Code2 size={15} />{msg('exportScript')}</button>
                    <button type="button" onClick={exportReport}><ClipboardList size={15} />{msg('exportReport')}</button>
                  </div>
                </>
              )}
            </div>
            <Button variant="subtle" icon={<RotateCcw size={15} />} onClick={resetAll}>{msg('reset')}</Button>
          </div>
        </header>

        <section className="workspace">
          {pipelineBusy && (
            <div className="pipeline-busy" role="status" aria-live="polite">
              <Loader2 size={14} />
              <span>{msg('computing')}</span>
            </div>
          )}
          {pipelineError && (
            <div className="pipeline-error-banner" role="alert">
              <AlertTriangle size={18} />
              <div className="banner-text">
                <strong>{msg('errorBannerTitle')}</strong>
                <code>
                  {msg('stepFailedAt').replace('{n}', String(pipelineError.index + 1))}
                  {' · '}
                  {pipelineError.message}
                </code>
              </div>
              <Button variant="subtle" onClick={() => setView('pipeline')}>{msg('gotoPipeline')}</Button>
            </div>
          )}
          <Suspense fallback={<div className="view-loading" role="status">{language === 'zh' ? '正在加载分析模块…' : 'Loading analysis module…'}</div>}>
          {view === 'overview' && (
            <OverviewPanel
              frame={frame}
              sourceFrame={sourceFrame}
              stepCount={steps.length}
              language={language}
              theme={theme}
              msg={msg}
              sourceName={sourceName}
              isSample={isSample}
              view={{ search, setSearch, page, setPage, pageSize, setPageSize }}
              onOpenColumn={setColumnFocus}
              addStep={addStep}
            />
          )}

          {view === 'transform' && (
            <TransformPanel
              frame={frame}
              language={language}
              msg={msg}
              addStep={addStep}
              rightFrame={rightFrame}
              onPickRight={(file) => { void loadFile(file, true) }}
              notify={notify}
            />
          )}

          {view === 'timeSeries' && (
            <TimeSeriesPanel frame={frame} language={language} theme={theme} msg={msg} />
          )}

          {view === 'storyboard' && (
            <StoryBoardPanel
              frame={frame}
              items={storyItems}
              setItems={setStoryItems}
              language={language}
              msg={msg}
              notify={notify}
            />
          )}

          {view === 'analyze' && (
            <AnalyzePanel frame={frame} language={language} theme={theme} msg={msg} addStep={addStep} />
          )}

          {view === 'visualize' && (
            <VisualizePanel
              frame={frame}
              sourceFrame={sourceFrame}
              language={language}
              theme={theme}
              msg={msg}
              addStep={addStep}
              notify={notify}
              onPin={(config: ChartConfig, notes: { noteZh: string; noteEn: string }) => {
                setStoryItems((current) => [...current, {
                  id: uid(), config: { ...config }, ...notes,
                }])
                notify(msg('pinnedToStory'))
              }}
            />
          )}

          {view === 'pipeline' && (
            <PipelineView
              steps={steps}
              sourceName={sourceName}
              sourceRows={source}
              frame={frame}
              pipelineError={pipelineError}
              language={language}
              msg={msg}
              onMove={moveStep}
              onToggle={toggleStep}
              onRemove={removeStep}
              onClear={() => { setSteps([]); setRedoStack([]) }}
              onCopyScript={copyScript}
              onOpenColumn={setColumnFocus}
            />
          )}
          </Suspense>
        </section>
      </main>

      <aside className="history-rail">
        <div className="rail-title">
          <span><GitBranch size={16} />{msg('pipelineSteps')}</span>
          <IconButton title={msg('undo')} disabled={!steps.length} onClick={undo}><Undo2 size={15} /></IconButton>
        </div>
        <div className="history-list">
          {!steps.length && (
            <div className="empty-history">
              <CircleHelp size={22} />
              <span>{msg('emptyPipeline')}</span>
            </div>
          )}
          {steps.map((step, index) => {
            const failed = pipelineError?.stepId === step.id
            const blocked = !!pipelineError && index > pipelineError.index
            return (
            <button
              type="button"
              className={`history-item ${step.enabled ? '' : 'disabled'} ${failed ? 'failed' : ''} ${blocked ? 'blocked' : ''}`}
              key={step.id}
              onClick={() => setView('pipeline')}
              title={failed ? pipelineError.message : blocked ? msg('stepBlocked') : undefined}
            >
              <span className="history-dot">{failed ? <AlertTriangle size={12} /> : index + 1}</span>
              <div>
                <strong>{language === 'zh' ? step.labelZh : step.labelEn}</strong>
                <small>{failed ? pipelineError.message : msg('pandasCode')}</small>
              </div>
            </button>
            )
          })}
        </div>
        <Button variant="ghost" className="rail-reset" icon={<RotateCcw size={15} />} onClick={resetAll}>
          {msg('reset')}
        </Button>
      </aside>

      {/* ------------------------------------------------------ dialogs */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)}>
        <div className="modal-icon"><FileSpreadsheet size={24} /></div>
        <h2>{msg('import')}</h2>
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void loadFile(event.dataTransfer.files[0])
          }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={26} />
          <strong>{parsing ? msg('parsing') : msg('dropHere')}</strong>
          <span>{msg('supported')}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.json,.txt,.datacanvas.json"
            hidden
            onChange={(event) => {
              void loadFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
        <div className="modal-option">
          <Toggle checked={rememberDefault} onChange={setRememberDefault} label={msg('loadAsDefault')} />
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setImportOpen(false)}>{msg('cancel')}</Button>
          <Button variant="primary" onClick={() => fileRef.current?.click()}>{msg('loadFile')}</Button>
        </div>
      </Modal>

      <Modal open={!!pendingExcel} onClose={() => setPendingExcel(null)}>
        <div className="modal-icon"><FileSpreadsheet size={24} /></div>
        <h2>{msg('sheet')}</h2>
        {pendingExcel && (
          <Field label={msg('sheet')}>
            <Select
              value={pendingExcel.selectedSheet}
              options={pendingExcel.sheets.map((item) => item.sheet)}
              onChange={(selectedSheet) => setPendingExcel((current) => current && { ...current, selectedSheet })}
            />
          </Field>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setPendingExcel(null)}>{msg('cancel')}</Button>
          <Button variant="primary" onClick={() => { if (pendingExcel) void loadFile(pendingExcel.file, pendingExcel.asRight, pendingExcel.selectedSheet) }}>{msg('import')}</Button>
        </div>
      </Modal>

      <Modal open={codeOpen} onClose={() => setCodeOpen(false)} wide>
        <div className="modal-icon"><Code2 size={24} /></div>
        <h2>{msg('codePreview')}</h2>
        <p className="modal-hint">{msg('codePreviewHint')}</p>
        <pre className="code-block"><code>{buildPandasScript(sourceName, steps, language)}</code></pre>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCodeOpen(false)}>{msg('close')}</Button>
          <Button variant="primary" icon={<Code2 size={15} />} onClick={copyScript}>{msg('copyCode')}</Button>
        </div>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} wide>
        <div className="modal-icon"><BookOpen size={24} /></div>
        <h2>{msg('helpTitle')}</h2>
        <p className="modal-hint">{msg('helpIntro')}</p>
        <ol className="help-list">
          {(['helpStep1', 'helpStep2', 'helpStep3', 'helpStep4', 'helpStep5'] as const).map((step) => (
            <li key={step}>
              <strong>{msg(`${step}Title` as Key)}</strong>
              <span>{msg(step)}</span>
            </li>
          ))}
        </ol>
        <h3 className="help-sub">{msg('keyboardShortcuts')}</h3>
        <ul className="shortcut-list">
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>{msg('shortcutUndo')}</span></li>
          <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd><span>{msg('shortcutRedo')}</span></li>
          <li><kbd>/</kbd><span>{msg('shortcutSearch')}</span></li>
          <li><kbd>L</kbd><span>{msg('shortcutLang')}</span></li>
          <li><kbd>?</kbd><span>{msg('shortcutHelp')}</span></li>
        </ul>
      </Modal>

      {columnFocus && (
        <ColumnDrawer
          column={columnFocus}
          frame={frame}
          language={language}
          msg={msg}
          onClose={() => setColumnFocus(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-dot" />
          {toast}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Pipeline view
 * ------------------------------------------------------------------ */

function PipelineView({
  steps, sourceName, sourceRows, frame, pipelineError, language, msg, onMove, onToggle, onRemove, onClear,
  onCopyScript, onOpenColumn,
}: {
  steps: PipelineStep[]
  sourceName: string
  sourceRows: DataRow[]
  frame: { rows: DataRow[]; columns: string[]; types: Record<string, DataType> }
  pipelineError?: PipelineError
  language: Language
  msg: (key: Key) => string
  onMove: (id: string, direction: -1 | 1) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  onCopyScript: () => void
  onOpenColumn: (column: string) => void
}) {
  return (
    <div className="pipeline-layout">
      <div className="stack">
        <div className="page-intro">
          <span className="kicker">pipeline</span>
          <h2>{msg('pipeline')}</h2>
          <p>{msg('pipelineHint')}</p>
        </div>

        <Panel kicker={`${sourceName} · ${sourceRows.length} ${msg('rows')}`} title={msg('source')} dense>
          <div className="source-card">
            <Database size={18} />
            <div>
              <strong>{sourceName}</strong>
              <span>{sourceRows.length} × {getColumns(sourceRows).length}</span>
            </div>
            <span className="badge">{msg('source')}</span>
          </div>
        </Panel>

        <Panel
          kicker={`${steps.length} ${msg('pipelineSteps')}`}
          title={msg('pipelineSteps')}
          actions={steps.length
            ? <Button variant="subtle" icon={<Trash2 size={14} />} onClick={onClear}>{msg('clear')}</Button>
            : null}
        >
          {!steps.length ? (
            <EmptyState icon={<GitBranch size={24} />} title={msg('emptyPipeline')} />
          ) : (
            <ol className="step-list">
              {steps.map((step, index) => {
                const failed = pipelineError?.stepId === step.id
                const blocked = !!pipelineError && index > pipelineError.index
                return (
                <li
                  key={step.id}
                  className={`${step.enabled ? '' : 'disabled'} ${failed ? 'failed' : ''} ${blocked ? 'blocked' : ''}`}
                >
                  <span className="step-index">{failed ? <AlertTriangle size={14} /> : index + 1}</span>
                  <div className="step-body">
                    <strong>{language === 'zh' ? step.labelZh : step.labelEn}</strong>
                    <pre><code>{step.code}</code></pre>
                    {failed && (
                      <p className="step-error"><AlertTriangle size={13} />{pipelineError!.message}</p>
                    )}
                    {blocked && <p className="step-blocked-note">{msg('stepBlocked')}</p>}
                  </div>
                  <div className="step-actions">
                    <IconButton title={msg('moveUp')} disabled={index === 0} onClick={() => onMove(step.id, -1)}>↑</IconButton>
                    <IconButton title={msg('moveDown')} disabled={index === steps.length - 1} onClick={() => onMove(step.id, 1)}>↓</IconButton>
                    <IconButton
                      title={step.enabled ? msg('stepEnabled') : msg('stepDisabled')}
                      active={step.enabled}
                      onClick={() => onToggle(step.id)}
                    >
                      {step.enabled ? '●' : '○'}
                    </IconButton>
                    <IconButton title={msg('deleteStep')} onClick={() => onRemove(step.id)}><X size={14} /></IconButton>
                  </div>
                </li>
                )
              })}
            </ol>
          )}
        </Panel>

        <Panel
          kicker="python"
          title={msg('codePreview')}
          actions={<Button variant="primary" icon={<Code2 size={15} />} onClick={onCopyScript}>{msg('copyCode')}</Button>}
        >
          <p className="hint">{msg('codePreviewHint')}</p>
          <pre className="code-block"><code>{buildPandasScript(sourceName, steps, language)}</code></pre>
        </Panel>
      </div>

      <aside className="pipeline-side stack">
        <Panel kicker="result" title={msg('preview')} dense>
          {pipelineError && (
            <p className="side-warning"><AlertTriangle size={13} />{msg('resultUntilStep')}</p>
          )}
          <div className="side-stats">
            <div><span>{msg('rows')}</span><strong>{frame.rows.length}</strong></div>
            <div><span>{msg('columns')}</span><strong>{frame.columns.length}</strong></div>
          </div>
          <ul className="dtype-list">
            {frame.columns.map((column) => (
              <li key={column}>
                <button type="button" onClick={() => onOpenColumn(column)}>{column}</button>
                <code>{frame.types[column]}</code>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Column detail drawer
 * ------------------------------------------------------------------ */

function ColumnDrawer({
  column, frame, language, msg, onClose,
}: {
  column: string
  frame: { rows: DataRow[]; columns: string[]; types: Record<string, DataType> }
  language: Language
  msg: (key: Key) => string
  onClose: () => void
}) {
  const profile = useMemo(() => profileColumns(frame.rows, [column])[0], [frame.rows, column])
  const type = frame.types[column] ?? profile.type
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside className="drawer">
        <header>
          <div>
            <span className="kicker">{msg('columnProfile')}</span>
            <h2>{column}</h2>
            <span className={`type-pill ${type}`}>{type}</span>
          </div>
          <IconButton title={msg('close')} onClick={onClose}><X size={16} /></IconButton>
        </header>

        <dl className="drawer-stats">
          <div><dt>{msg('count')}</dt><dd>{profile.count}</dd></div>
          <div><dt>{msg('missing')}</dt><dd>{profile.missing}</dd></div>
          <div><dt>{msg('unique')}</dt><dd>{profile.unique}</dd></div>
          {profile.mean !== undefined && <div><dt>{msg('aggmean')}</dt><dd>{profile.mean.toFixed(2)}</dd></div>}
          {profile.median !== undefined && <div><dt>{msg('aggmedian')}</dt><dd>{profile.median.toFixed(2)}</dd></div>}
          {profile.std !== undefined && <div><dt>{msg('aggstd')}</dt><dd>{profile.std.toFixed(2)}</dd></div>}
          {profile.min !== undefined && <div><dt>{msg('aggmin')}</dt><dd>{profile.min.toFixed(2)}</dd></div>}
          {profile.max !== undefined && <div><dt>{msg('aggmax')}</dt><dd>{profile.max.toFixed(2)}</dd></div>}
          {profile.skew !== undefined && <div><dt>{msg('skew')}</dt><dd>{profile.skew.toFixed(3)}</dd></div>}
        </dl>

        <h3 className="drawer-sub">{msg('topValues')}</h3>
        <ul className="freq-list">
          {profile.topValues.map((item) => {
            const max = profile.topValues[0]?.count || 1
            return (
              <li key={item.value}>
                <span className="freq-label" title={item.value}>{item.value}</span>
                <span className="freq-track"><i style={{ width: `${(item.count / max) * 100}%` }} /></span>
                <b>{item.count}</b>
              </li>
            )
          })}
        </ul>

        <p className="hint">
          {msg('pandasViewHint').replace('{column}', column)}
        </p>
      </aside>
    </div>
  )
}
