# 修复记录

| 样例 | 原因 | 修复关键点 | 验证范围 |
| --- | --- | --- | --- |
| 全部样例/渲染入口 | plotly-latest 冻结在旧版本；固定宽度、标题和控件配置缺少终端上下文。 | 固定 Plotly 4.1.1；按实际容器宽度适配；ResizeObserver 重新计算；保留源配置和 uirevision。 | 脚本语法检查、所有非空 fixture 的布局与数值回归。 |
| mock0 | 普通标题、坐标轴、mode bar 争用窄屏空间。 | 标题换行、轴 automargin、窄屏隐藏覆盖式 mode bar。 | 360/420/520px 规则测试。 |
| mock1 Sankey | 长中文节点标签在有限列宽中拥挤。 | 按宽度缩写显示标签，完整名称保留在 hover；减小 pad/thickness。 | 源标签不变、完整 hover、宽屏恢复原标签。 |
| mock1 双面板、mock2/mock7_point 多面板 | 标题、图例和子图标题同处顶部；底部小面板受边距挤压。 | 图例移至底部分区；从最小 domain 计算图高并预算子图间的标题/刻度空间。 | 子图最小像素高度、图例像素位置、数据/引用保留。 |
| mock3_point、mock4_point | 并排柱图在手机上各自只有半屏宽，两个子图标题相互覆盖。 | 按原左右顺序纵向排列；标题随所属 domain 映射；分类刻度换行与抽样。 | 子图 domain 不相交、标题匹配、桌面恢复原布局。 |
| mock5_point、mock16_point 饼图 | 饼图无 trace 名称导致图例未计入预算；外部标签过长。 | 从切片 labels 计算图例；百分比放内部，完整标签保留在图例/hover。 | 底部预留空间、原始 hover 标签与数值保留。 |
| mock8_point、mock16_point 混合图 | Cartesian 双轴与饼图/极坐标共享多列网格。 | 将各类 panel 统一纵向排列，保留轴引用和 overlaying，非 Cartesian domain 一同重排。 | 6 面板网格、双轴关系、pie/polar domain。 |
| mock6_ok、mock9_normal、mock10_normal、mock13_ok、mock14_point、mock15_normal | 多图例、双轴标题和数据标签在窄屏中容易拥挤。 | 单独预算图例行高；右轴空间、轴标题换行；实际 SVG 数据标签边界碰撞检查。 | 三个视口的空间预算、数值/轴引用保留；合成 DOM 碰撞与 resize 恢复检查。 |
| mock11_notresolve | sup 标签令旧包装逻辑跳过长标题；底部按钮挤占图例空间；按钮没有 label。 | 保留标签和实体插入换行；控件单独分区；由原标题年份补显示 label，过宽按钮组改为 dropdown。 | 富文本保留、按钮位置和参数保留。原按钮只更新标题/visible，未筛选年份数据；此业务行为不由布局层推断。 |
| mock12_dirty | 多个 treemap 的 parents 引用了输入中不存在的公司/分组节点。 | 仅补充缺失结构父节点；total 父值由现有子值求和，原叶节点不变；底部说明另行分区。 | 所有父引用有效、原叶值不变、已完整的层级不修复、脚注空间。 |
| mock17–mock20 | 当前为四个空数组占位。 | 页面和自动测试接受零图表。 | 自动发现文件，零输入不报错。 |

当前回归自动发现 21 个 mock 文件，其中 17 个非空文件共 31 张图；另有 10 项针对具体原因的检查。所有图都覆盖 360/420/520px 视口对应的卡片宽度。

实际浏览器视觉检查仍待完成：此前浏览器工具因 URL 协议策略拒绝访问本项目的 file:// 页面。此次未绕过该限制；规则和合成 DOM 检查不能代表已验证所有 Plotly SVG 布局无重叠。

版本依据：[Plotly 官方入门文档](https://plotly.com/javascript/getting-started/)说明 plotly-latest 冻结在 1.58.5，并列出固定版本 CDN 的用法。
