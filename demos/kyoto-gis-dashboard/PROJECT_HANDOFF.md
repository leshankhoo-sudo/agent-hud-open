# PROJECT_HANDOFF · Kyoto Prefecture Tourism GIS Dashboard

交接日期：2026-11-12。本文件所有数字和状态都是在交接时**重新读取文件、运行测试**得出的，不是照抄之前的对话。

> 给新对话的第一句话：这是一个已经能运行的项目。请在现有代码上继续开发，不要重建、不要重置、不要删除现有功能或改动已完成的设计。

---

## 0. 交接时的状态快照

| 项目 | 状态 |
|---|---|
| 仓库 | `leshankhoo-sudo/agent-hud-open` |
| 项目目录 | `demos/kyoto-gis-dashboard/` |
| Git 分支 | `ccr-bd068911-ydjxlc`（与 `origin` 同步） |
| 最后一次功能提交 | `797d108` Kyoto GIS: Kyoto City Bus routes with line reveal and stop pop animation |
| 可恢复版本 | 提交 `faf1ebe`（加入本交接文件的提交；代码与 `797d108` 相同）。远端只允许推送到本分支，**没有推送 Git 标签** |
| 未提交改动 | 无（交接文件本身也已提交） |
| 逻辑测试 `npm test` | **16 / 16 通过**（2026-11-12 更新后为 21 / 21，见第 12 节） |
| 构建 `npm run build` | 通过（主 JS 1.09 MB，gzip 309 KB） |
| 浏览器测试 `tests/e2e.mjs` | **59 / 59 通过**（Playwright + Chromium，桌面 1440×900，含一个 390 宽手机检查）。2026-11-12 更新后为 77 / 77，见第 12 节 |
| 天气接口 | 本次测试时 Open-Meteo 返回 429 限流，页面正确显示错误状态、没有显示假数值 |

另一个 demo：`demos/dashboard-interactions/`（早期的海洋主题 dashboard 演示）。用户要求**保留原样，不要修改**。

---

## 1. 项目概述

大学 GIS 课程项目原型。研究范围是**京都府（Kyoto Prefecture）**，不是只有京都市。

- 界面文字用英文；给用户的说明用中文（README、本文件）。
- 团队：KHOO LE SHAN、ER ZE XI、NICHOLAS LIM JUN XIAN、LUI YING HUI（显示在开场和结尾，不放照片）。

页面从上到下：

1. **樱花滚动开场**（`Intro.jsx`）：AI 生成的示意视频随滚动播放，花瓣用 canvas 画。
2. **Explore Kyoto**（`Explore.jsx`）：7 张京都府内的真实照片卡，选地点后进入地图。
3. **功能导览条**（`Features.jsx`）：6 块竖长玻璃面板，展开后跳到对应功能。
4. **GIS Dashboard**（`App.jsx` + `MapView.jsx`）：地图、筛选、分析、详情。
5. **结尾**（`Outro.jsx`）：四格视频和团队名单。

全局固定在右上角：背景音乐按钮（`MusicPlayer.jsx`）和明暗主题开关（`ThemeToggle.jsx`）。

### 1.1 数据诚信原则（贯穿全项目，新对话必须遵守）

用户反复强调过以下几点：

- 不编造数据。天气失败就显示错误，不补数值。
- 步行距离只用沿道路网计算的结果，不用直线冒充，缺失也不填 0。
- 不按名称猜测去关联不同数据集。示例行程的 `attraction_id`、`stop_id` 保持 null。
- 保留原始 ID 和原始名称字段。
- 照片只用可核实来源和自由许可，必须署名。
- 英文名只用可核实来源，没有就只显示日文。
- 不用 AI 图片冒充真实景点。
- 重要限制要写在界面上（例如密度不等于游客人数、步行只覆盖试点）。

---

## 2. 文件夹结构

```
demos/kyoto-gis-dashboard/
├─ PROJECT_HANDOFF.md        本文件
├─ README.md                 中文使用说明（运行、部署、数据处理、功能说明、限制）
├─ index.html / vite.config.js（base: './'）/ package.json / package-lock.json
├─ src/
│  ├─ main.jsx               入口，加载字体和 styles.css
│  ├─ App.jsx                Dashboard 主体与全部状态（约 1,000 行）：顶部栏、左侧 Explore 面板、
│  │                         右侧详情标签页、分析入口、巴士路线、Journeys/Sources 面板、Explore/Features 衔接
│  ├─ MapView.jsx            MapLibre 地图：底图与主题配色、数据图层、筛选、步行路线动画、
│  │                         巴士路线动画、选中标注、开场揭示动画（约 700 行）
│  ├─ Intro.jsx              樱花滚动开场（视频随滚动、canvas 花瓣、5 段文字）
│  ├─ Explore.jsx            Explore Kyoto 封面流卡片、模糊照片背景、拖动换卡、卡片翻面
│  ├─ Features.jsx           功能导览条（悬停横向展开）
│  ├─ Outro.jsx              结尾四格视频与团队名单（导出 TEAM）
│  ├─ Weather.jsx            Open-Meteo 天气卡片（7 天逐小时、计划访问日期和小时、图表）
│  ├─ ThemeToggle.jsx        明暗开关（拖动滑块、点阵图标、光弧、水波、樱花花瓣）
│  ├─ MusicPlayer.jsx        背景音乐（Web Audio、按需下载、精确循环、音量）
│  ├─ styles.css             全部样式（约 1,150 行）。暗色是默认；浅色在 :root[data-theme='light'] 下
│  └─ lib/
│     ├─ data.js             loadAll()：读取 public/data 下全部文件；英文名合并；筛选；标签格式
│     ├─ theme.js            两套地图配色 MAP_THEME；系统主题 / localStorage 记忆
│     ├─ walking.js          步行试点可用性、索引、覆盖统计
│     ├─ weather.js          Open-Meteo 请求、解析、30 分钟缓存、东京时间工具
│     ├─ icons.js            canvas 画的巴士/铁路/电车图标
│     └─ media.js            loadAsBlob()：视频以 blob 加载，让不支持 Range 的服务器也能拖动进度
├─ public/                   网站直接读取的文件
│  ├─ data/                  处理后的 GIS 数据（见第 4 节）
│  │  ├─ analysis/           KDE 结果、步行试点表和报告、英文名核对表
│  │  └─ bus/                index.json + variants/<id>.json（175 个）
│  ├─ media/                 开场视频、结尾视频、背景音乐 MP3、模糊背景小图
│  ├─ photos/                54 张景点照片（Wikimedia Commons，已缩小）
│  └─ explore/               Explore 区块 7 个地点 × 大小两种尺寸
├─ data/
│  ├─ raw/                   原始资料，未改动（.gitattributes: * -text，保护 SHA-256）
│  │  ├─ attractions.*, transport.*, kyoto_boundary.geojson, sample_journeys.json, walking_routes.geojson
│  │  ├─ documents/          Excel / PDF（含 Kyoto_Tourism_Data_EN.xlsx 参观人次统计）
│  │  ├─ package_docs/       资料包说明
│  │  └─ bus_package/        用户上传的巴士资料包（路线目录、站点对照、票价、OSM 走线和停站顺序）
│  └─ cache/                 Wikidata / OSM / Commons 查询缓存（重跑脚本时免联网）
├─ scripts/                  Python 数据处理脚本（第 4.3 节）
├─ tests/
│  ├─ logic.test.mjs         node --test 逻辑测试（读取真实数据）
│  └─ e2e.mjs                Playwright 浏览器测试
├─ docs/                     DATA_INTERFACES.md、TEST_REPORT.md（TEST_REPORT 是 11-09 的旧版）
└─ windows/                  Windows 一键启动（Start-Dashboard.bat + serve.ps1 + 中文说明）
```

不在 Git 里的（`.gitignore`）：`node_modules/`、`dist/`、`dist-artifact/`、`data/roads/`（步行分析用的道路资料，约 80 MB，需用户另外提供）、`data/cache/explore/*.jpg`、`music-master/`（音乐 WAV 母带）。

---

## 3. 技术框架与依赖

| 类别 | 内容 |
|---|---|
| 前端 | React 18.3.1、Vite 5.4.11、@vitejs/plugin-react 4.3.4 |
| 地图 | MapLibre GL 4.7.1（无需账号） |
| 字体 | @fontsource/ibm-plex-sans、ibm-plex-mono 5.1.0（本地打包） |
| 底图 | 默认 OpenFreeMap 矢量瓦片（OSM 数据，自定义配色）；备选 GSI 淡色地图、OSM 栅格 |
| 运行环境 | Node 18+（交接时为 Node 22.23.4） |
| 数据处理 | Python 3：pyproj、shapely、networkx、openpyxl、Pillow、numpy、scipy、mido；外部工具 mapshaper、ffmpeg、fluidsynth + FluidR3_GM.sf2 |
| 测试 | node:test（内置）；Playwright + Chromium（全局安装，用 `PW_PATH` 指定） |
| 外部服务（浏览器端） | Open-Meteo 天气 API（免 key，有限流）；OpenFreeMap / GSI / OSM 瓦片 |

没有后端，没有数据库，没有 API key。

---

## 4. GIS 数据集（交接时实际读取的数量）

### 4.1 三类数据的区分

| 类型 | 说明 | 例子 |
|---|---|---|
| **官方 / 原始数据** | 用户提供的资料包，或官方发布的数据，未改动 | `data/raw/*`；MLIT N03 行政边界；京都市交通局路线目录和票价；京都府观光统计 Excel |
| **处理后的 GIS 数据** | 由 `scripts/` 从原始数据生成，可重跑 | `public/data/*`：显示用边界、空间连接、KDE、步行试点、英文名、巴士索引 |
| **来自 OSM 的派生数据（非官方）** | 巴士走线和停站顺序来自 OpenStreetMap 路线关系，不是官方 GTFS | `data/raw/bus_package/route_shapes.geojson`、`ordered_stops.json` → `public/data/bus/variants/` |
| **示意 / 生成内容** | 不是测量数据，界面上已标注 | 开场 AI 视频（标注 Illustrative AI-generated footage）；原创背景音乐 |

注意：巴士动画里线条"延伸"只是展示效果，**不代表巴士实时位置或真实行驶速度**，界面上已写明。

### 4.2 数据清单

| 文件 | 记录数 | 来源 / 说明 |
|---|---:|---|
| `public/data/attractions.geojson` | 523（viewpoint 246 / attraction 156 / museum 102 / castle 19；有名称 305） | OSM via Geofabrik，原样复制自 `data/raw` |
| `public/data/transport.geojson` | 5,479（bus 5,229 / rail 248 / tram 2） | 同上 |
| `data/raw/kyoto_boundary.geojson` | 999 个 N03 多边形 | MLIT N03 2026（空间连接用原始多边形） |
| `public/data/municipalities_display.geojson` | 36 个市区町村 / 区 | N03 合并 + mapshaper 简化，仅显示用 |
| `public/data/prefecture_outline.geojson` | 1 | 府界轮廓，仅显示用 |
| `public/data/point_municipality.json` | 6,002 个点 → 36 个名称 | 点在多边形内的空间连接 |
| `public/data/analysis/density_kde.geojson` | 4,122 个网格 | Quartic 核，半径 2,000 m，网格 500 m，EPSG:6674，单位 records/km² |
| `public/data/walking_routes.geojson` | 38 条（bus ok 18 + unreachable 1；rail ok 18 + unreachable 1），19 个试点景点 | 沿 OSM 道路网 Dijkstra；范围只有祇園–清水试点 |
| `public/data/sample_journeys_display.json` | 9 条示例行程 | 京都市交通局；`attraction_id`/`stop_id` 保持 null |
| `public/data/photos.json` | 54 张（305 个有名称景点中） | Wikidata P18 / Commons，300 m 内，自由许可 |
| `public/data/names_en.json` | 景点 125、站点 2,558、市区町村 36 | OSM name:en / 罗马字 / Wikidata 标签；无机器翻译 |
| `public/data/tourism_stats.json` | 26 个市町村（2024、2025）+ 3 张参考表（20、25、7 行） | `Kyoto_Tourism_Data_EN.xlsx`，原值照抄 |
| `public/data/explore_places.json` | 7 个地点 | Wikimedia Commons，坐标核对在府内 |
| `public/data/bus/index.json` | 105 条路线、707 个官方站点、1,797 个地图点对照、0 条待核实标记 | 巴士资料包 |
| `public/data/bus/variants/*.json` | 175 个文件，共 4,617 次停站 | OSM 走线 + 停站顺序 |
| `public/data/manifest.json` | — | 记录数、构建时间、原始文件 SHA-256 核对（全部 match） |
| `public/media/kyoto-slowly.mp3` | 2.95 MB，147.4 s（循环段 1.000–146.372 s） | 原创曲，FluidSynth + FluidR3_GM 渲染 |

交接时检查：`public/data` 下所有 JSON / GeoJSON 都能正常解析，没有读取失败的文件。

### 4.3 处理脚本（都可重跑）

| 脚本 | 作用 | 备注 |
|---|---|---|
| `prepare_data.py` | 校验原始文件 → 生成 public/data 主要文件 | 需要 mapshaper |
| `kde_density.py` | 核密度 | |
| `walking_pilot.py <roads_dir>` | 步行试点路线 | 道路资料不在仓库，需要用户提供 `Kyoto_Roads_GeoJSON.zip` |
| `fetch_photos.py` | 景点照片 | 联网；有缓存 |
| `fetch_names_en.py` | 英文名 | 联网（OSM API、Wikidata）；有缓存 |
| `prepare_tourism_stats.py` | 参观人次统计 | 读 Excel |
| `fetch_explore_photos.py` | Explore 区块照片 | 有缓存的 meta；图片缓存不在 Git |
| `prepare_bus_routes.py` | 巴士索引和走法文件 | 读 `data/raw/bus_package` |
| `compose_music.py [out_dir]` | 作曲并渲染背景音乐 | 需要 fluidsynth、fluid-soundfont-gm、mido |

### 4.4 数据之间的关联键

| 关联 | 键 |
|---|---|
| 景点 / 站点记录 | `id`（A00001…、S00001…，永不改变）；`osm_id` |
| 点 → 市区町村 | `point_municipality.points[id]` = N03 代码（如 `26105`）；名称 `names[code]`，英文 `names_en.municipalities[code]` |
| 英文名 | `names_en.json` 按 `id`；加载时写入新字段 `name_en`、`name_en_source`、`osm_element`，原字段不动 |
| 照片 | `photos.json.photos[attraction_id]` |
| 步行结果 | `walking_routes` 的 `attraction_id`、`stop_id`、`stop_type`、`route_status` |
| 参观人次 | 市町村英文名（`muniTourism()`）；京都市各区显示的是全市合计 |
| 巴士路线 | `route.key`（如 `kto00300`）连接路线目录、票价、走法 |
| 巴士站 | 官方站点键 `bsNNN`；`index.stops[bs].points` = 地图点候选（按站名匹配，未逐个核实）；反向 `index.point_stops[S…]` |
| 巴士走法 | `variant.id` = OSM 路线关系 ID；文件 `bus/variants/<id>.json` |
| 票价 | `route.key`；示例行程票价按 `journey_id` |

---

## 5. 功能与当前状态（按实际代码和测试）

✅ = 已实现且有自动测试　◐ = 已实现，部分未测或有限制　✗ = 未实现

### 5.1 地图与数据
- ✅ 底图：自定义配色的 OSM 矢量底图（明暗两套）；可切换 GSI、OSM 栅格（Legend 面板内）。地名只保留城市和町名。
- ✅ 京都府边界发光 + 呼吸动画（暗色为淡紫白色，浅色为暖棕色）；市区町村虚线。
- ✅ 523 个景点按类别着色；5,479 个站点：缩小时小圆点，放大后显示图标（铁路 z9 起，公交 z13 起）。
- ✅ 搜索（日文、英文、ID、OSM ID）；景点类别、交通类型筛选；顶部计数实时更新。
- ✅ 悬停提示、选中标注（含照片）、打开 Dashboard 时地图从京都市中心展开。
- ✅ 名称格式统一为「日文 (English)」，无可靠英文名时只显示日文。

### 5.2 分析
- ✅ Attraction Density：KDE 结果（含图例）或标注为"仅视觉"的 heatmap；跟随类别筛选。界面写明不代表游客人数。
- ✅ Walking Access：试点 19 个景点，公交和铁路分开；距离滑块让路线逐步延伸、站点点亮；四种状态分开显示（在距离内 / 超出 / 无可连接路线 / 尚未计算）。
- ✅ 天气：所选地点 7 天逐小时预报、计划访问日期和小时（切换地点、标签、主题时保留）、30 分钟缓存、刷新、错误状态。

### 5.3 巴士路线动画（京都市营巴士）
- ✅ 入口 1：左侧 Analysis → Bus Routes → 选路线 → 选方向 / 走法 → 从起点播放。
- ✅ 入口 2：点地图上的巴士站 → 右侧 Bus Routes 标签页 → 列出经过该站的路线，每个方向写终点和下一站 → 从该站播放到终点。
- ✅ 先画浅色细线（全线），亮线沿走线延伸；到站时站点 70% → 115% → 100% 弹起并显示站名；经过的站保持点亮，未到的站保持低调。
- ✅ 结束后保留；点站点看站名和站序；Replay、Skip、Close route。
- ✅ 切换路线、方向或站点时立即停止上一段并清除高亮。
- ✅ 减少动画设置下直接显示完整路线。
- ✅ 没有走线的 16 条路线：只高亮关联站点，显示"Route animation not available yet"，不画线。
- ✅ 票价从独立票价包按 `route.key` 读取。
- ✗ **没有暂停按钮，没有速度控制**。速度固定（约 900 m/s，单段 5–22 秒）。
- ◐ 停站顺序只有 EX100、EX101 经官方核对，其余以 OSM 为准。

### 5.4 界面
- ✅ 布局：先找地点再看详情。左侧（搜索、筛选、分析入口）、中间地图、右侧详情（照片、名称、类别、所在地 + 标签页 Overview / Bus Routes / Walking Routes / Weather / Journeys & Fares）。Technical Details 折叠。
- ✅ Data & Sources、Journeys & Fares 弹出面板；状态标签集中在 Data & Sources。
- ✅ 两侧面板可收起；地图上有 Study area、Legend。
- ✅ 明暗主题：首次跟随系统，手动选择后记住；切换不影响任何选择和分析状态。
- ✅ 主题开关：拖动滑块 / 点击 / 键盘；点阵图标散开再聚合；光弧；水波 + 三圈波纹扩散；3–5 片樱花花瓣。
- ◐ 水波扩散依赖 View Transitions API（Chrome / Edge / 新版 Safari），旧浏览器直接切换。动画画面本身没法截图验证，只验证了启动和结束。
- ✅ 背景音乐：默认不播放，按下才下载；暂停、音量、记住音量；精确循环。
- ◐ 音乐本身只做了数据检查（无削波、无断音、接缝平滑），**没有人实际听过评估**。
- ✅ 手机：左侧为抽屉（Explore 按钮），详情为底部面板，可收起；Explore 卡片可拖动；功能导览条改为上下展开。
- ✅ 减少动画设置：花瓣、波纹、卡片动画、巴士动画都会关闭或简化。

### 5.5 Explore、开场、结尾
- ✅ 樱花滚动开场（5 段文字、Skip、`#dashboard` 直达）。
- ✅ Explore Kyoto：7 张真实照片（清水寺、産寧坂、嵯峨野竹林、平等院、天橋立、伊根の舟屋、嵐電），模糊照片背景随选择淡入淡出，卡片翻面看署名，Explore Kyoto 按钮进入地图并飞到该地点。
- ✅ 功能导览条：6 块面板，按钮跳到对应功能。
- ✅ 结尾四格视频 + 团队名单。

---

## 6. 关键实现说明

### 6.1 巴士路线动画（`MapView.jsx` 中 `busRun` 的 effect；`App.jsx` 中 `startBus` / `highlightBus` / `closeBus`）

**数据准备**（`scripts/prepare_bus_routes.py`）：
- 读取资料包的 `route_shapes.geojson`（175 条 LineString）和 `ordered_stops.json`（按走法 ID 的有序站点）。
- **停站顺序不是自动计算的**：直接采用资料包里 OSM 路线关系的顺序（`stop_sequence`）。每个站在线上的位置 `route_progress`（0–1）也由资料包预先计算。
- 本项目只做检查，不改坐标：
  - 顺序是否严格递增；
  - 沿线位置是否倒退；
  - 站点离线超过 60 m 的标记 `review`。
  交接时 0 条被标记。
- 输出 `bus/index.json`（路线目录、走法摘要、各走法的站点键顺序 `order`、站点 → 路线、地图点 → 站点、票价、覆盖）和每个走法一个 `variants/<id>.json`（`line` 坐标、`stops[]`：`seq`、`key`、`ja`、`en`、`xy`、`p`、`off`、`review`）。

**按需加载**：选中走法时才 `fetch` 对应文件，缓存在 `busCache`。`busToken` 保证快速切换时只有最后一次选择生效。

**播放逻辑**：
- `startIdx`：从站点出发时，取该站在这个走法里第一次出现、且不是终点的位置；从路线出发时为 0。
- `p0 = stops[startIdx].p`。先把全线画进 `bus-full` 图层（浅色细线）。
- `fitBounds` 到从 `p0` 到终点的部分，等 1.3 秒让镜头停稳。
- 每帧计算进度 `frac`，从 `p0` 到 1，用 `cut()` 截出 `p0..frac` 这段写入 `bus-lit` 图层（亮线 + 光晕）。
- 时长 = 剩余长度 ÷ 900 m/s，限制在 5–22 秒。
- 某站 `p <= frac` 时：加 `passed`（保持点亮）、`now`（显示站名），并重新触发 `pop` 动画（CSS `busPop`：0.55 秒，70% → 115% → 100%）。
- 结束或 Skip：`paint(1, true)`，全部站点点亮，`onBusProgress({done:true})`。
- 站点标注是 MapLibre Marker（DOM 按钮）；点击切换 `pinned`，显示站名和"stop N of M"。
- Replay：用新的 key 重设 `busRun`，effect 重跑。Close：`busToken++`，清空状态和图层。
- 减少动画：直接 `finish()`。

**没有走线的路线**：`highlightBus()` 把路线目录里的无序站点键 → 地图点候选 ID，写入 `bus-hl` 图层的 filter（圆圈描边），并 `fitBounds`。

**配色**：`theme.js` 的 `busLine`（暗色 `#7df0b4`，浅色 `#0c8f5c`）；CSS 变量 `--bus`。

### 6.2 步行路线动画
`paintReach()`：以 380 m/s 把每条路线截到当前距离；站点在路线到达时点亮。`startFlow()` 用 dasharray 步进做流动光。

### 6.3 主题切换不丢状态
`MapView` 的 `[basemap, theme]` effect 只移除并重建 `bm-*` 底图图层（插在第一个数据图层之前），再用 `restyleData()` 改数据图层的颜色。数据源、筛选、选中、步行和巴士图层都不重建。

### 6.4 已知的技术陷阱（之前踩过）
- MapLibre 的 `style.load` 可能先于 `load` 触发：两处都用 `if (!map.getSource('attractions'))` 防止重复加图层，否则开场动画不会运行。
- 开场期间 `.app.waiting .map { visibility: hidden }`：否则软件渲染环境下地图合成会卡住主线程约 2 秒。
- 视频用 `loadAsBlob()`：Python 和 PowerShell 的静态服务器不支持 Range，直接用 URL 无法随滚动拖动进度。
- 测试里不要无限等待 `map idle`（呼吸动画会让地图一直重绘），要加超时；Playwright 点击正在做入场动画的元素时可能滚动页面。
- CSS 里不要让变量引用自己（`--walk-bus: var(--walk-bus)` 曾导致颜色失效）。
- id 不能重复：Explore 区块是 `#explore`，左侧面板是 `#explore-panel`。

---

## 7. 最近的修改（按时间倒序，来自 git log）

| 提交 | 内容 |
|---|---|
| `797d108` | 巴士路线动画；**手机端修复**：站名标签 `width: max-content; max-width: min(240px, 70vw)` 并省略过长文字；手机上 Replay / Skip / Close 按钮最小高度 40 px；方向按钮加大点击区 |
| `4356f59` | Explore 改为居中封面流 + 模糊照片背景；功能导览条；暗色主题改为深蓝紫风格；主题水波；原创背景音乐；修复 `--walk-bus` 变量 |
| `c077048` / `58ff0bc` | Explore Kyoto 区块与照片 |
| `29e3006` / `5a3f752` | 明暗主题开关；先找地点再看详情的布局；参观人次统计 |
| `c55b97d` | 英文名对照；卡片模糊动态背景 |
| `767c96a` | 自定义矢量底图、交通图标、开场揭示动画 |

---

## 8. 已知问题、未完成功能、待核实事项

### 8.1 功能缺口
- 巴士动画**没有暂停和速度控制**（用户在交接要求中提到，但目前代码没有）。
- 官方 GTFS 未使用：ODPT 下载需要开发者账号的 `acl:consumerKey`（放在网址参数里）。用户如果要用，需要自己注册下载后上传 ZIP。**不要把 key 写进代码或提交到仓库。**
- 16 条巴士路线没有走线：快速5、快速6、快速9、13、快速15、16、42、69、快速93、立命館ダイレクト、立命館、南1、西1、特西3、西9、四条烏丸→みぶ。
- 有走线的路线也不保证方向和支线齐全（资料包只保证每个编号至少一个走法）。
- 27 条多区间票价路线只有官方票价表链接，没有逐站金额。
- 步行分析只覆盖祇園–清水试点 19 个景点；扩展到全府需要道路资料和人工检查。
- 浅色模式下，Dashboard 本体还是米色纸张风格，没有和 Explore 区块的白色磨砂风格统一（需要问用户）。
- 用户手册（Claude Docs：https://claude.ai/artifact/AwPeeXKAfmpUrNhqnJT3ee）停在旧布局，没有包含 Explore、功能导览条、音乐、巴士路线。

### 8.2 显示问题（含手机端）
- 手机（390 宽）：靠近屏幕边缘的站点，站名标签可能超出屏幕约 3 px。
- 主题开关在页面滚动到开场与 Dashboard 之间时，可能暂时压在右侧面板上方。
- 切换主题后，地图选中标注里的小色点要重新选中才会换色。
- 只在 Playwright Chromium 测过；**Safari、真实手机、平板宽度没有测过**。

### 8.3 数据待核实
- 地图巴士站点与官方站点按站名对上，707 个官方站点中 649 个有多个候选点（常是不同方向的站台），未逐个核实。
- 巴士停站顺序：只有 EX100 / EX101 经官方核对；资料包验证时排除了 21 个断开或反向的关系、12 个站名不匹配、2 个站点不足、2 个运营者不符。
- 英文名覆盖：景点 125 / 305、站点 2,558 / 5,479。祇園–清水试点里 5 个日文名景点没有英文名（石塀小路 ×2、寧寧之道、五条坂、ぎをん思いで博物館），A00202 的 "Seiryu" 可能不完整。
- OSM 资料快照日期没有确认。
- 开场 AI 视频画面看起来像东京目黑川，用户已接受，界面标注为示意影像。

### 8.4 其他
- 主 JS 1.09 MB（gzip 309 KB），没有做代码分割。
- `docs/TEST_REPORT.md` 是 2026-11-09 的旧报告，没有包含之后的功能；最新测试结果以本文件第 0 节为准。
- Windows 启动器（`windows/*.bat`、`serve.ps1`）没有在真实 Windows 上测试过。

---

## 9. 开发、测试与部署

```bash
cd demos/kyoto-gis-dashboard
npm install
npm run dev                  # http://localhost:5173
npm test                     # 逻辑测试（21 项）
npm run build                # 生成 dist/（约 33 MB，含视频和数据）
npm run preview              # http://localhost:4173
npm run build:preview-artifact   # 生成 dist-artifact/（在线预览版：无底图瓦片、关闭天气）
```

浏览器测试（需要 Playwright 和 Chromium；先启动 `npm run preview`）：

```bash
# tests/e2e.mjs 直接 import 'playwright'；若是全局安装，可改用 createRequire 并设定 PW_PATH：
PW_PATH=$(npm root -g)/playwright node tests/e2e.mjs http://localhost:4173/ test-output
```

测试要设合理超时，不要等待地图完全静止或所有网络请求结束。测试的检查项包括：开场、Explore 拖动、功能导览条、音乐、数据文件、坐标位置、筛选、KDE、步行、天气（成功或失败两种状态）、巴士路线、主题切换、花瓣、手机布局。

### 部署状态
- **没有部署到公开网站**（没有 GitHub Pages、Netlify 等）。
- 在线预览（claude.ai Artifact，只读演示）：https://claude.ai/artifact/1uA5cNqwEKV8MMxE7WKfbi，版本 15，与提交 `797d108` 一致。在线预览不能加载外部瓦片和天气，所以没有底图、天气显示为"已关闭"。
- 早期 demo：https://claude.ai/artifact/5Zc6qrjcHUDbyqesbWH68Z（不要修改）。
- Windows ZIP（`site/` + `source/` + 启动器）只在上一个云端环境的临时目录里生成过，**不在仓库中**。重新生成方法：`npm run build` 后把 `dist/` 放进 `site/`，`git ls-files` 的内容放进 `source/`，加上 `windows/` 里三个文件。
- 部署方式见 README 第 2 节：`dist/` 是纯静态网站，`base: './'` 可放在任何子路径。不能直接双击 `index.html`（浏览器会阻止读取本地 JSON）。

### 恢复到交接版本
```bash
git fetch origin ccr-bd068911-ydjxlc
git checkout faf1ebe                       # 只读查看交接时的版本
git switch -c restore-handoff faf1ebe      # 从这个版本开新分支
git diff faf1ebe -- demos/kyoto-gis-dashboard   # 查看之后改了什么
```

---

## 10. 设计原则（不要随意改）

- **暗色主题**是默认：近黑深蓝紫底、淡紫白柔光、细浅色边框、磨砂玻璃面板；地图边界发光 + 呼吸。用户明确要求保留发光边界和呼吸动画。
- **浅色主题**：米白、浅米灰、暖棕点缀，日式旅游的柔和感。
- 景点类别在两种主题下色相一致。
- 动画要克制：不要强烈闪烁、爆炸、连续弹跳；所有动画都要支持减少动画设置。
- 开场的日式图片和设计感标题放在开场和介绍部分；分析区以地图和易读文字为主。
- 用户偏好"先确认方案再动手"：大的视觉改动或新功能，先说明借鉴什么、怎么衔接。

---

## 11. 下一阶段建议任务（按优先级）

1. **巴士动画补暂停和速度控制**（用户在交接要求里提到）：在 `.bus-bar` 加 Pause / Resume 和 0.5× / 1× / 2×；在 `MapView` 的帧循环里记录已播放进度，暂停时停止 `requestAnimationFrame`，恢复时从当前 `frac` 继续。补 e2e 测试。
2. **真实设备测试**：iPhone Safari、Android Chrome、平板宽度（768–1180 px）。重点看底部面板、巴士控制条、站名标签、主题开关位置。顺便修掉标签超出 3 px 的问题。
3. 如果用户提供官方 GTFS ZIP：检查 `shapes.txt` 与 `trips.txt` 的对应，用官方停站顺序核对或替换 OSM 顺序；补上 16 条无走线的路线（仅在有可用走线时）。
4. 询问用户是否把浅色模式 Dashboard 统一成 Explore 那种白色磨砂风格。
5. 更新用户手册（Claude Docs 链接见 8.1）和 `docs/TEST_REPORT.md`。
6. 让用户试听背景音乐，按反馈调整。
7. 可选：代码分割（例如巴士和天气组件懒加载），减小首屏 JS。
8. 可选：部署到 GitHub Pages 或学校服务器（需要用户同意）。

---

## 12. 2026-11-12 更新（本节优先于上文）

分支 `ccr-bd068911-ydjxlc`，提交 `118697f` → `318f52d` → `e9c6054` → `6ace642` → `b8652e0` → `7057ba7`，以及本节所在的文档提交。功能说明见 README 6f 节。

| 项目 | 状态 |
|---|---|
| 逻辑测试 `npm test` | **21 / 21 通过** |
| 构建 | 通过；主 JS 约 1.1 MB；CSS 308 KB（gzip 92 KB，大部分是字体子集声明）；dist 约 43 MB |
| 浏览器测试 `tests/e2e.mjs` | **77 / 77 通过**（Playwright 1.64.1 + Chromium，桌面 1440×900、手机 390、减少动画各一页；本次天气 API 正常返回）。新增全府步行、季节、English first、位置说明、名称用字、和风元素、手机顶部栏的检查 |

**新增和修改的数据**
- `public/data/walking_routes_prefecture.geojson`、`analysis/walking_prefecture_table.csv`、`analysis/walking_prefecture_report.json`：由 `scripts/walking_prefecture.py` 生成（需要 numpy、scipy；道路资料不在仓库）。
- `public/data/attraction_context.json`：由 `scripts/prepare_context.py` 生成；缓存文件 `data/cache/osm_is_in_unnamed.json`（Overpass，OSM 基准时间 2026-11-12）。
- `public/data/season_kyoto.json`：气象厅季节定义和京都平年值，写明来源、访问日期和窗口规则。
- 试点文件 `walking_routes.geojson` 保留在仓库里备查，Dashboard 不再加载。

**已知问题 / 待核实**
- 全府步行结果没有逐条人工核对，界面上已注明。
- "3 km 内没有站点"的结果中，有些可能只是 OSM 缺少京都市以外的民营巴士站。
- 天橋立ビューランド山顶的 12 个点：OSM 里没有连到山下的步行道路（现实中坐缆车或单轨上山）。
- OSM 英文名疑似拼写错误：公交站「嵯峨嵐山駅前」的 name:en 写成 "Saga Arashima Station"。按原则保留原样、没有修改，可以到 OSM 上修正后再重跑。
- 166 个 Unverified 记录中，有 89 个不在任何有名称的 OSM 范围内，需要人工判断（卫星图或现场）。
- 赏樱期和赏枫期是根据平年值推算的近似范围，不代表当年树木的实际状态。2026 年的枫树红叶日还没有观测到（截至 11/12）。
- 季节粒子只用 Chromium 内核测过；Safari 的 `mask-composite` 写法已加上 `-webkit-` 前缀，但没有实际测试。
- 运行 e2e：Playwright 不是项目依赖，可以装在任意位置，再用 `PW_PATH=<那里的 node_modules/playwright> node tests/e2e.mjs http://localhost:4173/ test-output`；先执行 `npm run preview`。
- `npm install` 时，npm 11 跳过了 esbuild 的 postinstall 脚本（`npm install-scripts ls` 可查看）；构建正常，未做处理。

**下一步建议**
1. 在 Safari、真实手机和平板上检查季节粒子、和柄遮罩（`mask-composite`）和明朝体。
2. 人工检查步行分析的问题清单：Unverified 89 个、府界标记 62 个、台阶和不确定道路类别。
3. 原第 11 节的巴士动画暂停和速度控制仍然没有做。

## 13. 2026-11-13 更新：新开场（本节优先于上文）

- 原来的 AI 樱花视频开场（`Intro.jsx`、`sakura_scroll.mp4`、`sakura_poster.jpg`）已删除，改成两页：第 1 页樱花视频（`Landing.jsx`）、第 2 页四季卡片（`SeasonStory.jsx`），说明见 README 6b。
- 季节按钮从地图顶栏移到左上角，固定显示，和音乐按钮同样式。区块之间加了渐变和"霞"过渡。
- 测试：逻辑 21 / 21，浏览器 86 / 86（`PW_CHANNEL=msedge`；Playwright 自带的 Chromium 不能解码 H.264 视频，所以要用 Edge 跑）。
- **待处理**：四季图片来自 Pinterest，原作者不明，只限课业使用；公开部署前要换成有授权的图片。秋、春两张的标题字是修图去掉的。
- 视频处理方式：因为这个环境不允许运行下载的 ffmpeg，改用 Edge 的 WebCodecs 逐帧编码，再自己写 MP4 封装。脚本没有放进仓库；需要重新生成时可以直接用 ffmpeg：`ffmpeg -i 345013.mp4 -an -vf "crop=2160:1215:0:1235,scale=1920:1080,fps=30" -c:v libx264 -crf 18 -g 30 -movflags +faststart cherry-1920x1080.mp4`（竖版去掉 crop，改成 scale=1440:2560）。

