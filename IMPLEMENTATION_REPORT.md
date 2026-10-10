# 第一版实施与验收记录

日期：2026-10-01（America/Los_Angeles）。

本地预览：http://127.0.0.1:5181/lab/election-3d/

## 后续界面重设计

按 Scandinavian Design 重排为共享网格：页头、44px 操作栏、大地图与数据侧栏；图例紧贴地图，选中县位于侧栏首位，设置从地图标题处展开。统一中性色、文字层级、间距与控件状态，排行榜去除重复数值。手机搜索使用 16px 字号，滚动榜单的键盘焦点框完整可见。

本轮未编写测试代码。生产构建与 `git diff --check` 通过；实测 320px、390px、1024px 页面无横向溢出，1440px 桌面网格对齐。验证搜索键盘选择、Result/Shift、切年、1868 空态、翻转筛选、历史表、设置/Escape、复制链接与实际 PNG 下载。浏览器无页面异常；axe 无确定违规，SVG 文字和滚动区被遮挡项目另作截图检查。构建仍保留原有大包体提示。

[重设计前桌面](artifacts/redesign/before-desktop.png) · [重设计后桌面](artifacts/redesign/after-desktop-full.png) · [手机全页](artifacts/redesign/after-mobile-full.png) · [选中县与历史表](artifacts/redesign/county-mobile-full.png) · [实际下载图卡](artifacts/redesign/election-card.png)

已在原工作区上完成产品功能，保留已有未提交修改。没有部署、更新 2024 数据或新增运行依赖。按用户最后的要求，撤回本轮新增测试代码，恢复原有测试文件；最终验证以生产构建和实际浏览器操作为准。

## 实现内容

| 阶段 | 结果 |
| --- | --- |
| 指标与地图模式 | 共用原始 returns 的 margin、signed shift、有效性及严格翻转定义；Result / Shift 模式切换暂停并落到真实年份；缺失、平票、零变化分别表达。默认仍是暂停的 2020 Result。 |
| 排行榜 | Result 排全部当前有效县；Shift 排全部可比县。绝对值降序、FIPS 稳定排序，默认五名，可展开全部；翻转筛选只影响列表。1868 不启用翻转筛选。 |
| 县选择与历史 | 县名、州名、完整 FIPS 本地搜索，键盘选择；排行榜按钮进入同一详情。金色标识选中县，支持聚焦和全国视角。SVG/D3 历史曲线含零线、当前年、翻转标记、缺失断线及历史表格。 |
| 分享与图卡 | URL 保存年份、模式、县、筛选、配色与 Result 高度指标，保留部署子路径；支持无效参数回退、前进后退、剪贴板失败手动复制。PNG 从最终后处理帧复制到原生 Canvas，含地图、年份、图例、指标、来源、限制和县摘要。 |
| 窄屏与可访问性 | DOM 顺序为标题和操作→地图→详情及排行榜；支持键盘、焦点、触摸和 reduced-motion。原始数据加载独立于 WebGL；地图失败后仍可查县、读历史。 |

县高亮使用现有合并 mesh 的 county 属性与 uniform。模式切换只切换数据纹理，没有重新挤出几千个县。聚焦同时更新相机位置和控制器目标，并处理 SVG Y 轴、阿拉斯加和夏威夷坐标。

## 构建与浏览器验收

- 修改前的原有五项 Node 检查全部通过。
- 最终 `npm run build` 通过；`git diff --check` 通过。
- 按最后指示，不保留新增测试代码，不改写原有测试。原有排行榜测试仍假定默认只显示翻转县，已不符合新界面；因此不声称最终 `npm test` 全部通过。
- 默认 2020 Result 显示 Biden / Trump、全国 79 个翻转县、3,110 个可比县、2.5%。
- 2020 Shift 默认首项是未翻转的 Starr, Texas：D +60.2% → D +5.0%，向共和党移动 55.2 pp。开启翻转筛选后列表为 79 县，全国统计保持不变。
- Autauga, Alabama：2020 年 R +44.4%，较 2016 年向民主党移动 4.6 pp，总票数 27,770。搜索和榜单选择共用同一详情；切换年份保留选择。
- 1868 Shift 显示没有前一届比较；Result 仍显示有效县。Honolulu 1956 无当前返回值、历史保留从 1960 年开始的可用数据；未伪装成零。
- 在新标签页恢复分享链接；另验证 2016 + Shift + 01001 + 翻转筛选 + Blue & red + margin votes 的组合、模式切回后的高度设置、前进后退与非法参数回退。剪贴板失败时手动链接可选中。
- 键盘完成搜索输入、方向键/Enter 选县、Previous election 按钮切年及 Copy link。搜索无结果状态正常。
- 1440×900 与 390×844 无横向溢出；窄屏第一屏可见地图，完整榜单和历史表按需展开。
- reduced-motion 下聚焦直接到位、呼吸关闭；暂停且呼吸为零时观察窗口内无额外渲染帧，选择和导出仍可主动刷新。
- 夏威夷 Kalawao 和阿拉斯加 Anchorage 聚焦位置与世界坐标 bounds 一致；全国按钮恢复相机及控制器目标。阿拉斯加保留缺失数据说明。
- 正常浏览无新增页面异常。默认界面与选中县详情的 axe 检查没有确定违规；SVG 文字对比度项目需人工判断，已结合实际截图检查。修正了容器 ARIA 角色和橙色小号文字对比度。

## 实际下载的 PNG

均为浏览器真实下载文件，已打开检查地图非空、内容未拉伸、文字无截断、来源和限制可读。主图卡输出 1600×1000，明确标注来源地图的实际像素尺寸。

| 文件 | 验证场景 |
| --- | --- |
| [result.png](artifacts/product-v1/result.png) | 2020 Result，全国图与 79/3,110 统计，标明比较年份 2016。 |
| [shift.png](artifacts/product-v1/shift.png) | 2020 Shift，Autauga 金色高亮、4.6 pp 向民主党移动、正确方向图例。 |
| [export-playing.png](artifacts/product-v1/export-playing.png) | 播放过程中导出，落到标题所选的 2016 年，导出后暂停。 |
| [export-transition.png](artifacts/product-v1/export-transition.png) | 切年动画过程中导出，落到目标 2012 年。 |
| [export-demand.png](artifacts/product-v1/export-demand.png) | 暂停且呼吸为零，按需渲染仍能取得完整图像。 |
| [export-dof.png](artifacts/product-v1/export-dof.png) | 开启景深时导出，捕获后处理实际输出。 |

额外观察了复制帧时的 shader 年份、插值进度与呼吸 uniform：均为请求年份、进度零、呼吸零；结束后恢复原呼吸设置。下载准备期间执行浏览器返回，会中止并显示重试提示，避免旧标题配新地图。

模拟真实 WebGL context loss：导出被拒绝并显示错误，界面解除忙碌状态，地图显示重新加载入口；搜索仍能选中 Autauga 并显示正确详情。[失败状态截图](artifacts/product-v1/context-loss.png)。

## 关键截图

[桌面 Result](artifacts/product-v1/result-desktop.png) · [桌面 Shift 与县详情](artifacts/product-v1/shift-county-desktop.png) · [390×844 首屏](artifacts/product-v1/mobile.png) · [窄屏选中县](artifacts/product-v1/mobile-county.png)

[原桌面基线](artifacts/product-v1/baseline-desktop.png) · [原窄屏基线](artifacts/product-v1/baseline-mobile.png)

## 保留的范围与限制

数据仍为已有 Amlani & Algara / Harvard Dataverse 1868–2020 returns，未重新取得或改写源数据。现代名称和 Census 2017 边界沿用已有合并处理。阿拉斯加 district returns 不提供县级结果，夏威夷及个别县的早年数据缺失。仅解释 D/R 领先和变化，不推断第三党实际胜者、个体改投或因果。

链接恢复数据视图和合理聚焦，不复制任意相机姿态或光照。PNG 使用现有画布像素，没有另外建立高清渲染器。直接点选 shader 变形后的县、历史边界转换、2024、视频及独立 2D 地图均未扩展。

生产构建仍有大于 500 kB 的包体提示；没有为此添加额外分包框架。原有 Three.js 依赖弃用提示仍在。README 已更新为实际用法，部署留待用户安排。
