# Kyoto City Bus fares

Standalone fare reference for 105 Kyoto City Bus route entries. Checked on 12 November 2026. Amounts are standard single-ride fares in Japanese yen.

| Route fare type | Entries | Adult | Child |
|---|---:|---:|---:|
| Standard flat | 76 | ¥230 | ¥120 |
| Sightseeing Limited Express EX100 and EX101 | 2 | ¥500 | ¥250 |
| Multi-section | 27 | Varies by stop pair | Varies by stop pair |

- `bus_fares.json` contains one record per official route key. Route numbers are strings. Each entry includes the source URLs and applicable fare fields. Multi-section entries include their official fare chart page and planner link. Their adult and child amounts are null because a specific boarding and alighting stop pair is required. Individual stop-pair amounts have not been transcribed.
- `sample_journey_fares.json` contains the fares for the nine checked sample journeys, keyed by the `journey_id` field. These examples are part of the same route catalogue.

If using Claude Code, ask it to read this README and use these files as the separate fare reference. The official route key connects a fare to a route, and the journey ID connects a fare to a sample journey.

Sources are the [Kyoto City Bus fare guide](https://www2.city.kyoto.lg.jp/kotsu/webguide/en/fare/fare_bus.html), [Kyoto City Transportation Bureau ordinary fares](https://www.city.kyoto.lg.jp/kotsu/page/0000240682.html), and [official multi-section fare chart](https://www2.city.kyoto.lg.jp/kotsu/webguide/files/fare/non_flat_fare_table.pdf).
