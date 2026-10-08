---
name: plotly-responsive
description: Adapt model-produced Plotly.js figures for narrow frontend containers, fix clipping and overlapping titles, legends, subplots or labels, and maintain regression fixtures at 360, 420 and 520px.
---

# Plotly 响应式解析与布局

为模型返回的标准 {data, layout, config} 增加前端适配层。以实际图表容器宽度计算布局，最低回归宽度为 **360、420、520px 视口**；卡片内的实际宽度通常更小。

[assets/plotly-responsive.js](assets/plotly-responsive.js) 是可复制接入的浏览器/CommonJS 运行时模板。首次接入其他前端时阅读 [references/integration.md](references/integration.md)，按目标项目的组件生命周期整合。维护本仓库时，入口是 index.html，回归数据在 mocks/，测试为 tests/responsive.test.js。

## 修复流程

1. 检查模型原文、运行中的 Plotly 版本、容器实际宽度、轨迹类型、坐标轴引用、domain、注释和控件。将失败输入保留为原始 fixture。
2. 在三个最低视口宽度及桌面宽度检查标题、图例、坐标轴、子图标题、数据标签和控件；再检查窄到宽、宽到窄、数据更新后的布局。文字测量应使用渲染结果的边界，不能把字符数估算当作视觉通过。
3. 在适配层修复一般原因。对源 figure 做独立副本，每次 resize 从源配置重新计算，保留数据值、轴引用、关联关系与交互状态。根据拥挤程度增加纵向空间或把并排子图改为纵向，避免仅缩小整个图表。
4. 为发现的问题增加能检查实际约束的回归：子图不相交、标题仍有对应子图、数值与引用保留、交互控件分区、源输入不变。本仓库运行 `node tests/responsive.test.js`，自动发现 `mocks/mock*.js`；其他项目使用其回归入口。浏览器允许访问时还要检查 SVG 文字和 resize 后的真实效果。
5. 将输入名、原因、修复和验证范围记录在 [references/fix-log.md](references/fix-log.md)。未做视觉验证或输入本身缺少交互语义时明确记录。

## 已验证的处理原则

- 使用容器宽度与 ResizeObserver。config.responsive 处理窗口 resize，不能替代容器变化时的重新适配。
- 使用固定的现代 Plotly 版本。plotly-latest 冻结在 1.58.5，不能据此判断现代布局属性是否有效。
- 标题换行保留 `<sup>`、`<b>`、实体和已有 `<br>`。子图标题随所属 domain 一起移动；其他纸面注释保留其位置含义。
- 窄屏上按原行、列顺序排列并排子图，保留原 trace 的轴/子图引用和双轴 overlaying。饼图、极坐标图等也参与 domain 重排。
- 图例以实际条目计算空间，包含没有 trace 名称的饼图切片。图例、脚注、按钮和 slider 在底部分区；图例与控件的 y 位置使用像素预算转换为 paper 坐标，避免固定负比例随图高漂移。
- 坐标轴使用 automargin；分类轴显示有代表性的刻度并保留首尾。窄屏饼图优先把百分比放在内部，标签仍在图例/hover 中。
- 渲染后按实际 DOM 边界处理数据标签碰撞。可隐藏相交或越界的可选标签，保留数据、hover 与点击，后续重新布局时恢复再检查。标题、图例与轴文字应通过布局修复。
- Sankey 显示标签可缩写，但完整名称必须保留在 hover 中。存在自定义 hover/customdata 时保留其语义。
- 对叶节点引用缺失父节点的层级图，可补充由现有子节点推导的结构节点；branchvalues=total 的新增父值取子节点和。保留已有节点值并报告派生修复；对无法确定的业务数据和交互意图要求真实输入。

页面支持 index.html?mock=mock3_point 等带后缀名称；默认 mock2。fixture 应给 window.mockData 赋值为 figure 数组。空数组作为占位样例保留。
