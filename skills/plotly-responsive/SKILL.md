---
name: plotly-responsive
description: Use when model-produced Plotly.js figures have clipped or overlapping titles, legends, axes, colorbars, subplots, labels or update menus, unreadable in-plot annotations, or unnecessarily hidden treemap names, in responsive frontend containers including 360px mobile viewports and year selectors that do not match the displayed data.
---

# Plotly 响应式解析与布局

为模型返回的标准 {data, layout, config} 增加前端适配层。以实际图表容器宽度计算布局，回归宽度为 **360、420、480、520px 视口**；卡片内的实际宽度通常更小，还要计入滚动条。**最低实际视觉验收必须包含 360px，同时保留 480px 对照；仅规则测试通过不算视觉通过。**

[assets/plotly-responsive.js](assets/plotly-responsive.js) 是可复制接入的浏览器/CommonJS 运行时模板。首次接入其他前端时阅读 [references/integration.md](references/integration.md)，按目标项目的组件生命周期整合。维护本仓库时，入口是 index.html，回归数据在 mocks/，测试为 tests/responsive.test.js。

## 修复流程

1. 检查模型原文、运行中的 Plotly 版本、容器实际宽度、轨迹类型、坐标轴引用、domain、注释和控件。将失败输入保留为原始 fixture。
2. 在这些视口及桌面宽度检查标题、图例、坐标轴、色条、子图标题、数据标签和控件；再检查窄到宽、宽到窄、数据更新后的布局。区分主标题、子图标题和数据坐标上的基准线标注：后者常因曲线穿过透明文字底而不可读，即使文字边界互不相交。记录 innerWidth、页面 clientWidth 和真实图表宽度。文字测量应使用渲染结果的边界，不能把字符数估算当作视觉通过。检查图形确实存在：就绪状态、空白树图或亚像素柱宽不能通过验收；检查 SVG clip-path，文字在卡片内仍可能被绘图区裁切。
3. 在适配层修复一般原因。对源 figure 做独立副本，每次 resize 从源配置重新计算，保留数据值、轴引用、关联关系与交互状态。根据拥挤程度增加纵向空间或把并排子图改为纵向，避免仅缩小整个图表。
4. 为发现的问题增加能检查实际约束的回归：子图不相交、标题仍有对应子图、数值与引用保留、交互控件分区、源输入不变。控件修复还要逐项点击，确认真实数据、选中项和标题一致，并检查展开、resize、数据更新及恢复全部。本仓库运行 `node tests/responsive.test.js`，自动发现 `mocks/mock*.js`；其他项目使用其回归入口。浏览器验收须等待全部图表及渲染后的标签检查完成，再保存完整截图和 SVG 边界结果。本仓库使用 tests/browser-layout-audit.js 的只读函数，传入原始 fixture 的数据注释索引，采集全部当前 mocks 的 360px 与 480px；外置模式检查标题在卡片内、SVG 之前、完整且不重复，默认顶部图例；显式内置模式补充窄屏/宽屏位置验收。检查真实注释底色不透明、文字在底框内、各可见 tspan 的最低对比度至少 4.5:1。树图还要检查标签所在方块/父标题条的实际宽高、字号、换行和省略号，点击展开及返回再复验。保存输入/适配器 SHA-256 和测试输出，运行 `node tests/write-responsive-report.js reports/responsive-YYYY-MM-DD`。最新产物在 reports/responsive-2026-10-14-header/；此前按日期保留的 reports 是历史证据。
5. 将输入名、原因、修复和验证范围记录在 [references/fix-log.md](references/fix-log.md)。未做视觉验证或输入本身缺少交互语义时明确记录。

## 已验证的处理原则

- 使用容器宽度与 ResizeObserver。config.responsive 处理窗口 resize，不能替代容器变化时的重新适配。
- 使用固定的现代 Plotly 版本。plotly-latest 冻结在 1.58.5，不能据此判断现代布局属性是否有效。
- 默认外置主标题与说明性副标题，使用 HTML 自然换行且只显示一次；渲染副本清空 SVG 主标题，必须接入返回的 header/renderHeader。图例保持 Plotly 原生交互，位于 SVG 顶部并独立预算行高，子图/轴标题和数据标注保留。只有显式 titlePlacement=internal 才考虑窄屏拥挤时的底部图例；短内置标题可与少量图例共存于顶部，宽屏保留作者图例配置与子图排列。不得因手机规则强制修改大尺寸图例。接入、按钮同步与导出规则见 integration.md。
- 内置标题换行保留 `<sup>`、`<b>`、实体和已有 `<br>`。子图标题随所属 domain 一起移动；其他纸面注释保留其位置含义。
- Plotly 多行标题的 tspan 与单行文字的基线处理不同；顶部位置采用像素距离换算到 container 坐标，检查第一行是否超出 SVG。窄屏独立预算完整标题行高，关闭 title.automargin，避免其空间不足时将多行 tspan 上移；坐标轴 automargin 继续开启。外置标题由受控文字富文本渲染，不再重复显示摘要。
- 内置桌面主标题缺少显式 y/纵向锚点时，明确默认顶部基线，避免从窄屏恢复后 title.automargin 将标题贴到 SVG 顶边。作者明确的 paper 坐标或非顶部位置保留。
- 图内数据/基准标注保持 x/y 和坐标轴引用，采用随 plot 背景变化的实色底隔开曲线；默认前景使用中性色，已声明且对比度足够的语义颜色保留。正常字号参考 [W3C 4.5:1 对比度要求](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)，在真实 SVG 中测量，透明底不能以页面白底代替验证。边框只在参考线坐标精确匹配时沿用线色，其他标注用中性边框；纸面标题/脚注不套用数据标注样式。
- 标注文字至少 12px，留小内边距；可选点标签的碰撞障碍包含整块底框。保护框仍遮挡重要峰谷或多个标注拥挤时，调整位置或将说明放到图外并保留参考关系，再做视觉验收。当前模板不自动改动数据、曲线配色和标注锚点。
- 窄屏上按原行、列顺序排列并排子图，保留原 trace 的轴/子图引用和双轴 overlaying。饼图、极坐标图等也参与 domain 重排。
- 图例以条目文字估算行高，包含没有 trace 名称的饼图切片，再用真实 DOM/截图验收。默认顶部图例与子图标题分区；内置且拥挤时的底部图例与脚注、色条、按钮和 slider 分区。位置用像素预算转 paper 坐标，避免随图高漂移。
- 底部 dropdown 向上展开，验收展开后的每个选项仍在图表边界内。缺少年份筛选参数时，只有按钮年份、逐点 customdata 年份列和 text/hovertext 一致、各数组长度正确且没有已有数据命令时，才补齐筛选。默认 `all` 对应全量数据；每个年份同步筛选坐标、气泡大小和已支持的逐点元数据。接入时通过 yearSelections 保存选择，resize/数据更新从完整源数据重建，不能从当前子集生成 `all`。绑定条件和事件接入见 integration.md。
- 外置模式的 update/relayout 按钮标题由 titleUpdates 同步 HTML，args2 恢复标题也要同步；resize 保留源标题与选择状态，不能让按钮重新插入 SVG 主标题。内置模式按钮中的标题也必须采用适配后的坐标和字体；切回 `all` 不能恢复源标题的旧 y 值。提前预算所有选项中最长标题的空间，保留选中年份标题的原始定位属性。已修复的年份筛选器在各宽度保持 dropdown，避免 Plotly.react 切换菜单类型时残留旧 SVG 节点。
- 坐标轴使用 automargin；分类轴显示有代表性的刻度并保留首尾。窄屏饼图优先把百分比放在内部，标签仍在图例/hover 中。
- 分类刻度抽样不会改变原类别的位置，换行宽度应由选中刻度的最小间距计算；多行刻度的高度同时纳入子图间距和底部空间。极坐标自动径向刻度应限制数量，检查与角度指标名称的交界。
- 极坐标的分类名称需要单独换行，优先按词拆分；仅减少径向刻度不能防止角度名称越出卡片。底部 x 刻度增加 ticklabelstandoff，检查与 y 轴零刻度的角落交界。
- 窄屏色条横放到底部独立区域；每个 trace/marker 色条及共享 coloraxis 均需预算标题、刻度、高度，与图例、脚注和控件分区。保留 colorscale、范围、单位和已有刻度语义。
- 热力图的单元格重复轴名称时，可只保留值及单位，原始 text/customdata/hovertemplate 不变。检查实际单元格标签边界，不能只测坐标轴。
- 少量、间隔极不均匀的日期柱形可能只有亚像素宽。仅在柱形独占该轴、未指定 type/range/matches/rangebreaks 时可按事件类别排列，保留顺序、日期和数值，并报告横轴不再表示连续时间间隔。显式 date 轴、混合时间序列和桌面源配置应保留。
- 渲染后按实际 DOM 边界处理数据标签碰撞。可隐藏相交或越界的可选标签，保留数据、hover 与点击，后续重新布局时恢复再检查。窄屏 scatter/polar/bar 允许标签进入边距，避免 plot clip-path 截断，再检查实际碰撞。标题、图例与轴文字应通过布局修复。
- Sankey 显示标签可缩写，但完整名称必须保留在 hover 中。存在自定义 hover/customdata 时保留其语义。
- 对叶节点引用缺失父节点的层级图，可补充由现有子节点推导的结构节点；branchvalues=total 的新增父值取子节点和。保留已有节点值并报告派生修复；对无法确定的业务数据和交互意图要求真实输入。
- 层级图数组少一个根首项时，仅在叶节点元数据逐项对应、候选父引用有效且无环时补齐 parents/customdata 的根首项；不能仅凭长度差猜测错位位置。无法确认时显式报错。未声明 branchvalues 时，若根值等于直属子值之和、所有父值覆盖子值，可推断 total 并报告；显式 total/remainder 优先，原 values/colors 不改写。
- 矩形树图名称不能只依赖 uniformtext 的缩小/隐藏。先判定真实宽、高，扣除内边距后按实际字体测量；能完整显示则保留，优先换行，必要时降至可读下限，再以省略号表示剩余内容。当前密集树图默认门槛为 24×18px、字号下限 10px、内边距 2px，需按目标字体及终端复验；宽高必须分别达标，面积大而过窄/过扁仍隐藏。父节点只使用子框上方的标题条；省略后的每行及整体边界均在对应框内。仅处理纯文本/已有换行，不拆坏复杂富文本或数学标签，不补造 textinfo:none 的叶名称。保留原 labels/ids/values/customdata/hover；每次渲染、缩放、展开/返回从完整显示源重新排字，不能累积缩写。接入细节见 integration.md。

页面支持 index.html?mock=mock3_point 等带后缀名称；默认 mock2。fixture 应给 window.mockData 赋值为 figure 数组。空数组作为占位样例保留。
