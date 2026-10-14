# 接入运行时模板

模板不依赖框架。它导出 fitFigure、normalizeValue、wrapText、resolveTextCollisions，以及树图排字辅助 fitCellText/fitTreemapLabels；在浏览器脚本中是 window.PlotlyResponsive，在 CommonJS 中通过 require 获取。

本项目固定使用 Plotly 4.1.1，演示入口加载仓库中的 plotly-4.1.1.min.js；其他项目也可使用固定版本 CDN 或其已验证的现代版本。确认标题、legend 和 uniformtext 等属性被该版本支持。[官方版本说明](https://plotly.com/javascript/getting-started/)指出 plotly-latest 已冻结。

## 渲染与 resize

将 asset 复制到前端源码，按项目模块规范导入。保留源配置，每次使用真实容器宽度调用：

~~~js
const source = PlotlyResponsive.normalizeValue(modelFigure);
const fitted = PlotlyResponsive.fitFigure(source, container.getBoundingClientRect().width);
container.style.height = fitted.height + 'px';
await Plotly.newPlot(container, fitted.data, fitted.layout, fitted.config);
PlotlyResponsive.resolveTextCollisions(container);
~~~

fitFigure 返回 {data, layout, config, height, panels, stacked, yearMenus, warnings}。只把 data/layout/config 传给 Plotly。panels 用于回归检查，yearMenus 描述补齐的年份筛选器，warnings 用于记录输入结构修复和缺少按钮标签等诊断。

用 ResizeObserver 监听容器宽度；只在宽度变化时计算新 figure，通过 Plotly.react 更新。合并快速 resize 产生的请求，并串行调用 Plotly，避免多个布局并发覆盖。图表高度由适配结果设置；只改变高度的 observer 事件应跳过。

在首次渲染、react、restyle 和 plotly_afterplot 后再次检查标签。用 requestAnimationFrame 合并检查；resolveTextCollisions 会先恢复此前隐藏的标签，再根据新边界判断。首次渲染和 resize 的“就绪”状态应等待标签检查完成，截图或验收不能只等待 newPlot 的 Promise。

组件卸载时取消 requestAnimationFrame、断开 observer、移除事件订阅，并按项目生命周期调用 Plotly.purge。

## 数据和交互

- {dtype,bdata,shape} 编码会在适配前转换成普通数组，保留二维/多维形状；不支持的 dtype 和错误 shape 会显式报错。
- fitFigure 不修改传入对象。模型原文和 fixture 保持不变；图表数据更新时还要同步保存的数据副本，否则下一次 resize 会恢复旧值。
- 默认设置稳定的 uirevision，调用者已有的值会保留。业务切换到新 figure 时由调用者决定是否变更该值。
- 普通按钮若更新标题，后续 resize 应以对应的原始按钮标题为源。修复的年份菜单由 yearSelections 选择对应标题，完整源标题和数据继续保留，不能把当前子集作为新源。
- 窄屏模式隐藏覆盖在图表上的 mode bar。若产品需要图片导出等入口，应由产品界面提供对应操作。
- 当前渲染后的碰撞处理针对 Plotly SVG 的 scatter/polar/bar 数据标签；同一次检查先适配 treemap 单元格文字。热力图通过窄单元格的模板与字体预算处理，浏览器验收包含其真实标签。Canvas/WebGL 文字、自定义扩展和未来版本的 DOM 结构需要对应的真实回归。
- 窄屏色条改为横向并占用独立底部区域，支持 trace/marker 及共享 coloraxis；颜色数值、范围与 hover 保留。
- 少量稀疏日期柱形在轴未声明时间语义时可以按类别排列；warnings 会指出横轴间隔语义变化。显式 date/type/range/matches/rangebreaks 和混合时间序列不改为类别轴。
- 层级数组错位仅在元数据能够确认缺失根首项时修复；不确定的错位会抛出错误，应在组件显示输入诊断。根据汇总关系推断 branchvalues=total 时也会返回 warning；显式 branchvalues 保留。
- 无箭头且使用数据坐标/axis domain 的注释会增加可读性保护：实色底、中性默认前景、至少 12px 字号、4px 内边距。主标题、paper/paper 标题脚注、visible:false 注释不套用。坐标和数值不变；对应水平参考线的 xref/yref/y0/y1 精确匹配时边框沿用线色，曲线及参考线颜色保持。
- 背景取 layout/template 的 plot/paper 色并合成透明度；支持 hex、rgb(a) 与常见命名色。显式不透明底与足够对比度的文字颜色保留，半透明底合成为实色；默认前景按背景选择深/浅中性色并检查 4.5:1。未知前景保留并返回测量提示；自定义内联颜色、整体淡出 opacity 和图外背景要通过实际渲染确认。明暗主题规则有单测，本轮实际浏览器验收为当前 mocks 的主题。

## 矩形树图标签

resolveTextCollisions 会先调用 fitTreemapLabels；不需额外事件订阅。它只处理 `.treemaplayer .slice` 的纯文本和已有 `<br>`，从 `data-unformatted` 读取完整的已解析显示文本，使用相同字体的临时 SVG 文字实际测量，再写入逐行 tspan；不访问 Plotly 私有 calcdata，也不改写 trace 的 labels、ids 或 hover 元数据。复杂富文本/数学表达式保留原渲染；不补造 textinfo:none 的叶名称，Plotly 原有分组标题按其显示源处理。

当前密集图默认最小宽 24px、最小高 18px，扣除 2px 内边距，以原字号尝试完整显示/换行；不足时尝试 10px 下限，再裁切最后一行并添加 `…`。仍容不下有意义文字则隐藏。纯排字 helper `fitCellText(text, width, height, measure, options)` 支持 fontSize/padding/minWidth/minHeight 参数；measure 必须使用对应实际字体，不能用字符数估算替代验收。其他产品采用更大字号时应同步提高门槛并复验。

父框的面积包含子框，不能把整个父框当作文字区：用实际子框的顶部限制标题条高度。处理后再次检查真实文字 bbox；超出对应方块/标题条则隐藏。Latin 优先按空格换行，Unicode 按字素拆分。保留对齐，每次 resize、Plotly.react、点击展开及返回重新读取完整显示源，避免“中…”成为下一次排字源。演示页的“更新图表数据”只更新数值 y 数组，不能用它声称 treemap values 更新交互已验证。

## 缺少年份筛选参数的菜单

运行时只补齐可确认的输入：单个菜单有不同年份的 update 按钮，原参数仅更新全 true 的 visible 和标题；全部 trace 为具有完整 x/y/customdata 的 scatter。每个 trace 必须有且只有一个 customdata 列覆盖全部按钮年份，且逐点 text/hovertext 中的年份与该列一致。已支持的逐点数组长度必须匹配。

已有 x/y 等数据命令、args2、execute:false、frames、selectedpoints、transforms、错位/模糊元数据或两个竞争的年份菜单会保留源行为。不能确认时补标签不会变成业务筛选。当前支持的逐点字段见资产中的 POINT_PATHS；接入其他逐点属性时同时扩展白名单和对齐回归，不能仅按数组长度过滤 colorscale/meta 等 trace 级属性。

补齐后默认 active=0 的 `all` 对应完整源数据；2021 等年份对应一致的点掩码。研发投入 NaN 等缺失值保留，不能为了增加气泡数量补成 0。菜单始终使用 dropdown，并向上展开。yearMenus 为 `{menuIndex, values, buttonNames}` 数组；按钮 name 是稳定标识。

~~~js
const yearSelections = {};
let yearMenus = [];
function fit(width) {
    const fitted = PlotlyResponsive.fitFigure(source, width, { yearSelections });
    yearMenus = fitted.yearMenus;
    return fitted;
}
container.on('plotly_buttonclicked', event => {
    const menu = yearMenus.find(item => item.buttonNames.includes(event.button?.name));
    if (!menu) return;
    yearSelections[menu.menuIndex] = menu.values[menu.buttonNames.indexOf(event.button.name)];
});
~~~

首次 newPlot 后订阅一次事件；后续 resize 用同一 yearSelections 调用 fit，并更新 height、react。用户点击由按钮的标准 update 参数完成筛选；事件保存选择即可。数据更新先同步完整 source，再用当前选择重新 fit/react，即使宽度没变也要执行；所有按钮的 payload 同时更新，避免切回 all 或其他年份时恢复旧值。业务切换到新 figure 时清空选择。

## 本仓库检查

~~~powershell
node tests/responsive.test.js
~~~

测试自动发现包括后缀在内的 mocks/mock*.js，使用 360/420/480/520px 视口对应的卡片宽度，同时覆盖有滚动条的窄 15px 容器和完整 480px 容器，并检查数值、引用、domain 和标签处理。它们不能证明每个浏览器中的文字都无碰撞；交付视觉结论前仍需看实际渲染。

最低实际视觉验收必须包含 **360px 和 480px**。本仓库的 `tests/browser-layout-audit.js` 导出只读 DOM 测量函数，可交给浏览器 evaluate API。等待页面摘要显示所有图表已渲染，确认实际加载的适配器版本，再保存完整截图和测量结果；检查文字是否被 plot clip-path 裁切，树图是否空白、稀疏柱形是否可见。演示页使用 scrollbar-gutter:stable 保持截图前后的内宽稳定。

数据坐标注释的原始索引作为参数传入，例如 mock14 第一张图的第一个注释：`auditRenderedLayout({dataAnnotations:{0:[0]}})`。索引从 fixture 读取，检查浏览器 `.annotation[data-index]` 的真实背景透明度、文字/可见 tspan 的最低对比度、底框包围关系；不读取 Plotly 私有 layout 状态。曲线穿过透明底的问题不会被纯文字 bbox 检查发现，不能遗漏此参数。报告生成器拒绝缺少预期注释检查、透明底或不足 4.5:1 的结果。

按日期保存 `reports/responsive-YYYY-MM-DD/{360px,480px}/results.json` 和完整 JPG；每个结果包含 name、输入 sha256、summary、viewport、charts、screenshot。`manifest.json` 保存 date、plotlyVersion、adapterHash、widths:[360,480]、sourceHashes 和 unitTests；`unit-tests.txt` 保存本次测试输出。实际审阅截图后运行：

~~~powershell
node tests/write-responsive-report.js reports/responsive-2026-10-14-treemap
~~~

该命令拒绝缺少 360px、源文件/适配器指纹变更、图表数量不匹配、渲染失败、页面横向溢出、所测文字越界/相交和空层级图等情况，再生成逐图报告和画廊。报告不能代替实际截图审阅。`reports/480px/` 及 write-480-report.js 是上轮的历史验收；新增数据后使用双尺寸报告。
