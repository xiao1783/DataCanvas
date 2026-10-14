import ReactEChartsCore from 'echarts-for-react/esm/core'
import type { EChartsReactProps } from 'echarts-for-react/lib/types'
import * as echarts from 'echarts/core'
import type { ECharts } from 'echarts/core'
import {
  BarChart, BoxplotChart, FunnelChart, GaugeChart, HeatmapChart, LineChart,
  ParallelChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart,
} from 'echarts/charts'
import {
  BrushComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent,
  MarkPointComponent, ParallelComponent, TimelineComponent, TitleComponent,
  ToolboxComponent, TooltipComponent, VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart, BoxplotChart, FunnelChart, GaugeChart, HeatmapChart, LineChart,
  ParallelChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart,
  BrushComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent,
  MarkPointComponent, ParallelComponent, TimelineComponent, TitleComponent,
  ToolboxComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer,
])

export type EChartsInstance = ECharts

export function EChart({ className, ...props }: Omit<EChartsReactProps, 'echarts'>) {
  return <ReactEChartsCore echarts={echarts} className={`echart-host ${className ?? ''}`} {...props} />
}
