import Papa from 'papaparse'

/**
 * Dedicated CSV parsing worker. Papa runs synchronously inside the worker, so
 * parsing a multi-MB file never blocks the main thread. Bundled as a separate
 * worker chunk by Vite (papaparse's own blob worker does not survive bundling).
 */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<File>) => void) | null
  postMessage: (message: { data?: unknown[]; error?: string }) => void
}

scope.onmessage = (event) => {
  Papa.parse<Record<string, unknown>>(event.data, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: true,
    complete: (result) => scope.postMessage({ data: result.data as unknown[] }),
    error: (error) => scope.postMessage({ error: String(error) }),
  })
}
