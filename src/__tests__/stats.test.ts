import { describe, expect, it } from 'vitest'
import { describeColumn, correlationMatrix } from '../analysis'
import { maxOf, mean, median, minOf, pearson, quantile, ranks, sorted, std } from '../utils'

describe('statistics primitives', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('computes the arithmetic mean', () => {
    expect(mean(values)).toBe(5.5)
  })

  it('uses the sample standard deviation (ddof = 1), matching pandas .std()', () => {
    expect(std(values)).toBeCloseTo(Math.sqrt(82.5 / 9), 10)
    expect(std(values, 0)).toBeCloseTo(Math.sqrt(8.25), 10)
  })

  it('linearly interpolates quantiles like numpy.percentile', () => {
    const s = sorted(values)
    expect(quantile(s, 0)).toBe(1)
    expect(quantile(s, 0.25)).toBeCloseTo(3.25, 10)
    expect(quantile(s, 0.5)).toBe(5.5)
    expect(quantile(s, 0.75)).toBeCloseTo(7.75, 10)
    expect(quantile(s, 1)).toBe(10)
    expect(median(values)).toBe(5.5)
  })

  it('ranks ties with the fractional-average method', () => {
    // 3 -> 4th, the two 1s share ranks 1.5, 2 -> 3rd
    expect(ranks([3, 1, 1, 2])).toEqual([4, 1.5, 1.5, 3])
  })

  it('computes perfect Pearson correlations', () => {
    const positive = values.map((x) => [x, 2 * x + 1] as [number, number])
    const negative = values.map((x) => [x, -3 * x] as [number, number])
    expect(pearson(positive)).toBeCloseTo(1, 12)
    expect(pearson(negative)).toBeCloseTo(-1, 12)
  })

  it('minOf/maxOf scan without argument spreading', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => i)
    expect(() => minOf(big)).not.toThrow()
    expect(minOf(big)).toBe(0)
    expect(maxOf(big)).toBe(99_999)
  })
})

describe('describeColumn', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ v: i + 1 }))
  const stats = describeColumn(rows, 'v')

  it('reports pandas-compatible summary statistics', () => {
    expect(stats.count).toBe(10)
    expect(stats.missing).toBe(0)
    expect(stats.mean).toBeCloseTo(5.5, 10)
    expect(stats.std).toBeCloseTo(Math.sqrt(82.5 / 9), 10)
    expect(stats.median).toBe(5.5)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(10)
  })
})

describe('correlationMatrix', () => {
  it('returns +1 for a perfectly linear relationship (Pearson)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ x: i + 1, y: 2 * (i + 1) + 1 }))
    const result = correlationMatrix(rows, ['x', 'y'], 'pearson')
    expect(result.matrix[0][1]).toBeCloseTo(1, 12)
    expect(result.matrix[1][0]).toBeCloseTo(1, 12)
  })

  it('returns +1 for any monotonic relationship (Spearman, ranked)', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: x ** 3 }))
    const result = correlationMatrix(rows, ['x', 'y'], 'spearman')
    expect(result.matrix[0][1]).toBeCloseTo(1, 12)
  })

  it('deletes missing entries pairwise', () => {
    const rows = [
      { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: null }, { x: 4, y: 8 },
    ]
    const result = correlationMatrix(rows, ['x', 'y'], 'pearson')
    // Computed over the three complete rows, which stay perfectly linear.
    expect(result.matrix[0][1]).toBeCloseTo(1, 12)
  })
})
