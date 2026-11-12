# Kyoto GIS Dashboard · 巴士资料总包

研究区为 Dashboard 自带的京都府行政边界 kyoto_boundary.geojson（MLIT N03，2026）。官方 GIS 线图层已按此边界筛选和裁切。动画的 175 个走法与其站点均已检查在边界内。

| 文件夹 | 文件 | 用途 |
|---|---|---|
| 01_Boundary | kyoto_boundary.geojson | Dashboard 原始 Site Boundary。 |
| 02_Official_GIS | mlit_n07_bus_segments_in_site.geojson | 日本国土交通省 N07 2022 官方线图层。府内共 5,987 个路段要素，其中 N07_001 = 京都市 有 999 个。可作为公交覆盖背景。 |
| 02_Official_GIS | Official_Route_Map.url | 京都市交通局官方路线图网页，可查全线路图和旅游版 PDF。 |
| 03_Routes_and_Stops | Kyoto_City_Bus_Routes.xlsx、bus_routes.json、bus_stop_crosswalk.json、sample_journey_check.json、validation_summary.json | 105 个京都市巴士路线条目、707 个官方站点编号、与 Dashboard 地图点位的对照和 9 条示例行程的核对。Excel 用于查阅，JSON 用于路线搜索和站点高亮。 |
| 03_Routes_and_Stops | dashboard_bus_points_in_site.geojson | Dashboard 原有的 5,229 个巴士停靠站及总站点位记录，保留原 ID。 |
| 04_Fares | bus_fares.json、sample_journey_fares.json | 独立票价资料。78 个固定票价条目、27 个多区间票价表页码和查询入口。 |
| 05_Animation | route_shapes.geojson、ordered_stops.json、coverage.json | 89 个巴士编号、175 个走法的道路走线、逐站顺序、动画触发进度和覆盖清单。 |

## 给 Claude Code

1. 用 03_Routes_and_Stops 的路线目录做路线筛选与站点高亮。站点关系是无序集合。同名站可有多个候选站台。
2. 用 05_Animation 做路线逐段显示和到站弹出。按 variant_id 关联两个文件，按 route_progress 触发站点弹出。走线和停站顺序来自 OpenStreetMap。EX100、EX101 的顺序另经官方资料核对。覆盖范围为每个编号至少一个走法，具体方向或支线请查看 coverage.json 与 GeoJSON。
3. 用 04_Fares 补充票价，以 route_key 关联。多区间票价需要指定上下车站。
4. 用 02_Official_GIS 显示官方历史线图层。N07 按运营者记录道路，缺少路线编号、方向和停站顺序。该层的数量是路段要素数。

## 来源

- Site Boundary 使用原 Dashboard 所附的日本国土交通省 MLIT N03 2026 京都府边界。
- 官方 GIS 线图层来源为 [日本国土交通省 N07（2022）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html)，许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。本包按 Site Boundary 裁切并输出 WGS84 GeoJSON。
- [京都市交通局官方线路图](https://www.city.kyoto.lg.jp/kotsu/page/0000019770.html) 可在线查阅。路线目录和站点对照采用交通局时刻表与 Dashboard 站点层。
- 动画数据来源为 [© OpenStreetMap contributors，ODbL](https://www.openstreetmap.org/copyright)。每个走法带有 OSM relation 链接。完整官方 GTFS 未包含在本包。
- 票价按 2026 年 11 月 12 日核对。多区间路线的具体站对金额未逐一录入。
