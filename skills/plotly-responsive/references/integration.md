# 接入运行时模板

模板不依赖框架。它导出 fitFigure、normalizeValue、wrapText 和 resolveTextCollisions；在浏览器脚本中是 window.PlotlyResponsive，在 CommonJS 中通过 require 获取。

本项目使用固定 CDN 版本 plotly-4.1.1.min.js。其他项目可以沿用其已验证的现代版本；确认标题、legend 和 uniformtext 等属性被该版本支持。[官方版本说明](https://plotly.com/javascript/getting-started/)指出 plotly-latest 已冻结。

## 渲染与 resize

将 asset 复制到前端源码，按项目模块规范导入。保留源配置，每次使用真实容器宽度调用：

~~~js
const source = PlotlyResponsive.normalizeValue(modelFigure);
const fitted = PlotlyResponsive.fitFigure(source, container.getBoundingClientRect().width);
container.style.height = fitted.height + 'px';
await Plotly.newPlot(container, fitted.data, fitted.layout, fitted.config);
PlotlyResponsive.resolveTextCollisions(container);
~~~

fitFigure 返回 {data, layout, config, height, panels, stacked, warnings}。只把 data/layout/config 传给 Plotly。panels 用于回归检查，warnings 用于记录输入结构修复和缺少按钮标签等诊断。

用 ResizeObserver 监听容器宽度；只在宽度变化时计算新 figure，通过 Plotly.react 更新。合并快速 resize 产生的请求，并串行调用 Plotly，避免多个布局并发覆盖。图表高度由适配结果设置；只改变高度的 observer 事件应跳过。

在首次渲染、react、restyle 和 plotly_afterplot 后再次检查标签。用 requestAnimationFrame 合并检查；resolveTextCollisions 会先恢复此前隐藏的标签，再根据新边界判断。

组件卸载时取消 requestAnimationFrame、断开 observer、移除事件订阅，并按项目生命周期调用 Plotly.purge。

## 数据和交互

- {dtype,bdata,shape} 编码会在适配前转换成普通数组，保留二维/多维形状；不支持的 dtype 和错误 shape 会显式报错。
- fitFigure 不修改传入对象。模型原文和 fixture 保持不变；图表数据更新时还要同步保存的数据副本，否则下一次 resize 会恢复旧值。
- 默认设置稳定的 uirevision，调用者已有的值会保留。业务切换到新 figure 时由调用者决定是否变更该值。
- 按钮若更新标题，后续 resize 应以对应的原始按钮标题为源。模板会适配按钮里的标题，但无法替缺少数据筛选参数的按钮推断业务行为。
- 窄屏模式隐藏覆盖在图表上的 mode bar。若产品需要图片导出等入口，应由产品界面提供对应操作。
- 当前碰撞检测针对 Plotly SVG 的 scatter/polar/bar 数据标签。Canvas/WebGL 文字、自定义扩展和未来版本的 DOM 结构需要对应的真实回归。

## 本仓库检查

~~~powershell
node tests/responsive.test.js
~~~

测试自动发现包括后缀在内的 mocks/mock*.js，使用 360/420/520px 视口对应的卡片宽度，并检查数值、引用、domain 和标签处理。它们不能证明每个浏览器中的文字都无碰撞；交付视觉结论前仍需看实际渲染。
