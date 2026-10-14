import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import type { DataFrame, Language, PipelineStep } from './types'
import { countDuplicates, correlationMatrix, detectOutliers, profileColumns, topCorrelations } from './analysis'
import { formatNumber } from './utils'
import { buildPandasScript } from './operations'
import { t, type MessageKey } from './i18n'

/**
 * One-click analysis report: assembles data quality, column profiles,
 * distribution snapshots (rendered offscreen with the same ECharts setup as
 * the app), correlations, an outlier scan and the equivalent pandas code
 * into a single self-contained HTML file.
 */

// Defensive re-registration — `echarts.use` is idempotent, and report.ts must
// work even if the eager panel tree that registers charts ever changes.
echarts.use([BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

const ACCENT = '#155eef'
const INK = '#1c2b44'
const MUTED = '#5b6b84'
const LINE = '#dfe6f1'

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Render an option offscreen and return a PNG data URL (2x for crispness). */
const renderChart = (option: EChartsCoreOption, width = 620, height = 300): string => {
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;height:${height}px;`
  document.body.appendChild(host)
  const chart = echarts.init(host, null, { renderer: 'canvas', width, height })
  chart.setOption(option)
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
  chart.dispose()
  host.remove()
  return url
}

const histogramOption = (profile: { histogram: number[]; min: number; max: number }): EChartsCoreOption => {
  const bins = profile.histogram.length
  const width = (profile.max - profile.min) / bins || 1
  const labels = profile.histogram.map((_, index) => formatNumber(profile.min + width * (index + 0.5)))
  return {
    grid: { left: 56, right: 18, top: 26, bottom: 56 },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { interval: 1, rotate: 45, fontSize: 9, color: MUTED },
      axisLine: { lineStyle: { color: LINE } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 9, color: MUTED }, splitLine: { lineStyle: { color: '#eef2f8' } },
    },
    series: [{
      type: 'bar', data: profile.histogram,
      itemStyle: { color: ACCENT, borderRadius: [3, 3, 0, 0] }, barCategoryGap: '22%',
    }],
  }
}

const categoryOption = (values: Array<{ value: string; count: number }>): EChartsCoreOption => ({
  grid: { left: 110, right: 46, top: 12, bottom: 28 },
  xAxis: { type: 'value', axisLabel: { fontSize: 9, color: MUTED }, splitLine: { lineStyle: { color: '#eef2f8' } } },
  yAxis: {
    type: 'category', data: values.map((entry) => entry.value).reverse(),
    axisLabel: { fontSize: 10, color: INK, width: 100, overflow: 'truncate' },
    axisLine: { lineStyle: { color: LINE } }, axisTick: { show: false },
  },
  series: [{
    type: 'bar',
    data: values.map((entry) => entry.count).reverse(),
    itemStyle: { color: ACCENT, opacity: 0.82, borderRadius: [0, 4, 4, 0] },
    barMaxWidth: 20,
    label: { show: true, position: 'right', fontSize: 10, color: MUTED },
  }],
})

const heatOption = (matrix: { columns: string[]; matrix: Array<Array<number | null>> }): EChartsCoreOption => {
  const cells: Array<[number, number, number | null]> = []
  matrix.columns.forEach((_, i) => matrix.columns.forEach((__, j) => cells.push([i, j, matrix.matrix[i][j]])))
  const showLabels = matrix.columns.length <= 9
  return {
    grid: { left: 104, right: 24, top: 10, bottom: matrix.columns.length > 8 ? 92 : 68 },
    xAxis: {
      type: 'category', data: matrix.columns,
      axisLabel: { rotate: 45, fontSize: 9, color: MUTED }, axisLine: { lineStyle: { color: LINE } },
    },
    yAxis: {
      type: 'category', data: matrix.columns,
      axisLabel: { fontSize: 9, color: MUTED }, axisLine: { lineStyle: { color: LINE } },
    },
    visualMap: {
      min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 4,
      itemHeight: 60, textStyle: { fontSize: 9, color: MUTED },
      inRange: { color: ['#2f6bff', '#ffffff', '#e5484d'] },
    },
    series: [{
      type: 'heatmap', data: cells,
      label: showLabels ? { show: true, fontSize: 8, color: MUTED, formatter: (params: { value: number }) => Number(params.value).toFixed(2) } : undefined,
      itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
    }],
  }
}

const img = (url: string, alt: string) =>
  `<figure class="chart"><img src="${url}" alt="${escapeHtml(alt)}"/><figcaption>${escapeHtml(alt)}</figcaption></figure>`

export interface ReportArgs {
  frame: DataFrame
  sourceName: string
  steps: PipelineStep[]
  language: Language
}

export const buildReportHtml = ({ frame, sourceName, steps, language }: ReportArgs): string => {
  const msg = (key: MessageKey) => t(language, key)
  const { rows, columns } = frame
  const profiles = profileColumns(rows, columns)
  const numericProfiles = profiles.filter((profile) => profile.type === 'number')
  const missingCells = profiles.reduce((total, profile) => total + profile.missing, 0)
  const duplicates = countDuplicates(rows)
  const totalCells = rows.length * columns.length
  const completeness = totalCells ? 1 - missingCells / totalCells : 1
  const duplicateRatio = rows.length ? duplicates / rows.length : 0
  const typedRatio = columns.length ? profiles.filter((profile) => profile.type !== 'text').length / columns.length : 0
  const quality = Math.max(0, Math.round(completeness * 55 + (1 - duplicateRatio) * 20 + typedRatio * 25))

  /* Distribution snapshots — up to 6 numeric histograms + up to 3 categorical bars. */
  const chartImgs: string[] = []
  numericProfiles.slice(0, 6).forEach((profile) => {
    if (profile.min === undefined || profile.max === undefined) return
    chartImgs.push(img(renderChart(histogramOption({ histogram: profile.histogram, min: profile.min, max: profile.max })), `${profile.name} · ${msg('distribution')}`))
  })
  profiles.filter((profile) => profile.type !== 'number').slice(0, 3).forEach((profile) => {
    if (!profile.topValues.length) return
    chartImgs.push(img(renderChart(categoryOption(profile.topValues)), `${profile.name} · ${msg('topValues')}`))
  })

  /* Correlations — capped so a 100-column frame stays readable. */
  const corrColumns = numericProfiles.slice(0, 12).map((profile) => profile.name)
  const pairs = corrColumns.length >= 2
    ? topCorrelations(correlationMatrix(rows, corrColumns), 6)
    : []
  const heatImg = corrColumns.length >= 2
    ? img(renderChart(heatOption(correlationMatrix(rows, corrColumns)), Math.min(720, 220 + corrColumns.length * 34), Math.min(560, 160 + corrColumns.length * 30)), msg('reportCorrelations'))
    : ''

  /* Outlier scan — IQR ×1.5 per numeric column, ranked by count. */
  const outlierRows = numericProfiles
    .map((profile) => {
      const bounds = detectOutliers(rows, profile.name, 'iqr')
      return { name: profile.name, count: bounds.indexes.length, low: bounds.low, high: bounds.high, present: profile.count }
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const kpis: Array<[string, string, boolean?]> = [
    [msg('qualityScore'), String(quality), true],
    [msg('rows'), `${formatNumber(rows.length)} × ${columns.length}`],
    [msg('missing'), formatNumber(missingCells)],
    [msg('duplicates'), formatNumber(duplicates)],
    [msg('completeness'), `${(completeness * 100).toFixed(1)}%`],
    [msg('numeric'), String(numericProfiles.length)],
  ]
  const kpiHtml = kpis
    .map(([label, value, accent]) => `<div class="kpi${accent ? ' kpi-accent' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('')

  const profileRows = profiles.map((profile) => {
    const stats = profile.type === 'number' && profile.mean !== undefined
      ? `μ ${formatNumber(profile.mean)} · σ ${formatNumber(profile.std ?? 0)} · [${formatNumber(profile.min ?? 0)}, ${formatNumber(profile.max ?? 0)}]`
      : profile.type === 'text' || profile.type === 'boolean'
        ? `${msg('topValues')}: ${escapeHtml(profile.topValues[0]?.value ?? '—')}`
        : '—'
    return `<tr><td><b>${escapeHtml(profile.name)}</b></td><td><span class="dtype dtype-${profile.type}">${profile.type}</span></td><td>${formatNumber(profile.count)}</td><td>${profile.missing ? `${profile.missing} (${(profile.missingRatio * 100).toFixed(1)}%)` : '—'}</td><td>${profile.unique}</td><td>${stats}</td></tr>`
  }).join('')

  const pairsHtml = pairs.length
    ? pairs.map((pair) => `<li><b>${escapeHtml(pair.x)}</b> × <b>${escapeHtml(pair.y)}</b><span class="corr ${pair.value >= 0 ? 'pos' : 'neg'}">${pair.value >= 0 ? '+' : ''}${pair.value.toFixed(3)}</span></li>`).join('')
    : `<li class="muted">${escapeHtml(msg('reportCorrNeedsNumeric'))}</li>`

  const outlierHtml = outlierRows.length
    ? `<table><thead><tr><th>${escapeHtml(msg('column'))}</th><th>${escapeHtml(msg('reportBounds'))}</th><th>${escapeHtml(msg('anomalyPoints'))}</th><th>${escapeHtml(msg('reportOutlierRate'))}</th></tr></thead><tbody>${outlierRows.map((entry) => `<tr><td><b>${escapeHtml(entry.name)}</b></td><td>[${formatNumber(entry.low)}, ${formatNumber(entry.high)}]</td><td>${entry.count}</td><td>${entry.present ? `${((entry.count / entry.present) * 100).toFixed(2)}%` : '—'}</td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${escapeHtml(msg('reportNoOutliers'))}</p>`

  const code = escapeHtml(buildPandasScript(sourceName, steps, language))

  const generatedAt = new Date().toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
  const section = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DataCanvas · ${escapeHtml(sourceName)} · ${escapeHtml(msg('reportTitle'))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif; color: ${INK}; background: #f4f7fc; line-height: 1.6; }
  .page { max-width: 1080px; margin: 0 auto; padding: 28px 32px 48px; }
  header.hero { background: linear-gradient(120deg, #0d1f45, #155eef 78%, #4f8fff); color: #fff; border-radius: 18px; padding: 30px 34px; margin-bottom: 24px; }
  header.hero h1 { font-size: 24px; letter-spacing: .2px; }
  header.hero .sub { opacity: .82; font-size: 13px; margin-top: 6px; }
  header.hero .meta { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 14px; font-size: 12.5px; opacity: .92; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { background: #fff; border: 1px solid ${LINE}; border-radius: 14px; padding: 14px 16px; }
  .kpi span { font-size: 11.5px; color: ${MUTED}; text-transform: uppercase; letter-spacing: .5px; }
  .kpi strong { display: block; font-size: 24px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .kpi-accent strong { color: ${ACCENT}; }
  section { background: #fff; border: 1px solid ${LINE}; border-radius: 16px; padding: 22px 24px; margin-bottom: 20px; }
  h2 { font-size: 16px; margin-bottom: 14px; padding-left: 10px; border-left: 3px solid ${ACCENT}; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; color: ${MUTED}; font-weight: 600; padding: 8px 10px; border-bottom: 1.5px solid ${LINE}; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #eef2f8; font-variant-numeric: tabular-nums; }
  tr:hover td { background: #f7faff; }
  .dtype { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-family: 'JetBrains Mono', Consolas, monospace; }
  .dtype-number { background: #e7efff; color: #155eef; }
  .dtype-text { background: #f0f2f7; color: #5b6b84; }
  .dtype-date { background: #e6f7ef; color: #0f8a4d; }
  .dtype-boolean { background: #fdf1e2; color: #b96a00; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
  figure.chart { border: 1px solid #eef2f8; border-radius: 12px; padding: 10px 10px 6px; margin: 0; }
  figure.chart img { width: 100%; display: block; }
  figcaption { font-size: 11.5px; color: ${MUTED}; text-align: center; padding: 4px 0 4px; }
  .pairs { list-style: none; padding: 0; display: grid; gap: 8px; }
  .pairs li { display: flex; justify-content: space-between; align-items: center; background: #f8fafd; border: 1px solid #eef2f8; border-radius: 10px; padding: 8px 14px; font-size: 13px; }
  .corr { font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 700; }
  .corr.pos { color: #155eef; }
  .corr.neg { color: #e5484d; }
  pre.code { background: #0d1f45; color: #d7e4ff; border-radius: 12px; padding: 16px 18px; font-size: 12px; line-height: 1.65; overflow: auto; font-family: 'JetBrains Mono', Consolas, monospace; }
  .muted { color: ${MUTED}; }
  footer { text-align: center; font-size: 12px; color: ${MUTED}; margin-top: 8px; }
  @media print { body { background: #fff; } section, header.hero { break-inside: avoid; } }
</style>
</head>
<body>
<div class="page">
  <header class="hero">
    <h1>DataCanvas · ${escapeHtml(msg('reportTitle'))}</h1>
    <div class="sub">${escapeHtml(msg('reportSubtitle'))}</div>
    <div class="meta">
      <span>📦 ${escapeHtml(sourceName)}</span>
      <span>${escapeHtml(msg('rows'))} ${formatNumber(rows.length)} · ${escapeHtml(msg('columns'))} ${columns.length}</span>
      <span>${escapeHtml(msg('reportGeneratedOn'))} ${escapeHtml(generatedAt)}</span>
    </div>
  </header>

  <div class="kpis">${kpiHtml}</div>

  ${section(msg('dataQuality'), `<table><thead><tr><th>${escapeHtml(msg('column'))}</th><th>${escapeHtml(msg('dtype'))}</th><th>${escapeHtml(msg('rows'))}</th><th>${escapeHtml(msg('missing'))}</th><th>${escapeHtml(msg('unique'))}</th><th>${escapeHtml(msg('distribution'))}</th></tr></thead><tbody>${profileRows}</tbody></table>`)}

  ${chartImgs.length ? section(msg('reportDistOverview'), `<div class="charts">${chartImgs.join('')}</div>`) : ''}

  ${section(msg('reportCorrelations'), `${heatImg}<ul class="pairs">${pairsHtml}</ul>`)}

  ${section(msg('reportOutliers'), outlierHtml)}

  ${section(msg('reportPandasCode'), `<pre class="code"><code>${code}</code></pre>`)}

  <footer>Generated by DataCanvas — visual pandas workspace · ${escapeHtml(generatedAt)}</footer>
</div>
</body>
</html>`
}
