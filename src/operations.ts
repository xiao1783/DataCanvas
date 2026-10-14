import type {
  DataRow, DataFrame, Op, PipelineStep,
} from './types'
import {
  applyFilter, castColumn, clipColumn, conditionToCode, correlationMatrix, crossTab, cumulative,
  describeColumn, detectOutliers, dropDuplicates, dropna, evaluateFormula, fillna, groupByAggregate, joinFrames,
  meltRows, pctChange, pivotTable, qcut, rankColumn, rolling, sampleRows, shiftColumn, sortRows,
  transposeRows,
} from './analysis'
import { formatCell, inferColumnTypes, isMissing, parseDate, toNumber, uid } from './utils'

/* ------------------------------------------------------------------ *
 * Describing an operation: bilingual label + the equivalent pandas code
 * ------------------------------------------------------------------ */

const aggregationCode: Record<string, string> = {
  sum: 'sum', mean: 'mean', median: 'median', min: 'min', max: 'max', count: 'count',
  nunique: 'nunique', std: 'std', var: 'var', first: 'first', last: 'last', range: 'range',
}

const quote = (text: string): string => `"${text.replace(/"/g, '\\"')}"`

const codeList = (items: string[]): string => `[${items.map(quote).join(', ')}]`

export interface OpDescriptor {
  labelZh: string
  labelEn: string
  code: string
}

export const describeOp = (op: Op): OpDescriptor => {
  switch (op.kind) {
    case 'filter': {
      const conditions = op.conditions.map(conditionToCode)
      return {
        labelZh: `筛选 ${op.conditions.length} 个条件（${op.conjunction === 'and' ? '且' : '或'}）`,
        labelEn: `Filter on ${op.conditions.length} condition(s) (${op.conjunction.toUpperCase()})`,
        code: `df = df[${conditions.length > 1
          ? `\n    ${conditions.join(op.conjunction === 'and' ? '\n    & ' : '\n    | ')}`
          : conditions.join('')}]`,
      }
    }

    case 'sort': {
      const by = codeList(op.keys.map((key) => key.column))
      const asc = `[${op.keys.map((key) => (key.direction === 'asc' ? 'True' : 'False')).join(', ')}]`
      return {
        labelZh: `按 ${op.keys.map((key) => key.column).join('、')} 排序`,
        labelEn: `Sort by ${op.keys.map((key) => key.column).join(', ')}`,
        code: `df = df.sort_values(by=${by}, ascending=${asc})`,
      }
    }

    case 'selectColumns':
      return {
        labelZh: `保留 ${op.columns.length} 个字段`,
        labelEn: `Keep ${op.columns.length} column(s)`,
        code: `df = df[${codeList(op.columns)}]`,
      }

    case 'dropColumns':
      return {
        labelZh: `删除字段 ${op.columns.join('、')}`,
        labelEn: `Drop column(s) ${op.columns.join(', ')}`,
        code: `df = df.drop(columns=${codeList(op.columns)})`,
      }

    case 'renameColumn':
      return {
        labelZh: `字段 ${op.from} 重命名为 ${op.to}`,
        labelEn: `Rename ${op.from} to ${op.to}`,
        code: `df = df.rename(columns={${quote(op.from)}: ${quote(op.to)}})`,
      }

    case 'castColumn':
      return {
        labelZh: `${op.column} 转换为 ${op.to}`,
        labelEn: `Cast ${op.column} to ${op.to}`,
        code: op.to === 'date'
          ? `df[${quote(op.column)}] = pd.to_datetime(df[${quote(op.column)}])`
          : `df[${quote(op.column)}] = df[${quote(op.column)}].astype(${op.to === 'number' ? '"float64"' : op.to === 'boolean' ? '"bool"' : '"string"'})`,
      }

    case 'dropna':
      return {
        labelZh: `删除缺失值（${op.how === 'any' ? '任一为空' : '全部为空'}）`,
        labelEn: `Drop missing rows (${op.how})`,
        code: `df = df.dropna(${op.columns.length ? `subset=${codeList(op.columns)}, ` : ''}how=${quote(op.how)})`,
      }

    case 'fillna': {
      const strategyCode: Record<string, string> = {
        mean: `df[${quote(op.column)}].mean()`,
        median: `df[${quote(op.column)}].median()`,
        mode: `df[${quote(op.column)}].mode()[0]`,
        zero: '0',
        constant: JSON.stringify(op.value),
        ffill: '', bfill: '', interpolate: '',
      }
      if (op.strategy === 'ffill' || op.strategy === 'bfill') {
        return {
          labelZh: `${op.strategy === 'ffill' ? '前向' : '后向'}填充 ${op.column}`,
          labelEn: `${op.strategy} fill on ${op.column}`,
          code: `df[${quote(op.column)}] = df[${quote(op.column)}].${op.strategy}()`,
        }
      }
      if (op.strategy === 'interpolate') {
        return {
          labelZh: `线性插值填充 ${op.column}`,
          labelEn: `Interpolate ${op.column}`,
          code: `df[${quote(op.column)}] = df[${quote(op.column)}].interpolate()`,
        }
      }
      return {
        labelZh: `用${op.strategy === 'mean' ? '均值' : op.strategy === 'median' ? '中位数' : op.strategy === 'mode' ? '众数' : op.strategy === 'zero' ? '零' : '固定值'}填充 ${op.column}`,
        labelEn: `Fill ${op.column} with ${op.strategy}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].fillna(${strategyCode[op.strategy]})`,
      }
    }

    case 'dropDuplicates':
      return {
        labelZh: `删除重复行${op.subset.length ? `（依据 ${op.subset.join('、')}）` : ''}`,
        labelEn: `Drop duplicates${op.subset.length ? ` on ${op.subset.join(', ')}` : ''}`,
        code: `df = df.drop_duplicates(${op.subset.length ? `subset=${codeList(op.subset)}` : ''})`,
      }

    case 'groupby': {
      const aggCode = op.aggs.length
        ? `{${op.aggs.map((agg) => `${quote(agg.column)}: ${quote(aggregationCode[agg.aggregation])}`).join(', ')}}`
        : '"size"'
      return {
        labelZh: `按 ${op.keys.join('、')} 分组聚合`,
        labelEn: `Group by ${op.keys.join(', ')}`,
        code: `df = df.groupby(${codeList(op.keys)}).agg(${aggCode}).reset_index()`,
      }
    }

    case 'pivot':
      return {
        labelZh: `透视：行 ${op.index}，列 ${op.columns}，值 ${op.values}`,
        labelEn: `Pivot: index ${op.index}, columns ${op.columns}, values ${op.values}`,
        code: `df = df.pivot_table(index=${quote(op.index)}, columns=${quote(op.columns)}, values=${quote(op.values)}, aggfunc=${quote(aggregationCode[op.aggregation])}).reset_index()`,
      }

    case 'crosstab':
      return {
        labelZh: `交叉表 ${op.row} × ${op.col}`,
        labelEn: `Crosstab ${op.row} × ${op.col}`,
        code: `df = pd.crosstab(df[${quote(op.row)}], df[${quote(op.col)}]${op.normalize === 'none' ? '' : `, normalize=${quote(op.normalize)}`}).reset_index()`,
      }

    case 'join':
      return {
        labelZh: `${op.spec.how} 连接 ${op.spec.rightName}`,
        labelEn: `${op.spec.how} join with ${op.spec.rightName}`,
        code: `df = df.merge(${op.spec.rightName}, how=${quote(op.spec.how)}, left_on=${quote(op.spec.leftOn)}, right_on=${quote(op.spec.rightOn)}, suffixes=("", ${quote(op.spec.suffix)}))`,
      }

    case 'concat':
      return {
        labelZh: `纵向合并 ${op.sourceName}`,
        labelEn: `Concatenate ${op.sourceName}`,
        code: `df = pd.concat([df, ${op.sourceName}], ignore_index=True)`,
      }

    case 'assign':
      return {
        labelZh: `计算字段 ${op.name}`,
        labelEn: `Assign column ${op.name}`,
        code: `df[${quote(op.name)}] = df.eval(${quote(op.formula)})`,
      }

    case 'valueCounts':
      return {
        labelZh: `统计 ${op.column} 的取值频数`,
        labelEn: `Value counts of ${op.column}`,
        code: `df = df[${quote(op.column)}].value_counts(dropna=False).rename_axis(${quote(op.column)}).reset_index(name="count")`,
      }

    case 'cumulative':
      return {
        labelZh: `对 ${op.column} 计算 ${op.method}`,
        labelEn: `${op.method} of ${op.column}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].${op.method}()`,
      }

    case 'pctChange':
      return {
        labelZh: `计算 ${op.column} 变化率（${op.periods} 期）`,
        labelEn: `Percent change of ${op.column} (${op.periods} periods)`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].pct_change(${op.periods})`,
      }

    case 'shift':
      return {
        labelZh: `将 ${op.column} 平移 ${op.periods} 行`,
        labelEn: `Shift ${op.column} by ${op.periods}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].shift(${op.periods})`,
      }

    case 'rank':
      return {
        labelZh: `计算 ${op.column} 的排名`,
        labelEn: `Rank ${op.column}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].rank(method=${quote(op.method)}, ascending=${op.ascending ? 'True' : 'False'})`,
      }

    case 'rolling':
      return {
        labelZh: `计算 ${op.column} 的 ${op.window} 期滚动${op.aggregation}`,
        labelEn: `Rolling ${op.aggregation} of ${op.column} (window ${op.window})`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].rolling(${op.window}).${op.aggregation}()`,
      }

    case 'clip':
      return {
        labelZh: `将 ${op.column} 截断到 [${op.lower || '-∞'}, ${op.upper || '+∞'}]`,
        labelEn: `Clip ${op.column} to [${op.lower || '-inf'}, ${op.upper || '+inf'}]`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].clip(${op.lower || 'None'}, ${op.upper || 'None'})`,
      }
    case 'outliers': {
      const variable = `s = df[${quote(op.column)}]`
      const bounds = op.method === 'iqr'
        ? `q1, q3 = s.quantile([0.25, 0.75])\niqr = q3 - q1\nlow, high = q1 - ${op.threshold} * iqr, q3 + ${op.threshold} * iqr`
        : `mean, std = s.mean(), s.std()\nlow, high = mean - ${op.threshold} * std, mean + ${op.threshold} * std`
      const apply = op.action === 'drop'
        ? `df = df[s.between(low, high) | s.isna()]`
        : op.action === 'clip'
          ? `df[${quote(op.column)}] = s.clip(low, high)`
          : `df.loc[~s.between(low, high), ${quote(op.column)}] = s.median()`
      return {
        labelZh: `${op.method === 'iqr' ? 'IQR' : 'Z-score'} 异常值：${op.action === 'drop' ? '删除' : op.action === 'clip' ? '截断' : '中位数替换'} ${op.column}`,
        labelEn: `${op.method === 'iqr' ? 'IQR' : 'Z-score'} outliers: ${op.action} ${op.column}`,
        code: `${variable}\n${bounds}\n${apply}`,
      }
    }

    case 'qcut':
      return {
        labelZh: `将 ${op.column} 等频分箱为 ${op.bins} 组`,
        labelEn: `qcut ${op.column} into ${op.bins} bins`,
        code: `df[${quote(`${op.column}_bins`)}] = pd.qcut(df[${quote(op.column)}], ${op.bins}, labels=${codeList(op.labels.split(',').map((item) => item.trim()).filter(Boolean))})`,
      }

    case 'textOp': {
      const expression = op.operation === 'length'
        ? '.str.len()'
        : op.operation === 'substring' ? `.str.slice(${op.start}, ${op.end})` : `.str.${op.operation}()`
      return {
        labelZh: `文本处理 ${op.operation}（${op.column}）`,
        labelEn: `Text ${op.operation} on ${op.column}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].astype("string")${expression}`,
      }
    }

    case 'textReplace':
      return {
        labelZh: `替换 ${op.column} 中的 "${op.find}"`,
        labelEn: `Replace "${op.find}" in ${op.column}`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].str.replace(${quote(op.find)}, ${quote(op.replace)}, regex=${op.regex ? 'True' : 'False'})`,
      }

    case 'textContains':
      return {
        labelZh: `标记 ${op.column} 是否匹配 "${op.pattern}"`,
        labelEn: `Flag whether ${op.column} matches "${op.pattern}"`,
        code: `df[${quote(op.newColumn)}] = df[${quote(op.column)}].str.contains(${quote(op.pattern)}, case=False, na=False)`,
      }

    case 'textSplit':
      return {
        labelZh: `按 "${op.separator}" 拆分 ${op.column}`,
        labelEn: `Split ${op.column} by "${op.separator}"`,
        code: `df[${quote(op.column)}] = df[${quote(op.column)}].str.split(${quote(op.separator)}).str[${op.part}]`,
      }

    case 'concatColumns':
      return {
        labelZh: `拼接字段生成 ${op.newColumn}`,
        labelEn: `Concatenate columns into ${op.newColumn}`,
        code: `df[${quote(op.newColumn)}] = df[${codeList(op.columns)}].astype(str).agg(${quote(op.separator)}.join, axis=1)`,
      }

    case 'datePart':
      return {
        labelZh: `提取 ${op.column} 的${op.part}`,
        labelEn: `Extract ${op.part} from ${op.column}`,
        code: `df[${quote(op.newColumn)}] = pd.to_datetime(df[${quote(op.column)}]).dt.${op.part === 'ym' ? 'strftime("%Y-%m")' : op.part}`,
      }

    case 'dateDiff':
      return {
        labelZh: `计算 ${op.column} 与 ${op.other} 的间隔（${op.unit}）`,
        labelEn: `Date difference ${op.column} minus ${op.other} (${op.unit})`,
        code: `df[${quote(op.newColumn)}] = (pd.to_datetime(df[${quote(op.column)}]) - pd.to_datetime(df[${quote(op.other)}])).dt.days${op.unit === 'weeks' ? ' / 7' : op.unit === 'months' ? ' / 30.44' : ''}`,
      }

    case 'sample':
      return {
        labelZh: `随机抽样 ${op.size} 行`,
        labelEn: `Sample ${op.size} row(s)`,
        code: `df = df.sample(n=min(${op.size}, len(df))${op.withReplacement ? ', replace=True' : ''}, random_state=42)`,
      }

    case 'keepRows':
      return {
        labelZh: op.reason,
        labelEn: op.reason,
        code: `# ${op.reason} — kept ${op.rows.length} row(s) selected from the chart\n# pandas: df = df.loc[selected_index]  # selected_index is a boolean mask`,
      }

    case 'head':
      return {
        labelZh: `取前 ${op.n} 行`,
        labelEn: `Keep the first ${op.n} rows`,
        code: `df = df.head(${op.n})`,
      }

    case 'transpose':
      return {
        labelZh: '转置数据表',
        labelEn: 'Transpose the frame',
        code: 'df = df.T',
      }

    case 'melt':
      return {
        labelZh: '宽表转长表（melt）',
        labelEn: 'Melt wide to long',
        code: `df = df.melt(id_vars=${codeList(op.idVars)}, value_vars=${codeList(op.valueVars)}, var_name=${quote(op.varName)}, value_name=${quote(op.valueName)})`,
      }

    case 'resetIndex':
      return {
        labelZh: '重置索引',
        labelEn: 'Reset the index',
        code: 'df = df.reset_index(drop=True)',
      }

    case 'describe':
      return {
        labelZh: '生成描述性统计表',
        labelEn: 'Describe numeric columns',
        code: 'df = df.describe().T.reset_index().rename(columns={"index": "column"})',
      }

    case 'corr':
      return {
        labelZh: '生成相关系数矩阵',
        labelEn: 'Correlation matrix',
        code: 'df = df.corr(numeric_only=True).round(4).reset_index().rename(columns={"index": "column"})',
      }

    case 'dropConstant':
      return {
        labelZh: '删除常量字段',
        labelEn: 'Drop constant columns',
        code: 'df = df.loc[:, df.nunique(dropna=False) > 1]',
      }

    default:
      return { labelZh: '未知操作', labelEn: 'Unknown operation', code: '# unknown operation' }
  }
}

/* ------------------------------------------------------------------ *
 * Applying an operation
 * ------------------------------------------------------------------ */

const withColumns = (
  rows: DataRow[],
  preferred: string[],
  baseTypes?: DataFrame['types'],
): DataFrame => {
  const present = new Set<string>()
  const columns: string[] = []
  preferred.forEach((column) => {
    if (!present.has(column)) {
      present.add(column)
      columns.push(column)
    }
  })
  rows.slice(0, 50).forEach((row) => {
    Object.keys(row).forEach((column) => {
      if (!present.has(column)) {
        present.add(column)
        columns.push(column)
      }
    })
  })
  // Columns whose content is carried over from the previous frame keep their
  // already-known type; only genuinely new columns pay for type inference.
  const types: DataFrame['types'] = {}
  const fresh: string[] = []
  columns.forEach((column) => {
    if (baseTypes && column in baseTypes) types[column] = baseTypes[column]
    else fresh.push(column)
  })
  if (fresh.length) Object.assign(types, inferColumnTypes(rows, fresh))
  return { rows, columns, types }
}

const addDerivedColumn = (
  rows: DataRow[],
  name: string,
  compute: (row: DataRow) => DataRow[string],
): DataRow[] =>
  rows.map((row) => {
    const value = compute(row)
    if (value === row[name]) return row
    return { ...row, [name]: value }
  })

const numericColumnsOf = (frame: DataFrame): string[] =>
  frame.columns.filter((column) => frame.types[column] === 'number')

export const applyOp = (frame: DataFrame, op: Op): DataFrame => {
  const { rows, columns } = frame
  switch (op.kind) {
    case 'filter':
      return withColumns(applyFilter(rows, op.conditions, op.conjunction), columns, frame.types)

    case 'sort':
      return withColumns(sortRows(rows, op.keys), columns, frame.types)

    case 'selectColumns':
      return withColumns(
        rows.map((row) => Object.fromEntries(op.columns.map((column) => [column, row[column] ?? null])) as DataRow),
        op.columns,
        frame.types,
      )

    case 'dropColumns':
      return withColumns(
        rows.map((row) => {
          const next: DataRow = { ...row }
          op.columns.forEach((column) => delete next[column])
          return next
        }),
        columns.filter((column) => !op.columns.includes(column)),
        frame.types,
      )

    case 'renameColumn': {
      if (op.from === op.to) return frame
      const nextColumns = columns.map((column) => (column === op.from ? op.to : column))
      const nextRows = rows.map((row) => {
        const next: DataRow = {}
        columns.forEach((column) => {
          next[column === op.from ? op.to : column] = row[column] ?? null
        })
        return next
      })
      const nextTypes = { ...frame.types }
      if (op.from in nextTypes) {
        nextTypes[op.to] = nextTypes[op.from]
        delete nextTypes[op.from]
      }
      return withColumns(nextRows, nextColumns, nextTypes)
    }

    case 'castColumn':
      return withColumns(castColumn(rows, op.column, op.to), columns, {
        ...frame.types,
        [op.column]: op.to,
      })

    case 'dropna':
      return withColumns(dropna(rows, op.columns, op.how), columns, frame.types)

    case 'fillna':
      return withColumns(fillna(rows, op.column, op.strategy, op.value), columns, frame.types)

    case 'dropDuplicates':
      return withColumns(dropDuplicates(rows, op.subset), columns, frame.types)

    case 'groupby': {
      if (!op.keys.length) return frame
      const result = groupByAggregate(rows, op.keys, op.aggs)
      return withColumns(result.rows, result.columns, frame.types)
    }

    case 'pivot': {
      if (!op.index || !op.columns || !op.values) return frame
      const result = pivotTable(rows, op.index, op.columns, op.values, op.aggregation)
      return withColumns(result.rows, result.columns)
    }

    case 'crosstab': {
      if (!op.row || !op.col) return frame
      const result = crossTab(rows, op.row, op.col, op.normalize)
      return withColumns(result.rowTotals, result.columns)
    }

    case 'join': {
      const merged = joinFrames(rows, op.spec.rightRows, op.spec.leftOn, op.spec.rightOn, op.spec.how, op.spec.suffix)
      const rightColumns = op.spec.rightRows.length ? Object.keys(op.spec.rightRows[0]) : []
      const preferred = [
        ...columns,
        ...rightColumns.map((column) =>
          columns.includes(column) && column !== op.spec.rightOn ? `${column}${op.spec.suffix}` : column),
      ]
      return withColumns(merged, Array.from(new Set(preferred)), frame.types)
    }

    case 'concat': {
      // Align both frames on the union of their columns, exactly like pd.concat.
      const rightColumns = op.rows.length ? Object.keys(op.rows[0]) : []
      const all = Array.from(new Set([...columns, ...rightColumns]))
      const align = (source: DataRow[]): DataRow[] =>
        source.map((row) => Object.fromEntries(all.map((column) => [column, row[column] ?? null])) as DataRow)
      return withColumns([...align(rows), ...align(op.rows)], all, frame.types)
    }

    case 'assign':
      return withColumns(
        addDerivedColumn(rows, op.name, (row) => evaluateFormula(op.formula, row, columns)),
        [...columns.filter((column) => column !== op.name), op.name],
        // Overwriting an existing column can change its type, so re-infer then.
        columns.includes(op.name) ? undefined : frame.types,
      )

    case 'valueCounts': {
      const counts = new Map<string, number>()
      rows.forEach((row) => {
        const key = formatCell(row[op.column]) || '(NaN)'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      })
      const nextRows = Array.from(counts, ([value, count]) => ({ [op.column]: value, count }))
        .sort((a, b) => b.count - a.count)
      return withColumns(nextRows, [op.column, 'count'])
    }

    case 'cumulative':
      return withColumns(cumulative(rows, op.column, op.method), columns, frame.types)

    case 'pctChange':
      return withColumns(pctChange(rows, op.column, op.periods), columns, frame.types)

    case 'shift':
      return withColumns(shiftColumn(rows, op.column, op.periods), columns, frame.types)

    case 'rank':
      return withColumns(rankColumn(rows, op.column, op.method, op.ascending), columns, frame.types)

    case 'rolling':
      return withColumns(rolling(rows, op.column, op.window, op.aggregation), columns, frame.types)

    case 'clip':
      return withColumns(clipColumn(rows, op.column, op.lower, op.upper), columns, frame.types)
    case 'outliers': {
      const detected = detectOutliers(rows, op.column, op.method, op.threshold)
      const flagged = new Set(detected.indexes)
      if (op.action === 'drop') return withColumns(rows.filter((_, index) => !flagged.has(index)), columns, frame.types)
      return withColumns(rows.map((row, index) => {
        if (!flagged.has(index)) return row
        const value = toNumber(row[op.column])
        if (value === null) return row
        return {
          ...row,
          [op.column]: op.action === 'median'
            ? detected.center
            : Math.min(detected.high, Math.max(detected.low, value)),
        }
      }), columns, frame.types)
    }

    case 'qcut':
      return withColumns(qcut(rows, op.column, op.bins, op.labels), [...columns, `${op.column}_bins`], frame.types)

    case 'textOp':
      return withColumns(
        addDerivedColumn(rows, op.column, (row) => {
          const value = row[op.column]
          if (isMissing(value)) return null
          const text = String(value)
          if (op.operation === 'upper') return text.toUpperCase()
          if (op.operation === 'lower') return text.toLowerCase()
          if (op.operation === 'title') {
            return text.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
          }
          if (op.operation === 'trim') return text.replace(/\s+/g, ' ').trim()
          if (op.operation === 'strip') return text.trim()
          if (op.operation === 'length') return text.length
          return text.slice(op.start, op.end)
        }),
        columns,
      )

    case 'textReplace':
      return withColumns(
        addDerivedColumn(rows, op.column, (row) => {
          const value = row[op.column]
          if (isMissing(value)) return null
          const text = String(value)
          if (!op.find) return text
          if (op.regex) {
            try {
              return text.replace(new RegExp(op.find, 'g'), op.replace)
            } catch {
              return text
            }
          }
          return text.split(op.find).join(op.replace)
        }),
        columns,
      )

    case 'textContains':
      return withColumns(
        addDerivedColumn(rows, op.newColumn, (row) => {
          const value = row[op.column]
          if (isMissing(value)) return null
          return String(value).toLowerCase().includes(op.pattern.toLowerCase())
        }),
        [...columns, op.newColumn],
        frame.types,
      )

    case 'textSplit':
      return withColumns(
        addDerivedColumn(rows, op.column, (row) => {
          const value = row[op.column]
          if (isMissing(value)) return null
          const parts = String(value).split(op.separator)
          return parts[op.part] ?? null
        }),
        columns,
      )

    case 'concatColumns':
      return withColumns(
        addDerivedColumn(rows, op.newColumn, (row) =>
          op.columns.map((column) => formatCell(row[column])).join(op.separator)),
        [...columns, op.newColumn],
        frame.types,
      )

    case 'datePart':
      return withColumns(
        addDerivedColumn(rows, op.newColumn, (row) => {
          const date = parseDate(row[op.column])
          if (!date) return null
          if (op.part === 'year') return date.getUTCFullYear()
          if (op.part === 'month') return date.getUTCMonth() + 1
          if (op.part === 'day') return date.getUTCDate()
          if (op.part === 'quarter') return Math.floor(date.getUTCMonth() / 3) + 1
          if (op.part === 'weekday') return date.getUTCDay()
          if (op.part === 'week') {
            const start = Date.UTC(date.getUTCFullYear(), 0, 1)
            return Math.floor((date.getTime() - start) / 604800000) + 1
          }
          return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        }),
        [...columns, op.newColumn],
        frame.types,
      )

    case 'dateDiff':
      return withColumns(
        addDerivedColumn(rows, op.newColumn, (row) => {
          const left = parseDate(row[op.column])
          const right = parseDate(row[op.other])
          if (!left || !right) return null
          const days = (left.getTime() - right.getTime()) / 86400000
          if (op.unit === 'weeks') return Number((days / 7).toFixed(2))
          if (op.unit === 'months') return Number((days / 30.44).toFixed(2))
          return Number(days.toFixed(2))
        }),
        [...columns, op.newColumn],
        frame.types,
      )

    case 'sample':
      return withColumns(sampleRows(rows, op.size, op.withReplacement), columns, frame.types)

    case 'keepRows':
      return withColumns(op.rows, columns, frame.types)

    case 'head':
      return withColumns(rows.slice(0, Math.max(0, op.n)), columns, frame.types)

    case 'transpose': {
      const result = transposeRows(rows, columns)
      return withColumns(result.rows, result.columns)
    }

    case 'melt':
      if (!op.valueVars.length) return frame
      return withColumns(
        meltRows(rows, op.idVars, op.valueVars, op.varName, op.valueName),
        [...op.idVars, op.varName, op.valueName],
      )

    case 'resetIndex':
      return withColumns(rows.map((row) => ({ ...row })), columns, frame.types)

    case 'describe': {
      const numeric = numericColumnsOf(frame)
      const fields: Array<[keyof ReturnType<typeof describeColumn>, string]> = [
        ['count', 'count'], ['mean', 'mean'], ['std', 'std'], ['min', 'min'],
        ['q1', '25%'], ['median', '50%'], ['q3', '75%'], ['max', 'max'],
      ]
      const nextRows = numeric.map((column) => {
        const profile = describeColumn(rows, column)
        const record: DataRow = { column }
        fields.forEach(([key, label]) => {
          record[label] = profile[key] as DataRow[string]
        })
        return record
      })
      return withColumns(nextRows, ['column', ...fields.map(([, label]) => label)], frame.types)
    }

    case 'corr': {
      const numeric = numericColumnsOf(frame)
      const matrix = correlationMatrix(rows, numeric)
      const nextRows = numeric.map((column, index) => {
        const record: DataRow = { column }
        numeric.forEach((other, otherIndex) => {
          record[other] = matrix.matrix[index][otherIndex]
        })
        return record
      })
      return withColumns(nextRows, ['column', ...numeric], frame.types)
    }

    case 'dropConstant': {
      const kept = columns.filter((column) => new Set(rows.map((row) => formatCell(row[column]))).size > 1)
      return withColumns(rows, kept, frame.types)
    }

    default:
      return frame
  }
}

/* ------------------------------------------------------------------ *
 * Pipeline execution
 * ------------------------------------------------------------------ */

export const buildFrame = (source: DataRow[]): DataFrame => {
  const columns = source.length ? Object.keys(source[0]) : []
  return { rows: source, columns, types: inferColumnTypes(source, columns) }
}

export interface PipelineError {
  stepId: string
  index: number
  message: string
}

export interface PipelineRun {
  /** Frame after the last successful step (the source frame if a step failed). */
  frame: DataFrame
  error?: PipelineError
}

export interface PipelineCache {
  source: DataRow[]
  steps: PipelineStep[]
  /**
   * frames[i] is the frame after applying steps[0..i); frames[0] is the source frame.
   * A failing step is not pushed, so the array is shorter than steps.length + 1
   * when execution stopped early.
   */
  frames: DataFrame[]
  run: PipelineRun
}

/**
 * Run the pipeline while reusing unchanged prefix frames from `previous`.
 * applyOp is pure, so every leading step whose object identity is unchanged
 * (toggling/reordering/removal create new identities only at the edit point)
 * necessarily produced the same frame and can be skipped. A throwing step is
 * captured instead of propagating, so one bad operation can never white-screen
 * the whole app: execution stops there and the last good frame is returned.
 */
export const runPipeline = (
  source: DataRow[],
  steps: PipelineStep[],
  previous?: PipelineCache | null,
): PipelineCache => {
  let start = 0
  if (previous && previous.source === source) {
    while (
      start < steps.length
      && start < previous.steps.length
      && steps[start] === previous.steps[start]
      && start + 1 < previous.frames.length
    ) {
      start += 1
    }
  } else {
    start = 0
  }

  const frames: DataFrame[] = []
  if (start === 0) {
    frames.push(buildFrame(source))
  } else {
    for (let i = 0; i <= start; i++) frames.push(previous!.frames[i])
  }

  let frame = frames[start]
  let error: PipelineError | undefined

  for (let i = start; i < steps.length; i++) {
    const step = steps[i]
    if (!step.enabled) {
      frames.push(frame)
      continue
    }
    try {
      frame = applyOp(frame, step.op)
      frames.push(frame)
    } catch (caught) {
      error = {
        stepId: step.id,
        index: i,
        message: caught instanceof Error ? caught.message : String(caught),
      }
      break
    }
  }

  return { source, steps, frames, run: { frame, error } }
}

export const makeStep = (
  op: Op,
  extra?: Partial<Pick<PipelineStep, 'labelZh' | 'labelEn' | 'code'>>,
): PipelineStep => {
  const descriptor = describeOp(op)
  return {
    id: uid('step'),
    op,
    labelZh: extra?.labelZh ?? descriptor.labelZh,
    labelEn: extra?.labelEn ?? descriptor.labelEn,
    code: extra?.code ?? descriptor.code,
    enabled: true,
    at: Date.now(),
  }
}

/* ------------------------------------------------------------------ *
 * pandas script export
 * ------------------------------------------------------------------ */

export const buildPandasScript = (
  fileName: string,
  steps: PipelineStep[],
  language: 'zh' | 'en',
): string => {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const loader = extension === 'xlsx' || extension === 'xls'
    ? `df = pd.read_excel("${fileName}")`
    : extension === 'json'
      ? `df = pd.read_json("${fileName}")`
      : `df = pd.read_csv("${fileName}")`
  const header = language === 'zh'
    ? ['# 由 DataCanvas 可视化 Pandas 工作台生成', '# 每一步都对应界面上的一次操作，可直接在 pandas 中运行']
    : ['# Generated by DataCanvas — a visual pandas workspace', '# Every step mirrors one UI operation and runs as-is in pandas']
  const body = steps
    .filter((step) => step.enabled)
    .map((step, index) => `# ${index + 1}. ${language === 'zh' ? step.labelZh : step.labelEn}\n${step.code}`)
  return [
    'import pandas as pd',
    'import numpy as np',
    '',
    loader,
    '',
    ...header,
    '',
    ...body,
    '',
    '# 导出结果 / export the result',
    'df.to_csv("datacanvas_result.csv", index=False, encoding="utf-8-sig")',
    '',
  ].join('\n')
}
