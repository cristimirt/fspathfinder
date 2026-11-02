# Fallen Sword Path Finder (proof of concept, levels 1-6200)

A modern replacement for the old RFSA "Reference Fallen Sword Areas" site. Plain HTML/CSS/JS, no database, no build step for the page itself.

## Hosting
The site is published to https://cristimirt.github.io/fspathfinder/ by `.github/workflows/pages.yml` on every push to `main` (it publishes the `site/` folder, including the committed `data.js` and `route.json`). One-time setup in the repository: Settings, Pages, Build and deployment, Source: GitHub Actions. After changing data, run `node tools/build-data.js` and commit the regenerated `site/data.js` and `site/route.json` before pushing.

## Run it
Open `site/index.html` in a browser (double-click works, it is all relative files). For local testing with a server: `node tools/serve.js` then http://127.0.0.1:48790/

## What it shows
- A left-side menu with one group per 1000 levels (1-999, 1000-1999, ... up to 6200, the highest level with areas); each group is split into pages of about 50 realms, always starting on a level divisible by 5 (`PAGE_SIZE` in `tools/build-data.js`). A "Go to level" box sits above the menu.
- One section per master realm (world map), realms laid out in rows by distance from the world map with the ELK "layered" layout (`site/vendor/elk.bundled.js`, elkjs 0.12.1, EPL-2.0, licence next to it), lines between areas that have stairs (straight segments, diagonals allowed, no curves). A row wider than the page is laid out again with fewer areas per row.
- Legend as in the original: master realm (double-border square), realm (rounded), dark realm (DR tag), continues on another page (dashed), special event (grey), portal / shop / quest / relic icons, colour by minimum level.
- Hover an area: info card (creatures with rank and race, shops with coordinates, quests, relics, portal coordinates, every exit with its tile coordinates). Click to pin it (adds "Route from/to here").
- Every area has a **Guide** and a **Wiki** link: small tabs under the node on hover, in the pinned card, and next to each master realm's heading.
- Search box (press `/`), and a route finder (shortest path over stairs and world-map exits, with the tile coordinates of every stair).

## Data
`data/raw/` holds what was collected through the browser (both sites sit behind Cloudflare, so plain HTTP requests get a 403). One file per batch of levels, picked up by prefix:
- `guide-*.tsv`: guide.fallensword.com realm list + each realm page (shops, relics, quests, creatures).
- `wiki-*.tsv`: wiki.fallensword.com page of each realm: world area, stairs / portals / shops / relics with `(x,y)`, notes, world-map exit tiles (`World Area` entries). The second column is the wiki page title used (batch 51-300) or the level (batch 1-50).
- `world-areas-*.tsv`: master realms (level, neighbours on the world map, nearest portal).

- `links-masters.tsv` / `links-stairs.tsv`: crawled from the guide's master realm pages and from the stairway links inside each realm's map (`.realmContainer`). **The guide is the source of truth** (the wiki is no longer updated): the list of master realms, which realms each world map opens, and every stairway with its tile come from here. The wiki only adds portals, shops, relics, world-map exit tiles and nearest-portal text. A realm's world is: its master's main-realm list, else the master fewest stairways away, else (below level 1001 only) the wiki's "Located in".

`node tools/build-data.js` turns them into `site/data.js`. Manual fixes live at the top of that file (`WORLD_OVERRIDE`, `ENTRY_OVERRIDE`).

## Helper userscript (route widget)
- `site/route.js` holds the graph and the route finder, shared by the website and the helper userscript (the Backpack Tools userscript, `fs_backpack_helper.js`, v1.7.0). After changing it run `node tools/sync-helper.js <path to fs_backpack_helper.js>`, which copies it between the `>>> route.js` / `<<< route.js` marker lines in the helper.
- `node tools/build-data.js` also writes `site/route.json` (routing data only, about 2.2 MB, 260 KB gzipped). The helper fetches it from `MAP_DATA_URL` (top of its route-finder section; still a placeholder until the site is on GitHub Pages). For testing, set `localStorage.FSB_mapUrl` in the game page to `http://127.0.0.1:48790/route.json` and run `node tools/serve.js`.
- The widget reads the player's position from the game (`GameData.player()`: `realm_id` is the guide's realm id, plus `master_realm_id` and `location`) and plans again when the area changes, and shortly after the player stops walking. Event-only areas are never used as a way through.

## Known gaps / assumptions
- Wiki data is player-maintained and can be out of date.
- Where a realm is entered from the world map comes from the wiki's `[World Area]` exits. Krul Island has none, so Mountain Path is set by hand.
- Route finder assumes world maps next to each other in the wiki's "World Area Navigation" can be crossed directly, and that stairs work both ways. A portal takes you to the world map of any master realm (cost 2 moves plus the walk to the portal), and Mountain Path can be reached for free from anywhere (cost 1), so a route may start with a walk to a nearby portal or a free teleport. Moves inside a realm are the straight-line distance between tiles (obstacles ignored); world-map walking is a flat estimate.
- Special event areas are those the wiki marks as event-only.
- Levels are added in batches of 200 (batch files `*-301-500*.tsv`, `*-501-700*.tsv`). In the 501-700 batch the wiki lists world-map exits as plain links, so `World Area` tags were added by script when the link names a master realm.
- Levels above 700 were collected automatically: `node tools/recv.js` receives the rows a browser crawl posts into `data/raw/`, `tools/fixwiki.js` normalises the wiki rows, `tools/ingest.js` runs both steps and rebuilds. Event-only areas are listed in `EVENT_NAME` in `tools/build-data.js`; the 701+ batches have not been checked area by area.
- Not yet done: hosting on GitHub Pages, an admin mode for moving areas and drawing connections by hand.
