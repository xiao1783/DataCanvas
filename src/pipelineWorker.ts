import { runPipeline, type PipelineCache, type PipelineError } from './operations'
import type { DataFrame, DataRow, PipelineStep } from './types'

/**
 * Dedicated pipeline worker.
 *
 * The operation chain (filters, group-bys, joins on multi-thousand-row
 * frames) runs off the main thread, and the incremental cache lives here for
 * the worker's lifetime: identical leading steps never re-execute, the same
 * optimisation the synchronous runner offered, without ever blocking paint.
 */

interface PipelineRequest {
  seq: number
  source: DataRow[]
  steps: PipelineStep[]
}

interface PipelineResponse {
  seq: number
  frame: DataFrame
  error?: PipelineError
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PipelineRequest>) => void) | null
  postMessage: (message: PipelineResponse) => void
}

let cache: PipelineCache | null = null

scope.onmessage = (event) => {
  const { seq, source, steps } = event.data
  cache = runPipeline(source, steps, cache)
  scope.postMessage({ seq, frame: cache.run.frame, error: cache.run.error })
}
