# 悬停数值与缺失值

遇到 NaN，先比较解码后的源单元格与实际提示框。源数据缺失与模板取值失败应分别记录；不能从 NaN 推断业务上未披露，也不能补成 0。

## 当前处理

`fitFigure` 在解码后、年份筛选前调用 `normalizeHoverTemplates(trace, warnings)`，只生成 hovertemplate 显示副本。保留原始 customdata、values、坐标及模板；每次 resize/数据更新从完整源数据重新适配，避免永久固化 `--`。

- 支持 pie、bar、scatter/scattergl、scatterpolar/scatterpolargl 的单字段 customdata 引用及逐点 hovertemplate 数组。
- null/undefined、NaN/Infinity、空字符串，以及不能用于数值格式的文本，按单元格显示 `--`；有效 0、负数、数值字符串、原有正号/精度/单位及 `<extra>` 保留。
- 仅处理支持的模板字段，不替换任意业务文本里的 “NaN”。二维热力图、层级图、复杂表达式及已有多层索引保留源行为，需另行验证其事件结构。

## Plotly 4.1.1 饼图

原始 metadata 每点为 `[19.85, NaN, NaN]`。饼图按 label 聚合后，唯一 label 的提示取值多一层：`%{customdata[0]:.2f}` 会尝试把整行格式化成数字，产生 NaN。

唯一 label 的显示副本改用 `%{customdata[0][0]:.2f}`；缺失的列 1/2 显示 `--`。业务收入保留真实数字，不能把所有字段都改为占位符。

重复 label 会合并多个原始点，任意 metadata 没有默认业务聚合口径。对应字段显示 `--` 并返回 warning；不取首行或自行求和。需要聚合值时由业务明确计算口径后接入。

## mock16_point 验收

6 项业务收入为 19.85、14.05、13.50、11.46、9.28、6.86 亿元，均有效；毛利率和利润占比的源值都是 NaN。2026-10-20 在 360/420/480/520px 实际悬停全部切片，确认收入与源单元格一致、缺失字段为 `--`；480px 柱图四个点的同比正负号也保留。

规则检查另覆盖无效值、0/负值、逐点模板、重复 label、数据更新及双向宽度适配。证据在 `reports/hover-values-2026-10-20/`；全量静态渲染在 `reports/responsive-2026-10-20-hover/`。这不验证 fixture 的业务真实性，也不代表已支持所有 trace 类型的缺失值显示。
