# Kyoto Prefecture Tourism GIS Dashboard

大学 GIS 项目原型。界面英文，说明中文。范围暂定为**京都府（Kyoto Prefecture）**，不是京都市。

技术：React 18 + Vite 5 + MapLibre GL 4（无需账号的栅格底图）。数据处理：Python（pyproj、shapely、networkx）+ mapshaper。

---

## 0. Windows 最简单的方式

下载 `Kyoto-GIS-Dashboard-Windows.zip`，解压后双击 `Start-Dashboard.bat`，不需要安装任何软件。详细步骤见 ZIP 里的 `README-Windows.txt`（源文件在 `windows/` 文件夹）。

## 1. 运行

需要 Node.js 18 以上。

```bash
cd demos/kyoto-gis-dashboard
npm install
npm run dev          # 开发模式，打开 http://localhost:5173
npm test             # 13 项逻辑测试（使用真实数据文件）
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
| 地理院タイル（GSI，pale） | 默认底图 | 不需要 | 免费，需显示出处（页面右下角已显示）。详见 https://maps.gsi.go.jp/development/ichiran.html |
| OpenStreetMap 标准瓦片 | 备选底图 | 不需要 | 社区服务器，有[使用政策](https://operations.osmfoundation.org/policies/tiles/)，只适合低流量。不保证可用于正式生产 |
| Open-Meteo Forecast API | 天气 | 不需要 | 非商业用途免费，有每日、每小时请求上限（[terms](https://open-meteo.com/en/terms)、[pricing](https://open-meteo.com/en/pricing)）。数据按 CC BY 4.0 授权，页面已注明出处 |

页面为了显示效果，会把底图在显示时反色、调成深蓝。瓦片本身和上面的地理内容都没有改。

## 4. 数据处理（可重跑）

```bash
pip install pyproj shapely networkx openpyxl
npm i -g mapshaper          # 或设定 MAPSHAPER=/path/to/mapshaper
python3 scripts/prepare_data.py     # 校验原始文件 → 生成 public/data
python3 scripts/kde_density.py      # Analysis 1：正式核密度
python3 scripts/walking_pilot.py /path/to/Kyoto_Roads_GeoJSON   # Analysis 2：试点步行路线
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
3. **地图**：拖动、缩放，点击点位即可选中。金色虚线框是步行试点范围。
4. **右侧**：选中记录的名称、ID、类别、所属市区町村；步行结果（只有试点记录才有）；天气预报（可选日期和小时，有刷新按钮）。
5. **顶部按钮**：
   - "Sample journeys & fares"：示范行程与参考票价面板。
   - "Data & sources"：资料来源、更新时间和数据质量说明。

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
- 示范行程与票价：独立面板，9 条行程全部列在"尚未连接地图"之下。票价、运行条件、来源年份、核实状态和官方链接都完整显示。
- 资料来源与更新时间面板。手机、平板、电脑三种布局。

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
