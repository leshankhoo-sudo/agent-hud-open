# Kyoto Prefecture Tourism GIS Dashboard

大学 GIS 项目原型。界面英文，说明中文。范围暂定为**京都府（Kyoto Prefecture）**，不是京都市。

技术：React 18 + Vite 5 + MapLibre GL 4（底图无需账号）。数据处理：Python（pyproj、shapely、networkx）+ mapshaper。

---

## 0. Windows 最简单的方式

下载 `Kyoto-GIS-Dashboard-Windows.zip`，解压后双击 `Start-Dashboard.bat`，不需要安装任何软件。详细步骤见 ZIP 里的 `README-Windows.txt`（源文件在 `windows/` 文件夹）。

## 1. 运行

需要 Node.js 18 以上。

```bash
cd demos/kyoto-gis-dashboard
npm install
npm run dev          # 开发模式，打开 http://localhost:5173
npm test             # 15 项逻辑测试（使用真实数据文件）
npm run build        # 生成 dist/ 静态网站
npm run preview      # 本地预览 dist/，http://localhost:4173
```

`public/data/` 里已经放好了处理后的数据，直接运行即可。只有当原始资料改变时，才需要重跑第 4 节的处理脚本。

## 2. 部署

`npm run build` 生成的 `dist/` 是纯静态网站（约 5 MB），可以放到任何静态主机：

- **GitHub Pages**：把 `dist/` 的内容推到 `gh-pages` 分支，或在仓库 Settings → Pages 里选择该分支。
- **Netlify / Vercel**：Build command 填 `npm run build`，Publish directory 填 `dist`，Root directory 填 `demos/kyoto-gis-dashboard`。
- **学校服务器**：把 `dist/` 整个文件夹上传即可。`vite.config.js` 设置了 `base: './'`，放在任何子路径下都能运行。

注意：不能直接双击 `dist/index.html` 打开，浏览器会阻止它读取本地的 JSON 文件。请用 `npm run preview` 或任意本地服务器打开。

## 3. 外部服务：账号、key、费用、额度

| 服务 | 用途 | 账号 / API key | 费用与限制 |
|---|---|---|---|
| OpenFreeMap（OSM 矢量瓦片） | 默认底图 "Night" | 不需要 | 免费、无需账号，需显示出处（页面右下角已显示）。详见 https://openfreemap.org |
| 地理院タイル（GSI，pale） | 备选底图 | 不需要 | 免费，需显示出处（页面右下角已显示）。详见 https://maps.gsi.go.jp/development/ichiran.html |
| OpenStreetMap 标准瓦片 | 备选底图 | 不需要 | 社区服务器，有[使用政策](https://operations.osmfoundation.org/policies/tiles/)，只适合低流量。不保证可用于正式生产 |
| Wikidata / Wikimedia Commons | 景点照片（构建时抓取并打包，浏览器不连外网） | 不需要 | 免费；每张照片按授权标注作者与授权，只使用 CC0、公有领域、CC BY、CC BY-SA |
| Open-Meteo Forecast API | 天气 | 不需要 | 非商业用途免费，有每日、每小时请求上限（[terms](https://open-meteo.com/en/terms)、[pricing](https://open-meteo.com/en/pricing)）。数据按 CC BY 4.0 授权，页面已注明出处 |

默认的 Night 底图是用 OpenFreeMap 的 OSM 矢量数据重新配色画出来的：深色陆地、青色水体、绿色公园、细线道路，地图上只保留少量城市名，不显示道路名和 POI 文字；地下河道和隧道也隐藏了。GSI / OSM 栅格底图在显示时会被反色、调成深蓝，瓦片本身和上面的地理内容都没有改。

## 4. 数据处理（可重跑）

```bash
pip install pyproj shapely networkx openpyxl
npm i -g mapshaper          # 或设定 MAPSHAPER=/path/to/mapshaper
python3 scripts/prepare_data.py     # 校验原始文件 → 生成 public/data
python3 scripts/kde_density.py      # Analysis 1：正式核密度
python3 scripts/walking_pilot.py /path/to/Kyoto_Roads_GeoJSON   # Analysis 2：试点步行路线
python3 scripts/fetch_photos.py                 # 景点照片（Wikidata / Commons，需联网）
python3 scripts/fetch_names_en.py               # 英文名称（OSM name:en / Wikidata，需联网）
python3 scripts/prepare_tourism_stats.py        # 参观人次统计（读取 data/raw/documents 里的 Excel）
```

道路资料（5 个 GeoJSON 分片，约 80 MB）**没有放进仓库，也不会加载进浏览器**。请把 `Kyoto_Roads_GeoJSON.zip` 解压到任意文件夹，再把路径传给脚本。

## 5. 目录结构

```
kyoto-gis-dashboard/
├─ data/raw/                     原始资料，未修改（已用资料包的 SHA-256 清单校验）
│  ├─ attractions.geojson/.csv, transport.geojson/.csv, kyoto_boundary.geojson,
│  │  sample_journeys.json, walking_routes.geojson（原始空文件）
│  ├─ documents/                 Excel / PDF 备查
│  └─ package_docs/              DATA_GUIDE.md、data_inventory.json 等说明
├─ public/data/                  浏览器读取的文件（由脚本生成）
│  ├─ attractions.geojson, transport.geojson     原样复制，ID 与坐标不变
│  ├─ municipalities_display.geojson             36 个市区町村，仅用于显示（简化 6%）
│  ├─ prefecture_outline.geojson                 府边界轮廓，仅用于显示
│  ├─ point_municipality.json                    每个点所属市区町村（用原始边界做的空间连接）
│  ├─ sample_journeys_display.json               示范行程 + Excel 中多出的列（按 journey_id 精确连接）
│  ├─ walking_routes.geojson                     试点步行路线（scope: pilot）
│  ├─ manifest.json                              记录数、哈希校验结果、构建时间
│  └─ analysis/
│     ├─ density_kde.geojson / _meta.json        核密度结果与方法参数
│     ├─ walking_pilot_table.csv                 试点距离表（19 景点 × 公交/铁路）
│     └─ walking_pilot_report.json               道路检查、网络检查、假设与限制
├─ scripts/                      prepare_data.py, kde_density.py, walking_pilot.py
├─ src/                          App.jsx, MapView.jsx, Weather.jsx, lib/{data,weather,walking}.js, styles.css
├─ tests/                        logic.test.mjs（npm test）, e2e.mjs（浏览器测试）
└─ docs/                         DATA_INTERFACES.md, TEST_REPORT.md
```

## 6. 操作说明（给老师演示用）

1. **顶部**：当前筛选后的景点数和站点数（例如 277 / 523），以及数据状态。数字都是"初步记录数"，不是官方统计。
2. **左侧**：
   - 搜索：可以按名称、A00001、S00019 或 OSM ID 搜索。
   - 筛选：景点四个类别、交通三种类型（公交 / 铁路 / 电车）。
   - Analysis 1：在 KDE 结果和 Visual heatmap 之间切换。
   - Analysis 2：步行距离滑块和公交 / 铁路切换，只统计试点的 19 条记录。
3. **地图**：拖动、缩放，点击点位即可选中。金色虚线框是步行试点范围。缩小时站点是小圆点；放大后铁路站（第 9 级起）和公交站（第 13 级起）会变成图标，图标重叠时会自动让位，下面的小圆点仍然保留。打开 Dashboard 时，地图会从京都市中心向外慢慢展开。
4. **右侧**：选中记录的名称、ID、类别、所属市区町村；步行结果（只有试点记录才有）；天气预报（可选日期和小时，有刷新按钮）。
5. **顶部按钮**：
   - "Sample journeys & fares"：示范行程与参考票价面板。
   - "Data & sources"：资料来源、更新时间和数据质量说明。

## 6a. 明暗主题与新版布局

- **主题按钮**：固定在浏览器右上角，滚动到哪里都在。可以拖动里面的滑块，也可以直接点击，或用键盘（Enter / 空格 / 左右方向键）。第一次打开跟随系统设置，手动切换后会记住。
- **切换主题只换颜色**：地图位置和缩放、选中的景点、筛选、密度图层、步行路线、计划访问时间都保留。
- **樱花花瓣**：拖动或点击按钮时，从按钮位置飘出 3–5 片花瓣，约 3 秒后自动清除。系统开启"减少动画"时不出现。
- **浅色地图**：仍然是真实的 OSM 矢量底图，只是换成米色、浅灰蓝、淡绿的配色。景点类别在两种主题下用同一色相，浅色主题用较深的色调。
- **左侧**：默认只有搜索和两组筛选。Attraction Density 和 Walking Access 是两个入口，点开才显示参数、图例和统计。
- **地图左上角**：Study area（回到研究范围）、Legend（图例和底图样式）。地图左右边缘的小把手可以收起两侧面板。
- **右侧**：选中后先显示照片、名称、类别、所在地，下面是标签页 Overview / Walking Routes / Weather / Journeys & Fares。Record ID、OSM ID、坐标等放在 Overview 里的 Technical Details。
- **参观人次**：Overview 显示所在市町村的公布数字（2025、2024 年），并注明这是市町村合计，不是该景点的人数。其余三张表（2015 年景点表、2023 年外国游客到访比例、二条城入场人数）没有和地图记录连接，放在 Data & Sources 里作为参考。
- **手机**：左侧变成抽屉（点 Explore 打开），详情变成底部面板，可以收起。

## 6b. 樱花滚动开场

页面最上方是一段滚动开场：
- **视频跟着滚动播放**：沿樱花水道前进 → 穿过石桥 → 抬头看樱花 → 天空变成深蓝。视频文件是 `public/media/sakura_scroll.mp4`。
- **花瓣是代码画的**：往回滚时花瓣也会正常往下飘；接近结尾时花瓣会变成蓝色光点。
- **文字依次出现**：研究范围、资料来源、两项分析。其中的数字直接读取 `manifest.json`。

视频是 AI 生成的示意影像，页面右下角有标注，不是某个真实地点的实拍。点 **Skip to dashboard**，或在网址后面加 `#dashboard`，可以直接跳到 Dashboard。

## 7. 已完成 / 待完成

**已完成**
- 真实底图（GSI / OSM）、京都府边界（N03）、523 个景点和 5,479 个站点，全部显示，保留原 ID 和日文名称。
- 类别和交通类型筛选，顶部计数实时更新，搜索。
- 点击查看详情：名称、ID、OSM 链接、类别、所属市区町村（空间连接）。无名记录和重复 OSM ID 都有提示。
- Open-Meteo 天气：
  - 按选中点的经纬度请求，时区 Asia/Tokyo。
  - 显示当前模型值、7 天逐小时预报、降雨概率和降水量。
  - 可选日期和小时，显示预报对应时间和获取时间。
  - 缓存 30 分钟，有刷新按钮。
  - 加载中、失败、缺值时各有对应状态，失败时不显示任何假数据。
- Analysis 1：正式核密度（Quartic 核，半径 2 km，网格 500 m，EPSG:6674，单位 records/km²），可以跟随类别筛选。另有明确标注为 visual heatmap 的显示模式。
- Analysis 2（**仅试点**）：
  - 范围：祇園–清水一带的 19 条有名称的记录。
  - 沿道路网分别计算最近公交站和最近铁路站：18 条成功，1 条无法到达（单独标记）。
  - 输出路线 GeoJSON 和距离表，已接入 Dashboard。
- 景点照片：54 / 305 个有名称的景点有照片（32 个名称一致的 Wikidata 条目，22 个相关地点，都在 300 m 内），每张都标注了作者、授权和来源；没有可靠配对的景点显示 "No verified photo"。
- 示范行程与票价：独立面板，9 条行程全部列在"尚未连接地图"之下。票价、运行条件、来源年份、核实状态和官方链接都完整显示。
- 资料来源与更新时间面板。手机、平板、电脑三种布局。
- 英文名称：景点、站点和市区町村统一显示为「日文名称 (English name)」，地图弹窗、搜索结果、详情面板都一样，也可以用英文搜索。
  - 原始名称字段不变，英文名放在新增的 `name_en`、`name_en_source` 字段里，数据文件是 `public/data/names_en.json`。
  - 英文名来源只有三种：OSM 的 `name:en` 或罗马字标签；同一个 OSM 对象关联的 Wikidata 英文标签；日文名完全相同、且距离在 300 m 内的 Wikidata 条目。
  - 不做机器翻译，找不到可靠英文名的只显示日文原名。
  - 目前有英文名的：景点 125 / 305（有名称的），站点 2,558 / 5,479，市区町村 36 / 36（官方罗马字名称）。
  - 逐条来源可以在 `public/data/analysis/names_en_review.csv` 核对。

**待完成 / 需要你决定**
- 步行分析扩展到全府：需要先人工检查试点的问题（入口、步道断点、trunk 道路），确认分类假设，再分区批量计算。
- 景点入口位置：目前用的是 OSM 点，不是入口。
- 示范行程的 `attraction_id` / `stop_id` 核实与连接：需要人工逐条确认。
- OSM 资料快照日期：仍未确认。
- 去重规则（同名记录、重复 OSM ID）：需要你决定。
- 三维显示：没有真实地形或建筑数据，暂不做。

## 8. 重要限制

- **景点和站点**：都是 OSM 初步记录，不是官方完整名单，也没有到现场核实。
- **天气**：Open-Meteo 的模型网格估计，不是景点现场的观测值。相邻的点可能落在同一个网格，得到相同的预报。
- **步行**：道路资料没有 foot / access / sidewalk 标签，能否步行是按道路类别**假设**的（详见 `walking_pilot_report.json`）。另外，试点结果不能当作全府结果使用。
