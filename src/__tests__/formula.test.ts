import { describe, expect, it } from 'vitest'
import { evaluateFormula, validateFormula } from '../analysis'

describe('validateFormula', () => {
  const columns = ['Sales', 'Cost', 'Unit Price', 'Quantity']

  it('accepts known columns and built-in functions', () => {
    expect(validateFormula('Sales - Cost', columns).ok).toBe(true)
    expect(validateFormula('round([Unit Price] * Quantity, 2)', columns).ok).toBe(true)
  })

  it('flags an unknown bare identifier', () => {
    const result = validateFormula('Sales + Profit', columns)
    expect(result.ok).toBe(false)
    expect(result.unknown).toBe('Profit')
  })
})

describe('evaluateFormula', () => {
  const columns = ['Unit Price', 'Quantity', 'Sales', 'Cost', 'Region']
  const row = { 'Unit Price': 3, Quantity: 4, Sales: 30, Cost: 12, Region: 'East' }

  it('resolves bracketed column names containing spaces', () => {
    expect(evaluateFormula('[Unit Price] * Quantity', row, columns)).toBe(12)
  })

  it('resolves bare identifiers (longest name first)', () => {
    expect(evaluateFormula('Sales - Cost', row, columns)).toBe(18)
  })

  it('supports built-in functions', () => {
    expect(evaluateFormula('round(Sales / 7, 2)', row, columns)).toBe(4.29)
    expect(evaluateFormula('max(Sales, Cost)', row, columns)).toBe(30)
  })

  it('turns an unknown bracketed column into null', () => {
    expect(evaluateFormula('[Margin] * 2', row, columns)).toBeNull()
  })

  it('returns null for missing operands instead of NaN', () => {
    expect(evaluateFormula('Sales + Missing', row, columns)).toBeNull()
  })
})
