import { describe, expect, it } from 'vitest'
import type { DataRow, Op, PipelineStep } from '../types'
import { makeStep, runPipeline } from '../operations'

const source: DataRow[] = [
  { cat: 'A', n: 1 },
  { cat: 'B', n: 2 },
  { cat: 'A', n: 3 },
]

const filterA = makeStep({
  kind: 'filter',
  conditions: [{ id: 'c1', column: 'cat', operator: 'equals', value: 'A' }],
  conjunction: 'and',
})

const head2 = makeStep({ kind: 'head', n: 2 })

describe('runPipeline', () => {
  it('applies enabled steps in order', () => {
    const result = runPipeline(source, [filterA, head2])
    expect(result.run.error).toBeUndefined()
    expect(result.run.frame.rows).toHaveLength(2)
    expect(result.run.frame.rows.every((row) => row.cat === 'A')).toBe(true)
  })

  it('reuses unchanged prefix frames across runs (incremental cache)', () => {
    const first = runPipeline(source, [filterA])
    const second = runPipeline(source, [filterA, head2], first)
    // The first step's frame is the same object: it was not recomputed.
    expect(second.frames[1]).toBe(first.frames[1])
    expect(second.frames[0]).toBe(first.frames[0])
    expect(second.frames[2].rows).toHaveLength(2)
  })

  it('keeps cached frames when a new step is appended', () => {
    const first = runPipeline(source, [filterA, head2])
    const renamed = makeStep({ kind: 'renameColumn', from: 'cat', to: 'category' })
    const second = runPipeline(source, [filterA, head2, renamed], first)
    expect(second.frames[1]).toBe(first.frames[1])
    expect(second.frames[2]).toBe(first.frames[2])
    expect(second.run.frame.columns).toContain('category')
  })

  it('records a passthrough frame for disabled steps', () => {
    const off: PipelineStep = { ...head2, enabled: false }
    const result = runPipeline(source, [filterA, off])
    expect(result.frames).toHaveLength(3)
    expect(result.frames[2]).toBe(result.frames[1])
    expect(result.run.frame.rows).toHaveLength(2)
  })

  it('captures a failing step instead of throwing and keeps the last good frame', () => {
    const broken: PipelineStep = {
      id: 'broken',
      // Deliberately malformed: a filter needs a conditions array.
      op: { kind: 'filter' } as unknown as Op,
      labelZh: '坏步骤',
      labelEn: 'Broken step',
      code: '# broken',
      enabled: true,
      at: 0,
    }
    const result = runPipeline(source, [broken, head2])
    expect(result.run.error).toMatchObject({ stepId: 'broken', index: 0 })
    expect(result.run.frame.rows).toEqual(source)
    // Execution stopped at the broken step, so only the source frame exists.
    expect(result.frames).toHaveLength(1)
  })

  it('restarts from the source when the source array changes identity', () => {
    const first = runPipeline(source, [filterA])
    const newSource = [...source, { cat: 'A', n: 4 }]
    const second = runPipeline(newSource, [filterA], first)
    expect(second.frames[0]).not.toBe(first.frames[0])
    expect(second.run.frame.rows).toHaveLength(3)
  })
})
