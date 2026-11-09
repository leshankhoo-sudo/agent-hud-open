# 测试报告（2026-11-09，云端开发环境）

## 1. 资料读取检查

| 文件 | 结果 |
|---|---|
| 资料包 `Kyoto_Claude_Starter_Package.zip` | 15 个文件全部解压并读取；7 个数据文件的 SHA-256 与 `file_manifest.json` 一致 |
| `attractions.geojson` | 523 条记录（attraction 156 / viewpoint 246 / museum 102 / castle 19）；218 条无名；无重复 OSM ID；ID A00001–A00523 |
| `transport.geojson` | 5,479 条记录（bus_stop 5,215 / bus_station 14 / railway_station 240 / railway_halt 8 / tram_stop 2）；28 条无名；OSM ID 2771085349 重复（S00395、S00396） |
| `kyoto_boundary.geojson` | 999 个 N03 多边形，36 个市区町村/区，坐标系 EPSG:6668 |
| `sample_journeys.json` | 9 条行程，attraction_id / stop_id / walking_distance_m 全部为 null |
| `walking_routes.geojson`（原始） | 空，status `NOT_CALCULATED` |
| `Kyoto_Sample_Routes_and_Fares_EN.xlsx`（单独上传） | 与资料包内副本逐字节相同；Route Data 有 9 行，比 JSON 多出 Mode、Service type、Fare basis、Conditions 等列 |
| `Kyoto_Tourism_Data_EN.xlsx`、`Kyoto_OSM_GIS_Data.xlsx`、PDF | 已读取，仅作备查，没有并入地图 |
| 道路 `Kyoto_Roads_GeoJSON.zip` | 5 个分片：43,915 + 43,035 + 52,541 + 53,662 + 7,571 = **200,724** 条，osm_id 全部唯一 |
| 道路 `Kyoto_Roads_Shapefile.zip` | 200,724 条，osm_id 集合与 GeoJSON 完全相同；WGS84 坐标，UTF-8 编码 |

**道路资料**
- 字段：osm_id, code, fclass, name, ref, oneway, maxspeed, layer, bridge, tunnel。
- 坐标范围：经度 134.84196–136.07323，纬度 34.67986–35.77858。
- 几何类型：全部为 LineString。
- 桥梁 10,681 条，隧道 2,130 条。
- 没有 foot / access / sidewalk 字段。

## 2. 单元测试（`npm test`，13/13 通过）

- 记录数、类别数与 `data_inventory.json` 一致。
- 筛选计数：
  - 景点：全部 523；museum 102；castle + museum 121；不选任何类别 0。
  - 站点：bus 5,229；rail 248；tram 2；rail + tram 250。
- ID 唯一，所有坐标都在京都府范围内，并按 [经度, 纬度] 顺序存放。京都站 S00019 位于 34.9853, 135.7588。
- 空间连接：6,002 个点全部落在某个 N03 多边形内。京都站 → 京都市 下京区，金閣 A00265 → 京都市 北区。
- KDE 参数：半径 2,000 m，网格 500 m，EPSG:6674；密度 × 面积的总和为 499.5（共 523 个点，差额来自边缘损失）。
- 示范行程：9 条保持未连接；票价、条件和来源都完整。
- 步行：
  - 资料包的原始空文件 → 显示"不可用"。
  - 试点结果：38 行，0 行无效；每条成功路线的网络距离都不小于直线距离；公交和铁路分开计算；A00172 无法到达，距离为 null。
- 天气：
  - 请求参数正确。
  - HTTP 429、API 错误、网络中断都会报错，不返回任何数值。
  - null 值保持为 null。
  - 缓存在 30 分钟内命中，过期后重新请求；刷新按钮会绕过缓存。

## 3. 浏览器测试（`tests/e2e.mjs`，Chromium，25/25 通过）

- 10 个数据文件全部返回 HTTP 200；地图数据源里有 523 个景点和 5,479 个站点。
- 底图瓦片（GSI）全部加载成功。
- 地图位置：在 S00019 和 A00265 各自坐标对应的屏幕位置，确实能查询到这两个要素。
- 筛选：
  - 取消 Viewpoint 后，顶部显示 277 / 523。
  - 取消 Bus 后显示 250 / 5,479，地图上不再有公交点和 viewpoint 点。
- 密度：KDE 图层能开启，图例写明了方法参数；heatmap 模式标注为 display only。
- 步行：
  - 非试点记录显示 "Walking analysis not yet available"。
  - A00230 显示到公交站 S00602 75 m、到铁路站 S01877 749 m，地图上画出两条路线。
  - A00172 显示 unreachable，没有距离。
  - 覆盖率统计的分母是 19。
- 天气：
  - 选中景点后，浏览器向 Open-Meteo 发出了请求。
  - **这个云环境的出口 IP 当天已超出 Open-Meteo 免费额度，返回 HTTP 429。** 页面显示 "Weather unavailable: Open-Meteo HTTP 429: Daily API request limit exceeded"，没有显示任何温度。
  - 另外模拟了断网，页面同样只显示错误。
  - 因此，**成功取得预报的情况本环境没能测到**。请在你自己的电脑上，或部署后确认一次（详见第 4 节）。
- 示范行程面板：9 条行程，Linked to map: 0，¥230 / ¥500，周末限定条件和来源链接都显示了。
- 资料来源面板：ODbL、N03、Open-Meteo 出处、哈希校验全部一致、重复 OSM ID 提示。
- 手机宽度 390 px：没有横向滚动。整个过程没有页面错误。

## 4. 请你在自己电脑上确认的事项

1. `npm run dev` 打开页面后选一个景点，右侧应出现天气预报，内容包括：当前模型值、7 天日期选项、"Forecast valid for …"、"Retrieved …"。
2. 30 分钟内再选同一个点，应显示 "from 30-min cache"。点 Refresh 会重新请求。

## 5. 步行试点结果摘要（祇園–清水，19 条有名称的记录）

- **网络规模**：
  - 裁剪范围：试点框外扩约 2.5 km。
  - 范围内道路段 20,048 条，其中使用 19,968 条：步行类 11,318、普通道路 8,220、不确定类 430。
  - 排除 80 条（motorway / motorway_link / busway）。
  - 建成的网络有 77,303 个顶点，分成 196 个互不相连的片段，最大片段有 74,976 个顶点。
- **候选站点**：公交 652 个、铁路 34 个，全部成功贴到道路上。
- **结果**：公交 18 条成功 + 1 条无法到达；铁路 18 条成功 + 1 条无法到达。
- **发现的问题**：
  - A00172 唐子の間：贴到的步道（OSM way 760892268）属于一个只有 63 个顶点的孤立小片段，和街道网没有共享顶点。这很可能是庭园或寺院内部的路径，需要人工核对入口。
  - 去清水五条站的 4 条路线（A00202、A00220、A00230、A00477）：有 20–96% 的路程走在 trunk / trunk_link 五条通上。实际上五条通很可能有人行道，但数据里没有标签，所以标为不确定。
  - 隧道和桥梁比例很低（1–3%）。A00138 先斗町到公交站的路线有 42% 在桥上（四条大桥一带）。
- **范围声明**：这只是试点，**没有**完成京都府全府的步行分析。
