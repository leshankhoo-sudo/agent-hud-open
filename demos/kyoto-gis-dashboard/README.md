# Kyoto Prefecture Tourism GIS Dashboard

> 新对话或接手开发前，请先读 [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md)：项目状态、数据清单、关联方式、已知问题和下一步任务。

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
npm test             # 21 项逻辑测试（使用真实数据文件）
# 浏览器测试：PW_CHANNEL=msedge PW_PATH=<playwright 位置> node tests/e2e.mjs http://localhost:4173/ test-output
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
python3 scripts/walking_pilot.py /path/to/Kyoto_Roads_GeoJSON   # Analysis 2：试点步行路线（旧，保留备查）
pip install numpy scipy
python3 scripts/walking_prefecture.py /path/to/Kyoto_Roads_GeoJSON  # Analysis 2：全府 523 个景点（Dashboard 使用这个）
python3 scripts/prepare_context.py              # 无名景点的身份、同一记录英文名、所在范围（离线，读缓存）
python3 scripts/fetch_photos.py                 # 景点照片（Wikidata / Commons，需联网）
python3 scripts/fetch_names_en.py               # 英文名称（OSM name:en / Wikidata，需联网）
python3 scripts/fetch_explore_photos.py         # Explore Kyoto 区块的照片（Wikimedia Commons，需联网）
python3 scripts/prepare_bus_routes.py           # 巴士路线目录、走法和票价（读取 data/raw/bus_package）
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
│  ├─ walking_routes.geojson                     试点步行路线（scope: pilot，旧，不再加载）
│  ├─ walking_routes_prefecture.geojson          全府步行路线（scope: prefecture，523 × 公交/铁路）
│  ├─ attraction_context.json                    无名景点的身份、同一记录英文名、所在范围
│  ├─ season_kyoto.json                          京都季节参考（气象厅平年值和窗口规则）
│  ├─ manifest.json                              记录数、哈希校验结果、构建时间
│  └─ analysis/
│     ├─ density_kde.geojson / _meta.json        核密度结果与方法参数
│     ├─ walking_pilot_table.csv / _report.json  试点距离表和报告（旧）
│     ├─ walking_prefecture_table.csv            全府距离表（1,046 行，供核对）
│     └─ walking_prefecture_report.json          道路检查、网络检查、结果统计、假设与限制
├─ scripts/                      prepare_data.py, kde_density.py, walking_pilot.py, walking_prefecture.py, prepare_context.py 等
├─ src/                          App.jsx, MapView.jsx, Weather.jsx, Landing.jsx, SeasonStory.jsx, Panorama.jsx, Seam.jsx, MusicPlayer.jsx,
│                                lib/{data,weather,walking,season,depth,panoramaArt,gardenScene}.js, styles.css, depth.css
├─ tests/                        logic.test.mjs（npm test）, e2e.mjs（浏览器测试）
└─ docs/                         DATA_INTERFACES.md, TEST_REPORT.md
```

## 6. 操作说明（给老师演示用）

1. **顶部**：当前筛选后的景点数和站点数（例如 277 / 523），以及数据状态。数字都是"初步记录数"，不是官方统计。
2. **左侧**：
   - 搜索：可以按名称、A00001、S00019 或 OSM ID 搜索。
   - 筛选：景点四个类别、交通三种类型（公交 / 铁路 / 电车）。
   - Analysis 1：在 KDE 结果和 Visual heatmap 之间切换。
   - Analysis 2：步行距离滑块、公交 / 铁路切换、记录范围（Named / OSM-tagged / Unverified），统计全府记录。
3. **地图**：拖动、缩放，点击点位即可选中。缩小时站点是小圆点；放大后铁路站（第 9 级起）和公交站（第 13 级起）会变成图标，图标重叠时会自动让位，下面的小圆点仍然保留。打开 Dashboard 时，地图会从京都市中心向外慢慢展开。
4. **右侧**：选中记录的名称、ID、类别、所属市区町村；步行结果（全府所有景点）；天气预报（可选日期和小时，有刷新按钮）。
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

## 6c. Explore Kyoto 区块

位置在樱花滚动开场之后、Dashboard 之前（原来的开场没有改动）。

- 七张京都府内的照片：清水寺、産寧坂、嵯峨野竹林、平等院、天橋立、伊根的舟屋、嵐電。竖版卡片排成"封面流"：中间一张大，两侧依次变小。点中间的卡片会翻到背面，显示照片作者和许可。卡片下方的小标签显示该地点 1 公里内的景点和站点记录数（来自本项目数据）。
- **Explore Kyoto** 按钮：滚动到 Dashboard，并把地图移到所选地点。旁边的"or see the whole prefecture"只滚动，不移动地图。
- 照片全部来自 Wikimedia Commons，由 `scripts/fetch_explore_photos.py` 生成：只接受 CC0、公有领域、CC BY、CC BY-SA；用照片坐标（没有时用对应 Wikidata 条目的坐标）对照 N03 边界确认在京都府内；作者、许可、来源链接写在 `public/data/explore_places.json`，页面上逐张显示。
- 这些是地区介绍用的照片，没有挂到任何景点记录上。景点详情里的照片仍然用原来的匹配规则。
- 照片加载失败时显示该照片的平均色渐变和文字说明。
- 布局参考了 ThreeUI 的 PocketQuestLandingPage（章节条、卡片选择、叠放卡片、圆形主按钮），没有使用它的代码、3D 场景、游戏和美术素材。

## 6d. 功能导览条、背景音乐、主题水波

- **功能导览条**（Explore Kyoto 和 Dashboard 之间）：六块竖长的玻璃面板。鼠标移上去的那一块横向展开，显示说明和一个按钮，点按钮直接打开 Dashboard 里对应的功能。手机上改成上下展开。
- **Explore Kyoto 现在的样子**：卡片居中，背景是当前照片的模糊版，换卡时背景跟着淡入淡出。左右拖动、点两侧卡片、箭头、圆点或键盘方向键都可以换卡；不再占用页面滚动。
- **背景音乐**：右上角主题按钮左边的“庭院小窗”（`src/MusicPlayer.jsx`，场景在 `src/lib/gardenScene.js`）。默认不播放，开始播放时才下载音乐；会记住音量。
  - 外形是一个药丸形的小窗，里面是夜里的和室和庭院；上面有一颗玻璃球，左右拖动就是音量，按一下玻璃球是播放 / 暂停。把玻璃球往右拖会直接开始播放。
  - 平时缩小显示在主题按钮旁边；鼠标移上去、键盘聚焦或拖动时放大。玻璃球会放大它下面的画面。
  - 场景跟着音量变化：静音是月夜、猫在睡觉；音量升高后依次点亮蜡烛、对面的障子窗、天花板的灯和石灯笼，铁壶冒蒸汽，叶子开始飘落，风铃摆动；接近最大音量时，一只狐狸会从庭院探头进来。烛火和落叶还会跟着音乐当下的响度起伏。
  - 树的颜色和飘落物跟随季节主题：春＝樱花和花瓣，夏＝绿叶和萤火虫，秋＝红叶，冬＝积雪和雪花。
  - 键盘和读屏：有一个真正的按钮（播放 / 暂停）和一个真正的滑块（音量，方向键调节）。
  - 交互想法参考了组员提供的一段“有住人的音量条”演示视频；场景、画法和行为都是为本项目重新做的，全部用 Canvas 画，没有用任何外部图片。
  - 曲子《Kyoto, Slowly》是为本项目写的原创曲，由 `scripts/compose_music.py` 逐个音符生成：G 大调、80 BPM、48 小节，约 2 分 25 秒。
  - 用 FluidSynth 和 FluidR3_GM 采样音源（MIT 许可）渲染。重新生成需要安装 `fluidsynth`、`fluid-soundfont-gm`、`mido`。
  - 循环：尾音叠回开头，并在缓冲区内按精确采样点循环，没有接缝。
- **主题切换的水波**：切换明暗时，三圈波纹从按钮处荡开，新主题跟着一圈柔边的波铺满屏幕。
- **暗色主题**：改成近黑的深蓝紫底、淡紫白柔光、细浅色边框。京都府边界的发光和呼吸动画保留，颜色改成淡紫白。

## 6e. 巴士路线动画（京都市营巴士）

- **范围**：只有京都市交通局的市营巴士这一家运营商，不是京都府所有巴士。
- **两个入口**：左侧 Analysis 里的 Bus Routes（选路线，再选方向或走法）；或者点地图上的巴士站，在右侧的 Bus Routes 标签页里看经过该站的路线和方向，从这一站开始播放。
- **动画**：先用浅色细线画出全线，再让亮线沿道路走线延伸到终点。线头到站时，站点从 70% 放大到 115% 再回到 100%，并显示站名。经过的站保持点亮。结束后路线保留，可以 Replay、Skip、Close route。系统开了"减少动画"时直接显示完整路线。
- **数据来源**：走线和停站顺序来自 OpenStreetMap 的路线关系（ODbL），**不是官方 GTFS**。只有 EX100、EX101 的停站顺序另经官方资料核对。官方 GTFS 需要 ODPT 开发者账号的访问密钥，本项目没有使用。
- **覆盖**：路线目录 105 条；其中 89 条有走线，共 175 个方向或走法、4,617 个停站记录。其余 16 条没有可用走线，只高亮关联的站点，并显示"Route animation not available yet"，不画线。
- **票价**：来自独立的票价包，按官方路线编号关联。76 条均一票价，2 条观光特急，27 条按上下车站计价（只给官方票价表链接，没有逐站金额）。
- **站点对照**：地图上原有的巴士站点是按站名和运营商的站点列表对上的，同名站可能是不同方向的站台，没有逐个核实。
- 数据由 `scripts/prepare_bus_routes.py` 从 `data/raw/bus_package/` 生成到 `public/data/bus/`，每个走法一个小文件，选中才加载。

## 6b. 开场：樱花视频 + 四季卡片（2026-11-13 起，取代原来的 AI 视频开场）

**第 1 页（`src/Landing.jsx`）**
- 樱花水道视频静音循环播放。电脑（横屏）全屏播放 16:9 版 `media/cherry-1920x1080.mp4`，是从 4K 原文件中间裁出来的，不是放大；手机（竖屏）播放 `media/cherry-1440.mp4`（1440×2560）。都是 30fps、无声，各约 19 MB，各有一张封面图。两个版本都用 Edge 的 WebCodecs 逐帧重新编码，没有掉帧。
- 视频：Kanenori，Pixabay（Pixabay Content License）。来源没有写拍摄地点，所以界面上不写是哪里。
- 上面叠着：磨砂导航（Seasons / Places / Map / Data / Team）、项目名、简介、三个数字（直接读取数据）、两个液体按钮、组员名单、视频署名。
- 液体按钮（`WaterButton`）：磨砂玻璃按钮。鼠标移上或用键盘聚焦时，半透明的乳白色液体涨到约 93%。液面由弹簧点组成：鼠标从哪里进来，那里就会溅起波纹；在按钮上移动时液面会晃动，波纹会传开、慢慢平息。液面有一条高光线，字会从白色变成深墨色。开启"减少动画"时只做简单的填满。

**第 2 页（`src/SeasonStory.jsx`）：四季卡片**
- 春（寺院与樱花）、夏（千本鸟居）、秋（塔与红叶）、冬（雪中竹林）四张竖卡并排；手机上改成上下排列。图片在 `public/season/`。
- **京都当下的季节那张会突出显示**：卡片更宽、全彩，带 "Now in Kyoto" 标记。另外三张一样会动，但加了电影感滤镜（降饱和、压暗、胶片颗粒），鼠标移上去时滤镜会退掉一些。点任一张卡片会切换整个网站的季节主题，点当季那张则回到自动。
- **滚动时景色会移动**：每张图配一张估算的深度图（Depth Anything V2 Small，离线生成）。WebGL 让近景放大、移动得比远景快，像往里面走。深度图的近景往外扩了一圈，避免边缘撕裂和拉伸。
- 卡片里的字是季节英文加日文（例如 "AUTUMN 秋"），统一用 Shippori Mincho，放在场景里的某个深度，所以更近的树枝、鸟居、竹子会挡在字前面。每季效果不同：春＝春霞和粉色渐层；夏＝阳光扫过字面；秋＝红色从字底往上"染红"；冬＝深藍字、顶上有积雪、从模糊变清楚。
- 卡片下方的叙事文字随滚动依次出现，数字滚动到 523 和 5,479；当季的粒子（花瓣、叶子、萤火虫、雪）分三层深度飘落。
- 图片来源：组员从 Pinterest 找的，原作者不明，**仅供课业使用**，界面上标为示意图（illustrative），不是经过核实的某个地点的照片。秋、春两张原本印着标题字，为了四季统一字体已经修掉。**公开部署前应更换成有授权的图片。**

**季节按钮**：和音乐按钮同样样式的圆形按钮，固定在左上角，鼠标移上去会展开显示当前季节；点开可以看判断依据，也可以手动选季节。

**区块之间的过渡（2026-11-13 第二次修改）**：原来的做法是把整个区块的上下边缘用遮罩淡出，再叠一条模糊的“霞”。这会让区块边缘的标题、照片说明和地图署名一起变淡、变糊，所以已经删掉。现在的做法见下面的 6g。

## 6g. 纵深和视差、全景、清晰的交界（2026-11-13）

- **统一的视差驱动（`src/lib/depth.js`）**：给每个区块写三个 CSS 变量：`--mx`、`--my`（鼠标相对窗口中心的位置，-1 到 1，带缓动）和 `--p`（区块在窗口里的滚动位置，-1 到 1）。各层在 `src/depth.css` 里把它们换算成位移，近的层动得多，远的层动得少。
  - 只对正在画面里的区块写变量；数值静止时不运行；触屏不响应手指位置；系统设了“减少动态效果”时完全不运行。
  - 位移用独立的 `translate` / `rotate` / `scale` 属性，会和原有的 `transform` 动画叠加，不会互相覆盖。
- **各页的层次**：
  - 第 1 页：视频是远景（滚动时走得慢并略微推近），文字是中景，几片失焦的花瓣是最近的一层，随鼠标移动最多。
  - 第 2 页：四张季节卡片整排朝鼠标方向轻微转动，卡片里的景深视差也加大了。
  - Explore：模糊背景、标题、卡片堆、说明栏各自移动不同的距离，卡片堆会朝鼠标转一点。
  - 功能导览条：每块面板里的光晕比文字更“靠后”。结尾页：四段影片各自错开，卡片浮在上面。
  - 地图 Dashboard 本身没有加视差，避免影响操作。
- **全景页（`src/Panorama.jsx`，图形在 `src/lib/panoramaArt.js`）**：在四季页和 Explore 之间。九层平面剪影：星空、月亮、远山、近山（山腰有“大”字）、霞、町屋和塔、有鸟居的小山、霞、石灯笼和伸进画面的树枝。鼠标左右移动时各层错开，像转头看风景；滚动时各层上升速度不同。
  - 树枝和山上的树跟随季节：春＝樱花，夏 / 秋＝枫叶，冬＝积雪。
  - 天空顶部接着上一页的深色，底部淡出到页面底色；浅色主题下是“夜色到黎明”。所以它同时也是深色开场和后面内容之间的过渡。
  - **这是为本项目画的示意图**（固定随机种子生成的几何图形），不按比例，地标只是符号，不是地图数据。页面上有英文说明。
- **区块交界（`src/Seam.jsx`）**：Explore → 功能导览条 → 地图 → 结尾之间各有一条分隔，自己占一段高度，不压在任何内容上。中间是一个圆形印记（読 / 図 / 結）和下一段的名字，两侧的细线在滚到窗口中间时向外展开，背景是平涂的霞带（大和绘里的“すやり霞”），随滚动和鼠标错开。全部是清晰边缘，没有模糊。
  - Explore 只让模糊背景层在上下边缘淡出，文字和卡片保持清晰；结尾页不再整块淡出。
- **顺带修正**：
  - 液体按钮和玻璃球的弹簧改成固定步长计算，在慢的电脑上不再变成慢动作。
  - 四季卡片在开发模式（`npm run dev`）下不再变成白块（原因是 React 开发模式会把效果挂载两次，而被主动释放的 WebGL 画布不能重新使用）。

## 6f. 2026-11-12 更新：全府步行、给外国游客的英文、四季、和风

**全府步行分析**（`scripts/walking_prefecture.py`，约 1.5 分钟）
- 523 个景点全部计算，方法和试点完全一样（按道路类别判断能否步行、只在共用节点连通、EPSG:6674、3 km 上限、80 m/分）。试点的 38 条结果中有 36 条完全相同；唐子の間的 2 条原来"无法到达"，现在改连到街道上，所以有了结果。
- 没有结果时会写明原因：3 km 内没有站点（可能是 OSM 缺站）／没有连上街道网（目前 12 条都在天橋立ビューランド山顶，OSM 里山顶步道和山下不连通）／离道路太远（4 个）。
- 景点最近的路段如果是没连上街道的小碎片（例如寺院内部步道），会改连到 150 m 内主路网上最近的一段，接入距离单独列出、不加进步行距离，界面上有标记。
- 府界标记：只有当府外道路比结果更近时才标记（邻县的站点不在数据里）；海岸线不算府界。
- Sagano Romantic Train 和トロッコ嵯峨站接到同一个街道点，界面显示 "Next to this place"，不显示成 0 m。
- 每条路线都记录台阶长度，界面显示 "Includes steps"。
- 界面：记录范围筛选 Named 305 / OSM-tagged 52 / Unverified 166（Unverified 默认关闭）；五种状态分开统计；超过 150 条路线时不播放延伸动画，站点改用地图圆圈标记，避免卡顿。

**无名景点（218 个）**（`scripts/prepare_context.py`，离线读取缓存）
- 52 个在 OSM 同一记录上有 name:en、wikidata、官网等标签，其中 47 个显示该记录自己的英文名（不翻译、不罗马字化）。
- 97 个位于有名称的 OSM 范围内（Overpass is_in，缓存在 `data/cache/osm_is_in_unnamed.json`），显示为 "Inside the grounds of 金閣寺 (Kinkaku-ji)"。这只是位置关系，不代表这个点就是那个地方。
- 其余只有分类标签的点标为 Unverified。

**给外国游客**
- 顶部 "English first" 开关：Golden Pavilion (金閣) ⇄ 金閣 (Golden Pavilion)，会记住选择。
- 详情里的 "In the name"：解释名称里的常用字（寺 Buddhist temple、神社 Shinto shrine、前 in front of……），只解释字义，不翻译整个名字，也不标读音。

**四季**（`src/lib/season.js`、`public/data/season_kyoto.json`）
- 按京都的日期（东京时间）判断季节，不用浏览者所在的位置。月份采用气象厅的定义：春 3–5 月、夏 6–8 月、秋 9–11 月、冬 12–2 月。
- 赏樱期 3/19–4/11、赏枫期 11/10–12/12，由京都地方气象台的平年值（1991–2020）推算：樱花开花 3/26、满开 4/4、银杏黄叶 11/24、枫树红叶 12/5。推算规则写在数据文件里，属于近似值。12 月上旬仍然显示秋季主题。
- 顶部的季节标签会说明今天的判断依据和资料来源，也可以手动切换季节，方便演示。
- 季节只改变强调色和飘落元素：春天樱花瓣、夏天青枫叶（暗色时是萤火虫）、秋天红枫叶、冬天细雪。用在主题切换和 Explore 区块。地图、边界发光、类别颜色都不变。开启"减少动画"时关闭。

**和风细节**
- 和柄都是本项目自己画的几何图形：顶部栏的麻の葉、空状态和加载画面的七宝、弹出面板的市松、分隔用的水引。颜色跟随季节，不放在地图和数据上。
- 选中的标签页做成暖帘的样子；类别圆点换成印章（名、景、館、城、停、駅）。
- 标题和地名改用 Shippori Mincho 600（SIL OFL）；内文仍用 IBM Plex。日文字形分成子集按需加载，dist 因此多出约 8.4 MB 的字体文件。

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
- Analysis 2（2026-11-12 起为**全府**，见 6f 节；以下是当初试点的记录）：
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
- 步行分析已扩展到全府（6f 节），但结果没有逐条人工核对；入口位置、步道断点、trunk 道路的假设仍待检查。
- 景点入口位置：目前用的是 OSM 点，不是入口。
- 示范行程的 `attraction_id` / `stop_id` 核实与连接：需要人工逐条确认。
- OSM 资料快照日期：仍未确认。
- 去重规则（同名记录、重复 OSM ID）：需要你决定。
- 三维显示：没有真实地形或建筑数据，暂不做。

## 8. 重要限制

- **景点和站点**：都是 OSM 初步记录，不是官方完整名单，也没有到现场核实。
- **天气**：Open-Meteo 的模型网格估计，不是景点现场的观测值。相邻的点可能落在同一个网格，得到相同的预报。
- **步行**：道路资料没有 foot / access / sidewalk 标签，能否步行是按道路类别**假设**的（详见 `walking_prefecture_report.json`）。另外，试点结果不能当作全府结果使用。
