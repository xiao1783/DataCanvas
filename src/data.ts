import type { DataRow } from './types'

/**
 * The built-in default dataset.
 *
 * It is generated with a seeded PRNG so the numbers are identical on every load —
 * that matters when a viewer compares their screen against a screenshot or a
 * walkthrough, and it keeps the default view stable across browser sessions.
 */

const CATEGORIES: Record<string, { products: Array<[string, number]>; base: number }> = {
  Electronics: { base: 1.35, products: [['Wireless Earbuds', 129], ['Smart Watch', 259], ['Power Bank', 59]] },
  Home: { base: 0.85, products: [['Desk Lamp', 45], ['Coffee Maker', 189], ['Air Purifier', 329]] },
  Office: { base: 0.7, products: [['Notebook Set', 22], ['Ergonomic Chair', 699], ['Marker Pack', 18]] },
  Sports: { base: 0.95, products: [['Yoga Mat', 79], ['Running Shoes', 449], ['Water Bottle', 35]] },
  Beauty: { base: 0.8, products: [['Face Serum', 168], ['Hand Cream', 39], ['Sunscreen', 88]] },
}

const REGIONS = ['East', 'North', 'South', 'West'] as const
const REGION_WEIGHT: Record<string, number> = { East: 1.12, North: 0.98, South: 0.9, West: 1.0 }
const CHANNELS = ['Online', 'Retail', 'Partner'] as const
const CHANNEL_WEIGHT: Record<string, number> = { Online: 1.06, Retail: 1.0, Partner: 0.94 }
const SEGMENTS = ['Consumer', 'Corporate', 'Home Office'] as const

/** Mulberry32 — tiny deterministic PRNG, good enough for plausible sample data. */
const makeRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits))

export const SAMPLE_ROW_COUNT = 240

export const createSampleData = (): DataRow[] => {
  const random = makeRandom(20261009)
  const categoryNames = Object.keys(CATEGORIES)
  const rows: DataRow[] = []

  for (let index = 0; index < SAMPLE_ROW_COUNT; index += 1) {
    const category = categoryNames[Math.floor(random() * categoryNames.length)]
    const config = CATEGORIES[category]
    const [product, listPrice] = config.products[Math.floor(random() * config.products.length)]
    const region = REGIONS[Math.floor(random() * REGIONS.length)]
    const channel = CHANNELS[Math.floor(random() * CHANNELS.length)]
    const segment = SEGMENTS[Math.floor(random() * SEGMENTS.length)]

    const quantity = 1 + Math.floor(random() * 9)
    // Keep a small spread around list price so the column is not a step function.
    const unitPrice = round(listPrice * (0.92 + random() * 0.16))
    const discountRoll = random()
    const discount = discountRoll > 0.82 ? 0.15 : discountRoll > 0.62 ? 0.1 : discountRoll > 0.48 ? 0.05 : 0
    const weight = config.base * REGION_WEIGHT[region] * CHANNEL_WEIGHT[channel]
    const sales = round(quantity * unitPrice * (1 - discount) * weight * (0.94 + random() * 0.12))
    const cost = round(sales * (0.52 + random() * 0.16))

    const month = Math.floor(random() * 12)
    const day = 1 + Math.floor(random() * 28)
    const date = `${2026}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // Deliberately introduce missing values so dropna/fillna have real work to do,
    // and scatter a handful of duplicate rows to exercise drop_duplicates.
    const rating = random() > 0.94 ? null : round(2.9 + random() * 2.1, 1)
    const satisfaction = random() > 0.9 ? null : Math.round(58 + random() * 42)

    rows.push({
      OrderID: `ORD-${String(index + 1).padStart(4, '0')}`,
      Date: date,
      Region: region,
      Category: category,
      Product: product,
      Channel: channel,
      Segment: segment,
      Quantity: quantity,
      UnitPrice: unitPrice,
      Discount: discount,
      Sales: sales,
      Cost: cost,
      Profit: round(sales - cost),
      Rating: rating,
      Satisfaction: satisfaction,
    })
  }

  // Duplicate a few rows so the duplicate-detection tools are demonstrable.
  const duplicates = [12, 57, 148].map((source) => ({ ...rows[source] }))
  duplicates.forEach((row) => rows.push(row))

  return rows
}
