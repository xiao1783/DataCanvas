import type { DataRow, Language, PipelineStep, Theme } from './types'
import type { StoryItem } from './story'

/**
 * Workspace persistence.
 *
 * Small preferences (language) live in localStorage; the potentially large
 * dataset (up to 20 MB of uploaded rows, plus join/concat payloads embedded in
 * steps) lives in IndexedDB. Every function fails silently — persistence must
 * never break the workspace itself (private mode, quota, disabled storage).
 */

const DB_NAME = 'datacanvas'
const DB_VERSION = 1
const STORE = 'workspace'
const SESSION_KEY = 'session'
const DEFAULT_KEY = 'default'
const SCHEMA_VERSION = 1
const LANGUAGE_KEY = 'datacanvas:language'
const THEME_KEY = 'datacanvas:theme'

export interface SavedWorkspace {
  version: number
  savedAt: number
  source: DataRow[]
  sourceName: string
  isSample: boolean
  steps: PipelineStep[]
  storyItems: StoryItem[]
  rightFrame: { name: string; rows: DataRow[] } | null
}

export function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language)
  } catch {
    /* storage unavailable */
  }
}

export function loadLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY)
    return value === 'zh' || value === 'en' ? value : null
  } catch {
    return null
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* storage unavailable */
  }
}

export function loadTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

/**
 * Portable project files (.datacanvas.json): the same bundle that gets
 * autosaved to IndexedDB, but meant for export/import and sharing.
 */
export interface ProjectFile {
  app: string
  format: 'datacanvas-project'
  version: number
  exportedAt?: string
  sourceName: string
  source: DataRow[]
  steps: PipelineStep[]
  storyItems: StoryItem[]
}

export function parseProjectFile(text: string): ProjectFile | null {
  try {
    const parsed = JSON.parse(text) as Partial<ProjectFile>
    if (
      parsed && parsed.format === 'datacanvas-project'
      && Array.isArray(parsed.source) && parsed.source.length
      && Array.isArray(parsed.steps)
    ) {
      return {
        app: 'DataCanvas',
        format: 'datacanvas-project',
        version: parsed.version ?? 1,
        exportedAt: parsed.exportedAt,
        sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : 'imported-project',
        source: parsed.source,
        steps: parsed.steps,
        storyItems: Array.isArray(parsed.storyItems) ? parsed.storyItems : [],
      }
    }
    return null
  } catch {
    return null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveWorkspace(
  data: Omit<SavedWorkspace, 'version' | 'savedAt'>,
): Promise<void> {
  try {
    const db = await openDatabase()
    const record: SavedWorkspace = { ...data, version: SCHEMA_VERSION, savedAt: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, SESSION_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  } catch {
    /* quota or private mode — keep this session only */
  }
}

export async function loadWorkspace(): Promise<SavedWorkspace | null> {
  try {
    const db = await openDatabase()
    const record = await new Promise<SavedWorkspace | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(SESSION_KEY)
      request.onsuccess = () => resolve((request.result as SavedWorkspace | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    // Discard records written by an incompatible future schema.
    if (record && record.version === SCHEMA_VERSION && Array.isArray(record.source)) return record
    return null
  } catch {
    return null
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(SESSION_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Default dataset — the data the app starts from when no session was
 * saved. The user opts in via "remember as my default dataset" in the
 * import dialog; unlike the session it survives workspace resets.
 * ------------------------------------------------------------------ */

export interface SavedDefault {
  version: number
  savedAt: number
  source: DataRow[]
  sourceName: string
}

export async function saveDefaultDataset(data: { source: DataRow[]; sourceName: string }): Promise<void> {
  try {
    const db = await openDatabase()
    const record: SavedDefault = { version: SCHEMA_VERSION, savedAt: Date.now(), ...data }
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, DEFAULT_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  } catch {
    /* quota or private mode — the default simply is not remembered */
  }
}

export async function loadDefaultDataset(): Promise<SavedDefault | null> {
  try {
    const db = await openDatabase()
    const record = await new Promise<SavedDefault | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(DEFAULT_KEY)
      request.onsuccess = () => resolve((request.result as SavedDefault | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (record && record.version === SCHEMA_VERSION && Array.isArray(record.source) && record.source.length) {
      return record
    }
    return null
  } catch {
    return null
  }
}
