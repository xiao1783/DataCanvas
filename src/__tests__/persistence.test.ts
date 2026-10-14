
import { describe, expect, it } from 'vitest'
import { makeStep } from '../operations'
import { parseProjectFile } from '../persistence'

describe('parseProjectFile', () => {
  it('rehydrates a valid project bundle', () => {
    const step = makeStep({ kind: 'head', n: 5 })
    const text = JSON.stringify({
      app: 'DataCanvas',
      format: 'datacanvas-project',
      version: 1,
      sourceName: 'demo.csv',
      source: [{ a: 1 }, { a: 2 }],
      steps: [step],
      storyItems: [],
    })
    const project = parseProjectFile(text)
    expect(project).not.toBeNull()
    expect(project?.sourceName).toBe('demo.csv')
    expect(project?.source).toHaveLength(2)
    expect(project?.steps).toHaveLength(1)
    expect(project?.storyItems).toEqual([])
  })

  it('rejects ordinary row JSON, malformed text and empty bundles', () => {
    expect(parseProjectFile('not json')).toBeNull()
    expect(parseProjectFile(JSON.stringify([{ a: 1 }]))).toBeNull()
    expect(parseProjectFile(JSON.stringify({ format: 'datacanvas-project', source: [], steps: [] }))).toBeNull()
    expect(parseProjectFile(JSON.stringify({ format: 'datacanvas-project', source: [{ a: 1 }] }))).toBeNull()
  })
})
