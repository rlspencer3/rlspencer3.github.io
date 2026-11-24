# Hearthwood — architecture & module contracts

Hearthwood is a cozy, mobile-first 3D house-building game. Plain ES modules + three.js
(vendored, no build step), served as static files (GitHub Pages). Entry: `index.html` → `js/main.js`.

```
hearthwood/
  index.html            import map: "three" -> js/vendor/three.module.min.js, "three/addons/" -> js/vendor/addons/
  css/style.css         base layout + loading screen (core)
  css/ui.css            all UI styling (UI module)
  js/config.js          units, grid math, slot keys            (core)
  js/state.js           observable app state + event bus       (core)
  js/catalog.js         piece registry + categories            (core)
  js/geom.js            cached geometry helpers (meter UVs)     (core)
  js/materials.js       material library, textures, night glow, seasons
  js/world.js           placed pieces, undo/redo, save/load, template cache   (core)
  js/batcher.js         static batching: merges settled pieces into ~1 mesh per material   (core)
  js/camera.js          orbit camera + touch gestures          (core)
  js/builder.js         placement controller (tools, ghost, auto-roof, auto-gable)  (core)
  js/effects.js         pop-in tweens, dust puffs              (core)
  js/storage.js         localStorage slots, autosave, share codes (core)
  js/thumbs.js          palette thumbnails                     (core)
  js/main.js            bootstrap, render loop, dev showcase   (core)
  js/pieces/floors.js   foundations, floors, deck, path, steps, posts, beams, stairs, ladder
  js/pieces/walls.js    walls, gables, windows, doors, railings, fences, hedge
  js/pieces/roof.js     roof panels, corners, flat roof, chimney, skylight
  js/pieces/decor.js    furniture & garden items
  js/env.js             sky, sun/moon, lights & shadows, ground & scenery, day/night, seasons, weather, emitters
  js/audio.js           synthesized sound effects, ambience, generative music
  js/ui.js              all DOM UI
  js/blueprints.js      house templates, guided build mode, stamping
  js/pieces/gifts.js    the 10 thank-you gift pieces (Living Town; hidden in the tray until unlocked)
  js/town/              the Living Town (villagers, wishes, Cozy): 14 modules, see "Town" below and docs/LIVING.md
  css/town.css          all town styling (bubbles, cards, hearth chip)
  tools/shot.mjs        headless screenshot / test runner
  tools/harness.mjs     side-effect-free test harness (server, browser, openGame, injected helpers) shared by the regressions
  tools/batch-regress.mjs  static-batching regression test (node tools/batch-regress.mjs, ~6 min, exit 1 on failure;
                        HW_TOWN=1 runs it with the town's logic on: town=fresh&townrender=0)
  tools/town-regress.mjs   Living Town end-to-end regression (R1–R21 of docs/LIVING.md §13.4; --only=section, --batch)
  tools/town-brain.js / town-look.js / town-hud.js   per-package acceptance scripts (shot.mjs --script bodies)
  sw.js                 service worker (offline copy, one source per page load) — add every new file to its CORE list
  manifest.webmanifest  install-as-app manifest (start_url / scope / id "./", icons in icons/)
  README.md             how to play, and how to run / test the game
```

## Visual style (all modules)

Cozy, warm, storybook-but-solid. Chunky proportions, soft rounded feel, warm palette
(honey woods, creams, barn reds, sage, slate). Slightly stylized low-poly with soft procedural
textures — not photoreal, not flat-shaded toy. Everything should look good from 5–40 m away on a
phone. Prefer a few well-proportioned details (trim, sills, frames, caps) over many tiny ones.

## Units & grid (js/config.js)

| const | value | meaning |
|---|---|---|
| `CELL` | 2 | cell width/depth (m) |
| `LEVEL_H` | 2.5 | storey height (wall height) |
| `STEP` | 1.25 | half storey = gentle roof rise per cell |
| `BASE_Y` | 0.25 | top of a level-0 foundation (ground is y = 0) |
| `WALL_T` | 0.18 | wall thickness |
| `FLOOR_T` | 0.16 | floor slab thickness |
| `ROOF_T` | 0.14 | roof panel thickness |
| `EAVE` | 0.35 | roof overhang at eaves |
| `GRID_MIN..GRID_MAX` | -10..9 | inclusive cell range (40 m × 40 m lot centered on origin) |
| `MAX_LEVEL` | 4 | levels 0..4 — players see them as "Floor 1".."Floor 5" (never "level") |

`levelY(y) = BASE_Y + y * LEVEL_H` is the floor height of level `y`.

The Ladder-back Chair's seat tucks up to a table in the cell in front of it: `chairTuck(p, itemAt)` gives its code
('z' turned like the table, 'x' a quarter turn from it, '' no table) and `CHAIR_SEAT_Z[code]` its seat's local z
(0.9 / 0.66 / 0.05 m). Both the piece (decor.js) and the town's sitters (town/sim.js) read them, so a villager sits
just where the seat is drawn.

* Cell `(x, z)` spans world X `[x*CELL, (x+1)*CELL]`, Z `[z*CELL, (z+1)*CELL]`.
* Vertex `(x, z)` is at world `(x*CELL, z*CELL)`.
* Edge axis `'x'` at `(x, z)`: segment vertex(x,z) → vertex(x+1,z) (runs along +X at world Z = z*CELL).
* Edge axis `'z'` at `(x, z)`: segment vertex(x,z) → vertex(x,z+1) (runs along +Z at world X = x*CELL).
* Rotation `r` 0..3 = `r * 90°` about +Y. A piece's local **+Z** points along `DIRS[r]`
  (`r=0 → +Z, 1 → +X, 2 → -Z, 3 → -X`); its local **+X** points along `DIRS[(r+1)%4]`.

## Piece records (saved data)

```js
{ t: 'wall_window',  // piece type id
  x, y, z,           // cell / vertex / edge coords and level
  a: 'x' | 'z',      // edge axis (edge pieces only)
  r: 0..3,           // rotation (cell pieces: 0..3, edge pieces: 0 or 2 = flipped)
  h: 0..12,          // roof pieces: half-steps above levelY(y); gables: half-steps of rectangular wall under the slope
                     //   (records stop at y = MAX_LEVEL: a roof on the top floor's walls is y = MAX_LEVEL, h ≥ 2)
  s: 1 | 2,          // gables: rise in half-steps across the edge (1 gentle, 2 steep)
  m: 'clapboard',    // main material id (must be in def.mats)
  c: '#f7f3ea',      // main paint colour (only if def.paint and material paintable, or def.paintAlways)
  k: '#7a4b3a' }     // accent colour (doors, shutters, window frames) when def.accent
```

## Slots & layers

One piece per slot key. Keys are built by `K.*` in config.js.

| layer | slot | key | used by |
|---|---|---|---|
| `F` | cell | `F|x|y|z` | foundation, floor, deck, path, steps |
| `W` | edge | `W|a|x|y|z` | walls, windows, doors, gables, railings, fences, hedges |
| `B` | edge | `B|a|x|y|z` | beams (top of a level, can coexist with a wall) |
| `P` | corner | `P|x|y|z` | posts / columns |
| `R` | cell | `R|x|hs|z` with `hs = 2*y + h` | roof panels (one per cell per half-step) |
| `I` | cell | `I|x|y|z` | furniture, garden items, stairs, chimney |
| `D` | cell | `D|x|y|z` | rugs & floor decals (lie under the `I` item in the same cell) |

Placing into an occupied slot **replaces** the occupant (tap a wall with the window tool → window).

### Local frame of a piece's `build()` output

The world positions a wrapper group; `build()` returns geometry in LOCAL coordinates:

* **cell**: origin = cell center at `levelY(y)` (roofs: `levelY(y) + h*STEP`). Cell spans local X,Z ∈ [-1, 1].
  Rotation `r` applied by the world. Local +Z = "forward"/uphill/front.
  Level-0 ground pieces (path, garden items) must reach down to the ground: ground is local `y = -BASE_Y` when `p.y === 0`
  (use `p.y === 0 ? -BASE_Y : 0` as the base for things that stand on the ground, e.g. trees, path stones, fences, lamp posts).
  Items standing on a floor (furniture) use local y = 0 (the floor top).
* **edge**: origin = edge midpoint at `levelY(y)`. Local X runs along the edge (−1..+1), local Z is the wall normal
  (thickness centered on z = 0), Y up 0..`LEVEL_H`. For axis 'z' the world adds +90°; `r=2` adds 180° (flip).
  With `r=0`: axis 'x' edge → local +X = world +X, local +Z = world +Z; axis 'z' edge → local +X = world −Z, local +Z = world +X.
* **corner**: origin = vertex at `levelY(y)`.

Ground-standing edge pieces (fences, hedges) at level 0 should start at local `y = -BASE_Y`.
A level-0 wall with no foundation, floor or deck on either side gets a stone footing down to the ground (its
cache key gains `|g`); pieces built off the lot (palette thumbnails at x = 500) never get one.

### Roofs

* Roof panel underside runs from the **downhill** edge (local z = −1, y = 0) to the **uphill** edge (local z = +1, y = rise),
  thickness `ROOF_T` above the underside. `rise = def.roof.rise * STEP` (rise 1 = gentle ≈32°, rise 2 = steep ≈51° A-frame).
* `def.roof = { rise, kind }`, kind ∈ `'slope' | 'corner' | 'inner' | 'flat' | 'cap'`.
  * `corner` (outer hip corner): height at local (u, v) ∈ [−1,1]² is `rise * min((u+1)/2, (v+1)/2)`
    — low along local −X and −Z edges, peak at the (+X, +Z) corner.
  * `inner` (valley corner): `rise * max((u+1)/2, (v+1)/2)` — low only at the (−X, −Z) corner point.
  * `flat`: rise 0. `cap`: a self-contained top piece (e.g. pyramid), rise as declared. `roof_pyramid` is contextual:
    sides that meet another roof panel join it (no eave / top boards there); only open sides get an overhang.
* The builder auto-stacks: a slope placed uphill of another slope with the same `r` starts where that one ends;
  corners stack diagonally. Users can nudge with roof ▲▼ (`state.hOffset`, −8..+8 half-steps).
* Roofs over the top floor: records stop at y = MAX_LEVEL, so a roof resting on Floor-5 walls is stored as
  y = MAX_LEVEL lifted a storey (`lift` = 2 half-steps: h = autoRoofHeight(…, MAX_LEVEL + 1) + 2; ▲▼ can't take it below
  the lift). `world.validate` accepts roof bases up to hs = 2·MAX_LEVEL + 12 (storage keeps h ≤ 12, `MAX_PIECES`
  counts those slots).
* Roof visibility follows `p.y` (the level the roof was built from), so a whole roof hides together. A roof over the top
  floor's walls is grouped by world (y = MAX_LEVEL panels in neighbouring cells, diagonals too, whose h..h + rise spans
  meet): a roof whose lowest panel has h ≥ 2 gets `entry.level = MAX_LEVEL + 1`, so it hides in the Floor-5 cutaway;
  a roof touching a Floor-4 roof stays at MAX_LEVEL.
* A gable roof over a W-wide house: slopes of rotation r on the downhill half, rotation (r+2)%4 on the other half,
  stacked by `h`; the two top rows meet at the ridge with the same `hs + rise`.
* The chimney (layer `I`) is contextual: its stack grows (5 cm steps, never below the standard 4.3 m piece) until the
  cap clears every roof panel over its cell (hs from 2·y to 2·y + 14) by 0.5 m at the stack's uphill face, so a
  chimney tapped onto a roof near the ridge still pokes out. Its smoke emitter moves with it (`userData.emitterOffset`).

### Gables (`autoGable: true` edge pieces)

Placed on an edge under a roof slope that runs **along** the edge. The builder sets `h` (half-steps from `levelY(y)` to the
roof slope's base at that edge), `s` (the slope's rise) and `r` so that local +X points uphill. Shape: from local x = −1 to +1,
bottom at 0, top line from `h*STEP` (at x = −1) to `(h+s)*STEP` (at x = +1) — exactly the underside of the roof panel.
Over the top floor a gable takes the Floor-5 wall's slot as one tall piece (y = MAX_LEVEL, h ≥ 2: wall and triangle).
It copies that wall's material and colour (`builder._tallGable`); a Floor-5 window, door or any other non-wall piece
there makes the gable invalid ('🪟 That wall has a window — the gable would cover it') rather than covering it.

## Piece definitions (js/catalog.js `registerPiece`)

```js
registerPiece({
  id: 'wall_window', name: 'Window', cat: 'openings',
  slot: 'edge', layer: 'W',
  rot: 'flip',                 // 'four' | 'flip' | 'none' (defaults by slot)
  mats: ['clapboard', 'log'],  // allowed main materials, first = default; null for fixed-look pieces
  matGroup: 'wall',            // shared remembered material between similar pieces
  paint: true,                 // main colour applies when the material is paintable
  paintAlways: false,          // colour applies regardless of material (e.g. fabric furniture)
  accent: true,                // has accent-coloured parts (p.k)
  levels: [0, 4],              // allowed levels
  contextual: true,            // rebuild when neighbours (±2 cells, ±2 levels) change
  contextKey: (p, ctx) => '…', // REQUIRED for contextual pieces to be cached: string of the neighbour state that matters
  canPlace: (p, ctx) => true | 'reason',
  autoGable: false,
  roof: { rise: 1, kind: 'slope' },
  emitter: 'smoke',            // optional: env.js spawns particles (smoke) at the piece
  emitterOffset: [0, 3.2, 0],  // local offset of the emitter (a build() may set userData.emitterOffset on its root
                               // group instead, for a shape-dependent spot: kept by mergeByMaterial, read every frame)
  smokeAlpha: 1,               // optional: smoke opacity factor (the fire pit's thin wisp is 0.45)
  hidden: false,               // optional: not offered in the tray (catalog.piecesIn skips it); catalog.setHidden(id, h)
  gift: { job },               // Living Town gift pieces (js/pieces/gifts.js): the job whose villager gives it, or null
  walk: 'solid' | 'soft',      // Living Town nav: villagers walk round it (solid) or through it at a cost (soft)
  thumb: { … },                // record overrides used for palette thumbnails
  showcase: { … },             // record overrides used by ?showcase=
  icon: '🪟', desc: 'One-line description', sound: 'wood' | 'stone' | 'soft' | 'glass' | 'metal' | 'leaf',
  build(p, ctx) { return group; },
});
```

`ctx = { world, def, p, get(key) → neighbour record | undefined, defOf(record) → def }` — use `K.*` keys from config.js.

### build() rules

* Return a `THREE.Group` in the local frame above. Never add lights, never allocate textures per piece.
* Use geometry helpers from `js/geom.js` (cached) or cache your own geometry with `cached(key, make)`.
  Never dispose geometry or materials (they are shared).
* Use `mat(id, colour)` from materials.js for every material.
* The world merges meshes by material automatically (`mergeByMaterial`). Mark a mesh `userData.noMerge = true`
  only if it must stay separate. Settled pieces are then drawn by the static batcher (see *Static batching*):
  transparent materials, `noMerge` meshes, meshes with a non-zero `renderOrder`, custom `onBeforeRender`, extra
  vertex attributes or mirrored transforms are never batched. Never use layers 1 or 2 on piece meshes.
* Budget: typical piece ≤ ~1.5k triangles, big decor (trees) ≤ ~3k. Fewer distinct materials per piece = fewer draw calls.
* Builds must be deterministic (no Math.random without a seed derived from the record), because templates are cached.
* A piece's world object is `wrapper Group → [template clone]` (`entry.obj.children[0]` is the whole look). Don't
  add children to `entry.obj`; anything that animates it outside world mutations must use effects tweens or call
  `world.batcher.wake(entry.obj)` first (scale ≠ 1 and effects tweens are detected automatically).

## Materials (js/materials.js)

`mat(id, colour?)` → cached `THREE.Material`. `MATERIALS[id] = { id, name, group, paintable, color, swatch }`.
Groups shown in pickers: `wall`, `roof`, `floor`, `trim`. Group `misc` is for internal use (glass, leaves, …).
`PALETTE` = paint colours. `setNight(f)` (0 day → 1 night) drives glow of `windowGlass`, `lampGlow`, `ember`.
`setSeason(s)` tints `leaves`, `grass`, and in winter puts snow on every `roof`-group material (one shared shader
uniform). `withoutSnow(fn)` runs `fn` (e.g. a render call) with the snow switched off — palette thumbnails use it.
`ghostMat(valid)`, `blueprintMat(highlight)` for previews. Materials are shared and mutated in place by night /
season changes: never clone them per piece (the batcher relies on the same object being used everywhere).

Texture UVs are in **meters**. Texture periods: walls 2 m horizontally and 1.25 m or 2.5 m vertically
(clapboard boards are 0.25 m), floors 2 m × 2 m (planks run along local X), roofs 1 m × 1 m containing exactly
4 courses (0.25 m) along V — roof builders scale V so each panel holds a whole number of courses.

## State (js/state.js)

`state.set(patch)`, `state.on(fn(changedKeys))`. Keys: `tool` ('build'|'erase'|'paint'|'pick'), `pieceId`, `category`,
`level`, `rot`, `hOffset`, `drawMode`, `seeAll`, `mats` (matGroup → material id), `colors` (material id → colour),
`accent`, `paintMat`, `paintColor`, `paintTarget` ('main'|'accent'), `time` (0..1, 0.5 = noon), `timeFlow`,
`season`, `weather` ('clear'|'rain'|'snow'|'leaves'), `sound`, `music`, `shadows`, `quality` ('low'|'high'|'auto'),
`photoMode`, `blueprint`, `slot`, `village` (villagers & wishes on, default true), `chatter` (villager babble, default
true). Settings persist in localStorage (validated on load; writes debounced to at most one
per 600 ms and flushed on `pagehide` / hidden; `state.save()` writes now). Replace objects (`mats`, `colors`) — don't mutate.

Event bus `events.emit(type, detail)` / `events.on(type, fn)`:
* `world-change` {kind: 'add'|'remove'|'clear'|'load'|'undo'|'redo', p, prev, count} (`discardLast()` reports 'undo')
* `placed` {p, def, replaced}
* `sfx` {name, flavor, opts?} — names: place, replace, remove, paint, rotate, click, undo, level, error, success, open, close, camera, blueprint-step, blueprint-done,
  and the town's wish, wish-granted, move-in, gift, villager, hop; `opts` may carry `pitch`, `gain` (0..2) and `pan` (−1..1)
* `toast` {text, kind?: 'info'|'warn'|'success', ms?, action?: {label, fn}} — also sent once by storage.js when an autosave can't be written;
  with `action` the toast gets a button (and pointer events)
* `town-*` events of the Living Town (ready, homes, traveller, movein, wish, granted, expired, gift, cozy, status, fixed,
  passerby, readonly, savefail, day, showme, showme-end, intro, select, enabled): docs/LIVING.md §12.5
* `blueprint-progress` {id, done, total, stage, stageName} — `stageName` is the blueprint's own name for it (`bp.stageNames`)
* `history` {canUndo, canRedo} — after a batch (blueprint stamp, draw stroke), a load or `discardLast()` changes the undo stacks
* `ready` (app)

## App object (window.__hw, passed to every module's `init(app)`)

`THREE, scene, camera, renderer, world, rig, builder, effects, state, events, catalog, materials, storage,
params (URLSearchParams), errors, thumbnail(id, rec) → Promise<dataURL>, snapshot(maxWidth) → dataURL,
loadBuild(data, {record}), newBuild(), env, audio, ui, blueprints, town, modules, fps`. `town` is the Living Town's
TownAPI (see *Town*), or null when its module failed to load; `modules` holds every loaded module by name. `loadBuild` goes through `world.load` (`record: true`
= one undo step: the UI loads slots and share codes that way) and resets the floor view; it eases to `data.cam`, and data
without one (share codes) gets a view framing the build — its house, garden scenery aside — in the part of the screen
the UI leaves free (`rig.insets`).

Feature modules export `init(app)` returning an object (optionally with `update(dt)`, called each frame):
* `env.js` → `{ update(dt), heightAt(x, z), sunDir, night }` — owns lights/sky/ground; removes nothing of the world.
  Shadow maps are cached (`renderer.shadowMap.autoUpdate = false`): env re-renders them on world changes, effect
  tweens, light movement and every 12 frames. Anything else that animates shadow-casting objects should set
  `renderer.shadowMap.needsUpdate = true`.
* `audio.js` → `{ update(dt), play, unlock, render(name, opts), context, stats() }` — listens to `sfx` events and
  state. Ambience reads villager chatter (talkers, only while `state.chatter`) and work foley from
  `app.town.audible()`; `stats()` and the offline `render()` are for tests.
* `blueprints.js` → `{ list(), get(id), startGuided(id), stop(), stamp(id, {animate, record}), welcome(), update(dt), active(),
  selectNext({focus, quiet}), progress(), stages }`. `get(id)` → `{ id, name, emoji, desc, difficulty, style, cam, pieces,
  count, stageNames }`: `stageNames` (stage id → name) names each stage after what that blueprint puts in it ("Roof" vs
  "Roof & chimney", "Walls" vs "Ground-floor walls"; a blueprint def can override them); the guide HUD and the
  "✨ X done! Next: Y" toasts use it. Finishing a guided build sparkles and, after ~0.3 s, glides the camera (~1.6 s)
  to the blueprint's angle, pulled back until the house fits the free screen area; any camera input cancels the glide.
  The "welcome home" toast is only sent when there is no UI (the UI's guide card shows it instead).
  An animated stamp keeps waiting pieces at scale 0.001 with their inner group (`entry.obj.children[0]`) hidden until
  their pop-in (no draw calls; `entry.obj.visible` stays the level cutaway's). In guided mode `selectNext` turns the
  camera to face a piece that is on the far side of the house.
* `ui.js` → `{ update(dt), toast, open(page), close, showWelcome, ask, hud }` (`hud`: the town's hud, read-only, null
  without the town). `toast(text, kind, ms, action)`: with `action: { label, fn }` the toast gets a button.
  * Photo mode sets `state.seeAll = true` on entry and restores the saved `{level, seeAll}` on exit. It changes
    `seeAll` without moving the camera: it keeps `rig.goal.target.y` across the change, which the builder's floor view
    (`_applyLevel`) would otherwise reset to the floor height; the builder's V key does the same while in photo
    mode. Its '✂️ Peek inside' / '🏠 Whole house' pill toggles the cutaway (like V) and only shows when the cutaway
    would hide something (anything above the current floor).
  * The tool rail (`.hw-rail > .hw-rail-in > .hw-rail-group` × 2) is a CSS size container (`hw-rail`) spanning from
    under the top bar to the tray, its groups at the bottom. Container queries shorten the tools when room is short,
    then put the second group beside the first (not on landscape phones, where the tray sits beside the rail), then
    hide the labels. The camera's right inset
    (`rig.setInsets`) comes from the tools group's left edge, not the rail box. Browsers without container queries get
    the one-column rail, which can still run up past the top bar on very short screens.
  * Material chips (paint strip, build tray) carry `data-key`. A tapped chip's offset is remembered, and the
    re-rendered strip puts it back there, then scrolls the least it takes to show it whole (anchors older than
    600 ms are dropped).
  * Up to 300 px wide, the floor pill's arrows are 34 px wide, with tap areas reaching 6 px over the 'Floor N' label.
* `app.welcomeLot` — `world.version` right after the first-visit scenery lot was placed (unchanged version ⇒ only scenery).

World API: `new World(scene, { batch: false | batcherOptions })` (one-argument form still works; batching is on by default).
`add(rec, {record}) → entry|null`, `remove(key)`, `update(key, patch)`, `get(key)`, `entry(key)`, `keyOf(rec)`,
`normalize(rec)` (null for anything that isn't a record of a known type), `validate(rec)`, `hasFloor(x, y, z)` (something
to stand on in that cell on level y: the ground at y = 0, a floor / deck tile — not pergola rafters — or a flat roof laid
on that level), `edgeSupported(p, def?)` (can a fence, hedge or railing stand on that edge: always at y = 0; upstairs
when `hasFloor` holds for either cell beside the edge; a railing also on a full-height wall / opening — not a gable or
half wall — or a beam on the same edge one level down), `clear()`, `load(data)`,
`serialize()`, `undo()`, `redo()`, `discardLast()` (revert the last undo step without making it a redo — for gestures
that turned out to be accidental), `canUndo()`, `canRedo()`, `beginBatch()/endBatch()` (endBatch → true when it pushed an undo step), `buildPlaced(rec)`,
`buildLocal(rec)`, `signature(rec)` (template-cache key), `setView(level, seeAll)`, `pick(raycaster)`,
`tick(dt)` (called by main.js every frame; returns true when shadow maps must be refreshed), `batcher`,
`onRemount(from, to)` (hook: a piece's object was rebuilt in place — main.js moves its tweens),
`entries` (Map key → {key, p, def, obj, level}; `level` is the cutaway level: `p.y`, or MAX_LEVEL + 1 for a roof over the
top floor), `count`, `version` (bumps on every change). `validate` reasons are player-facing and use Floor wording
('Ground floor only', 'Only on Floor N', 'Not on the ground floor', 'Only from Floor N up', 'Not on the top floor',
'Only up to Floor N', '☁️ That’s as high as roofs go', 'Outside the lot', and for cozy & garden things (I / D layer) on
an upper level with nothing under them: '🪵 Needs a floor or deck under it up here'; for W-layer pieces outside
walls / openings — fences, hedges, railings — on an upper level that fail `edgeSupported`: '🪵 Needs a floor or deck
beside it up here'). `load` and undo / redo don't validate, and `update` (a repaint in the same slot) skips those two
rules, so older saves keep everything and stay paintable.
`load(data, {record: true})` is a single undo step; a non-recorded load resets both undo stacks and any open batch.
Unknown / malformed records in `load` data are skipped.

Template cache: `world.templates` (signature → merged template) is **read-only** for other modules. Templates used by
placed pieces are kept; unused ones stay for quick reuse up to `world.maxIdleTemplates` (160, least recently used
first; main.js lowers it to 80 on phones, 60 on weak phones) and are then disposed (on the next world change or
frame). Objects from `buildPlaced` / `buildLocal` share their template's geometry: keep them only while they are shown
(ghosts), never dispose their geometry.

### Static batching (js/batcher.js, `world.batcher`)

Settled pieces are drawn by merged meshes: one **render unit** per (shared material, receiveShadow, shadow mode) for
the whole lot (split into lot quadrants past ~131k vertices) and one position-only **shadow proxy** per 8×8-cell region.
The farmhouse frame costs ~130 draw calls in total instead of ~650 (~1,250 on frames that redraw shadows).

* Batches live in the scene group `world-batches`, never inside `world.root`. The pieces' own meshes stay in
  `world.root` but move to **layer 1** (`LAYER_BAKED`: never rendered, still pickable — `world.pick` enables it on its
  raycaster). Shadow proxies use **layer 2** (`LAYER_SHADOW`), which the batcher enables on every shadow camera.
  Layers 1 and 2 are reserved: don't use them for anything else; raycast pieces through `world.pick` / `builder.pickPiece`.
* Vertices are sorted by level (0..MAX_LEVEL + 1, see *Roofs*), so `setView` cutaways only shorten the draw range.
* Any change punches the piece out of its batches at once (it renders on its own on layer 0, so pop-in / pop-out and
  paint show immediately); touched units rebake time-sliced (≤ 6 ms/frame, 4 ms on touch devices) after 0.5 s of quiet.
* A bake leaves out pieces that are not settled (tweening, scale ≠ 1, or inner group hidden like a cascade's waiting
  pieces): they keep rendering on their own and wait in `batcher.pending`; every `settleEvery` (0.25 s), when nothing
  else is ready, the ones that have settled are folded in (their units rebake at once, shadow units first). So an
  animated stamp is mostly batched while it plays (farmhouse: ~240–290 main-pass calls a frame instead of ~660–750).
  A piece that starts animating while its unit is being copied is left out of that bake (back to `pending`).
* API: `wake(obj)` (render on its own now — call before animating `entry.obj` yourself; also cancels a bake that copied
  it), `flush()` (bake without the quiet period), `bakeNow()` (synchronous, tests), `isBaked(entry)`, `unitsOf(entry)`,
  `stats()` (incl. `pending`), `setEnabled(b)`.
* Dev params: `?batch=0` off, `?batchsize=n` shadow-region edge in cells (integer 1..20, else 8), `?batchglass=1` also
  merge glass.

### Camera (js/camera.js, `app.rig`)

`setView({t:[x,y,z], th, ph, r}, immediate)` (malformed / non-finite views are ignored; target, `ph` and `r` are clamped
to the rig's `bounds`, `minPhi..maxPhi`, `minRadius..maxRadius`), `getView()`, `focus(x, y, z, radius?)`, `snap()`,
`rotateBy(dθ)`, `zoomBy(f)`, `setTargetY(y)`, `setInsets(top, bottom, left, right)` (px of the canvas covered by UI: the
view is centred in the free area with an eased view offset), `goal` ({target, theta, phi, radius} the view eases to),
`busy`, `drawMode`. Optional callbacks: `onTap(x, y, e)`, `onHover(x, y)`, `onDrawStart/Move/End(x, y)`, `onDrawCancel()`,
`onGestureStart()`, `onPress(x, y, type)`, `onAimStart/onAimMove(x, y)`, `onAimEnd(x, y, cancelled)`, `pickPoint(x, y)`
(pinch / slide pivot), `orbitPoint(x, y)` (twist / orbit pivot). Touch: tap = action, press-and-hold 450 ms = aim
(preview follows the finger, lift to place, lift over the UI to cancel), 1-finger drag = orbit (or draw), 2 fingers =
pinch / twist / slide anchored under the fingers; a second finger soon after a stroke starts cancels the stroke.
An aim also cancels when the finger lifts outside the canvas rect or over anything that isn't the canvas
(`elementFromPoint`: UI chrome, or null past the edge of the screen): `onAimEnd(x, y, true)`.

### Effects (js/effects.js, `app.effects`)

`popIn(obj, d)`, `popOut(obj, done, d)` (an object with no parent, e.g. a piece just removed from the world, is shown
in the scene for the animation), `isAnimating(obj)`, `retarget(from, to)`, `puff(pos, color, count, spread)`,
`sparkle(pos, color, count)`, `tweens` (read by the batcher).

### Storage (js/storage.js, `app.storage`)

Every load path (autosave, slots, share codes) goes through `sanitize(data)`, which never throws: typed / bounded
fields, `#rgb`/`#rrggbb` colours, a checked `cam`, at most `MAX_PIECES` (the lot's slot count, 25 005, roof h up to
`MAX_H` = 12) records. Loaded data may carry `dropped` (records rejected); the UI tells the player. Share codes `HW1:`
(deflate-raw, decoded by a capped pure-JS `inflateRaw`) and `HW0:` hold pieces only (no name, no camera);
`importCode(text)` finds a code inside pasted text, never rejects, and resolves to data with at least one known piece —
or `null` for anything that holds no home (garbage, an empty list, only unknown pieces), so a bad paste never replaces
a build. Slots: `SLOT_COUNT` = 6, `saveSlot(n, data, {name, thumb, cam})`, `loadSlot(n)`, `deleteSlot(n)`, `listSlots()`.
Autosave (main.js): 0.8 s after a world change, and flushed on `pagehide` / `visibilitychange` → hidden, together with
the camera view (a camera-only change is written too, but only over an autosave of this build, never over the
first-visit lot); never with `?nosave=1` or a showcase. `autosave()` returns false when storage is full / blocked
(one toast).

### Builder (js/builder.js, `app.builder`)

Builder API: `rotate(dir)`, `raise(d)`, `setLevel(n)`, `selectPiece(id)`, `undo()`, `redo()`, `place(rec, opts)`,
`resolve(sx, sy)`, `hideGhost()`, `pickPiece(sx, sy)`, `pointAt(sx, sy)` (world point under the pointer: a piece, else
the active level's plane), `orbitAt(sx, sy)` (middle of the building under the pointer, or null), `autoRoofHeight(def, x,
z, r, level)`, `autoGable(def, p)`, `eraseAt / paintAt / pickAt(sx, sy)`, `drawStart / drawMove / drawEnd / drawCancel`.
`resolve` tries, in order: blueprint guides (guided mode: taps snap to a glowing guide; off-guide taps for pieces that
still have guides are rejected with a hint), gables (snap to the open roof end pointed at, on any floor), the piece under
the pointer (windows / doors also swap walls on other visible floors), then the grid. Roof pieces settle on top of the
walls under the pointer whatever floor is active (fixed for the length of a draw stroke). With the finger on a wall,
beam or post the roof rests on top of THAT piece (level = its level + 1, up to MAX_LEVEL + 1 over the top floor), in
the cell where the finger's line crosses the wall-top height; more than a cell away from the piece (a tap low on a
wall face) is invalid: red ghost, error sound and '🏠 Tap the top of a wall to rest the roof on it'. Gables: an open
triangle visible in front of whatever the ray hits wins (looking through one open end never picks the far end).
Garden pieces on an upper floor with nothing to stand on under the finger, or that can't go that high, land on the
ground (level 0) where the finger's ray meets it — the meadow seen past the house. For cell pieces that is the cell
under the finger (`world.hasFloor`); for fences and hedges the grid edge nearest the finger (`world.edgeSupported`).
A railing (not a garden piece) gets no fallback: unsupported upstairs, it shows a red ghost and the reason.
* Draw strokes: wall-like (edge) strokes take their first edge's axis from the finger's first move, then keep to that
  grid line while the finger stays within 0.8 cell of it; leaving it steeply turns a corner, leaving it shallowly hops
  to the parallel line. Steep means either along-travel since the finger was last on the line < 0.5 × off-distance, or
  heading steeper than 45° over the finger's last ~0.45 cell (so a corner rounded with a radius up to ~2.4 cells, or a
  wobbly thumb, still turns). A hop that turns within 1 cell of along-travel was a corner after all: the turn starts
  from the line before the hop, and what the stroke laid on the hop line is taken back. A turn goes through the grid
  corner nearest the finger (it is on the new line by then): the row's last new segment, if it lies past that corner,
  is taken back (an overshooting thumb leaves no stub), a row that stopped short is finished up to it, and the new
  side is filled in from the corner to the finger (the turn registers ~0.8 cell late, or later while the finger is
  over a wall the stroke just laid). The row's direction (`go`) follows its segments, so a thumb wobbling back at a
  corner can't flip it.
  Corner correction (`drawing.turn`): for up to 4 cells after a turn the stroke keeps the finger's mean offset from
  the new line, weighted by distance travelled (samples over a wall the stroke just laid count as on the line). A hop
  to the adjacent parallel line within that window, when the mean leaned ≥ 0.35 cell toward it, re-does the turn on
  that line: what the stroke laid on the wrong line is taken back, the old row is trimmed or finished up to the new
  corner (its side is decided by the stroke's segments within 3 cells of the corner, not `go`, which a weave can
  flip), and the new side is filled in from the corner. A finger that ran on the new line before drifting off hops as
  usual.
  Fill-ins only go into empty slots, or over the same piece in another look (a restyling stroke repaints the corner it
  crossed); take-backs only remove what the stroke put into an empty slot. A build stroke of a W piece that isn't an
  opening never replaces a window, door, archway or gable it passes over, at the finger or in a fill-in
  (`_strokeKeep`): an opening in the stroke piece's `matGroup` takes the stroke's material (when in its `mats`) and
  colour, accent kept, through `world.update` in the stroke's undo step; archways and gables are left as they are.
  Only a tap, a stroke of openings, or a stroke of that same piece replaces them. Walls on other parallel lines don't
  hijack the stroke. A garden fence / hedge stroke fixes its level where the finger lands (`drawing.y`: the active
  floor when the edge nearest that spot passes `edgeSupported`, else the ground), takes its first edge's axis on that
  plane and skips unsupported slots. A stroke is one undo step (`beginBatch` / `endBatch`); an erase stroke only
  removes one kind of thing on one floor (roof panels count as one kind).
* Gaps: a tap (not a stroke) with a W-layer piece whose ray crosses the opening of an empty edge on the active floor
  whose two ends both meet pieces of the same family (walls & openings together, else one fence / hedge / railing
  kind) — before anything else it hits — fills that edge, so tapping through a missing wall segment doesn't land on
  the floor or far wall behind it. An edge only counts when it carries on a line of that family at one end, or when
  neither end sits in the middle of a straight run across it: the cross edges of a one-cell-deep corridor or annex
  touch both long walls but are no gap (a floor tap there takes an edge of the tapped cell). Window / door tools
  aimed at a wall seen through the gap still swap that wall.
* `selectPiece(id)`: a piece chosen from its own tray on a floor above its highest allowed level steps down to that
  floor with a gentle toast (garden pieces always do; never in guided mode). Garden pieces also step down to Floor 1
  from an upper floor that has no deck or flat roof laid on it ('🌷 Back to Floor 1 — the garden grows on the ground').
  Otherwise `_autoView` may pick a floor / cutaway for it (cozy things → a floor with a floor piece, cutaway on;
  roofs & gables → every floor shown).
  Category tabs (and keys 1–7) hand over the last piece used in that category when it can go on the current floor
  (garden things always: selectPiece walks them down), else the first one that can (Floors upstairs → floor tiles, not
  a foundation).
* A placed piece whose cutaway level is above the current cutaway turns `seeAll` on ('👁️ Showing every floor…').
* The build grid is unlit: it fades (opacity 0.28 → ×(1 − 0.55·night)) and tints moonlit blue with `env.night`.

## Town (js/town/, `app.town`)

The Living Town (villagers with move-in recipes, wishes, day/night routines, the Cozy meter, thank-you gifts). The full
design and every contract are in **docs/LIVING.md** (§12.3 data contracts, §12.4 module APIs, §12.5 events, §12.9
persistence, §12.12 params, §12.13 debug API); this is the short map.

| File | Part | Role | Imports |
|---|---|---|---|
| `js/town/data.js` | brain | `TUNE` (every tuning number, LIVING.md §15), jobs, traits, names, lines, sets, spot defs, `GIFTS`, keys; every user-visible string the brain needs | nothing |
| `js/town/rng.js` | brain | seeded RNG (mulberry32) and hashing | nothing |
| `js/town/homes.js` | brain | world index, buildings and homes (§3: rooms, doors, beds, the one forgiven flaw), names, footprints | config, data |
| `js/town/nav.js` | brain | 22 × 22 cell nav grid with edge masks, A*, string pulling, regions (§6) | config, data, homes, rng |
| `js/town/recipes.js` | brain | job recipes, missing items, charm, hangout spots | config, data, homes |
| `js/town/wishes.js` | brain | the 43 wish templates, eligibility, completion, the spot finder Show me uses | config, data, homes, recipes |
| `js/town/model.js` | brain | `buildWorldModel()`: index → buildings → nav → spots in one call | config, data, homes, nav, recipes |
| `js/town/sim.js` | brain | the deterministic town (fixed 0.25 s ticks): roster, status, schedule, plans, arrivals, wishes, Cozy, gifts | config, data, rng, homes, recipes, wishes, store |
| `js/town/store.js` | brain | the save: fresh, `sanitizeTown` (never throws), load, save, the unlocks mirror | data |
| `js/town/look.js` | body | procedural villager, tent and lantern geometry; the one patched shared material; glyph atlas | three, BufferGeometryUtils |
| `js/town/render.js` | body | instanced meshes, blob shadows, light spill, FX points, the camp, the Show me highlight, the nav overlay | three, materials, look |
| `js/town/actors.js` | body | presentation: interpolates the sim's plans, poses, steering, cues, hit test (the only body API index.js uses) | three, look, render |
| `js/town/hud.js` | face | bubbles, villager / town / hint / gift cards, the hearth chip, the Show me checklist, every town toast (DOM) | nothing (reads `app.town`) |
| `js/town/index.js` | wiring | `init(app)` → `app.town` (the TownAPI): params, clocks, recompute scheduling, input, Show me, events, persistence, debug | the other town modules except hud.js, by dynamic `import()` at boot (none with `town=0` or a showcase) |
| `js/pieces/gifts.js` | pieces | the 10 gift pieces, registered hidden; un-hides the unlocked ones at registration | three, catalog, materials, geom, config, town/data |
| `css/town.css` | face | all town styling | — |

* **Boot.** main.js loads `gifts` with the other piece modules (gift pieces always register, villagers on or off),
  then `app.town = await loadModule('town', './town/index.js')` after blueprints and before ui (loading text
  *Waking the village…*). index.js imports the other town modules at boot; a missing module or export turns the town
  off for the session with one `console.error` (`debug.parts()` reports which). The body compiles its shaders behind
  the loading screen, so the first villager drawn adds no shader program. The first recompute runs on `ready`, after
  the autosave restore, as a silent restore (no events, toasts or walks); `app.town.ready` turns true then. ui.js
  mounts the hud after first paint (`import('./town/hud.js')`, only when `app.town` exists) and exposes it as `ui.hud`.
* **Each frame.** main.js calls `app.town.update(dt)` inside a try/catch (a throw nulls `update` and is reported).
  The town clock advances in fixed 0.25 s ticks only while the page is visible, villagers are on and `ready` is true;
  presentation interpolates between ticks. A recompute (`buildWorldModel` + re-binding + wish checks) runs 0.3 s after
  the last `world-change`, at most twice a second.
* **TownAPI** (LIVING.md §12.4): `ready`, `enabled()`, `clock()`, `day()`, `cozy()`, `view()` (cached, ≤ 4×/s),
  `villager(id)`, `bubbles()` (world anchors; the hud projects them), `giftInfo(pieceId)`, `tipOnce(id)`, `audible()`
  (audio.js reads talkers and foley from it), `hitTest(sx, sy, pad)`, `showMe(target)`, `showing()`, `endShowMe()`,
  `muteHint(homeId)`, `answerIntro(lovely)`, `follow(id)`, `focusHome(homeId)`, `update(dt)`, `debug` (§12.13). Every
  entry point is guarded: a town failure turns villagers off for the session (one `console.error`) and building carries
  on.
* **Input.** index.js wraps `rig.onTap` / `rig.onPress` / `rig.onAimEnd`; builder.js is untouched. With the Build tool
  only a tap on a villager's body selects them (a tap beside them builds), and a tap on a Show me ring or ghost always
  places the piece exactly there. Erase / Paint / Pick taps on a villager open their card and change nothing.
  camera.js is untouched too: while **Follow** is on, index.js gives the rig instance thin wrappers (`_zoomAbout`,
  `_turnAbout`, `_grab`, `_reanchor`, `_initMulti`) so a pinch zooms and a twist turns round the followed villager and
  only a real two-finger slide (or a pan / wheel zoom) lets go (LIVING.md §12.7). Show me frames its spot with a few
  `world.pick` occlusion rays (a `THREE.Raycaster` from candidate camera positions), so a wall or a pine never hides it.
* **Drawing.** Everything the town draws lives in **one `THREE.Group` named `'town'`** added to the scene: never inside
  `world.root`, layer 0 only (never layers 1 / 2), no shadow-map casting, never animated through `effects` tweens, and
  the town never sets `renderer.shadowMap.needsUpdate`. Budget: ≤ 14 extra draw calls with 20 villagers (≤ 20 with a
  Show me highlight: its ghost is the piece baked into one mesh, so it costs one call whatever the piece), ≤ 20k
  triangles (plus the ghost piece's own while a highlight is up). Indoor villagers on levels the cutaway hides are hidden; `world.pick` never sees
  villagers. Photo mode keeps villagers and hides bubbles, cards, the highlight and follow.
* **The world is read-only to the town.** It never writes pieces, undo stacks or build saves; it reacts to
  `world-change`. Undo never takes back a granted wish, Warmth, a gift or an unlock. Nobody is ever evicted: a broken
  home makes its residents wait, then move to a free bed, then camp by the lane (each after 3 s of a quiet world).
* **Persistence** (LIVING.md §12.9). One device-level key `hearthwood.town.v1` (`v: 1`, ≤ 8 KB for 20 villagers; slots,
  share codes and a clear never touch it) plus the tiny mirror `hearthwood.unlocks.v1` (a JSON array of unlocked gift
  ids, written first and at once on an unlock). Writes: 2 s after a town change, every 30 s of town clock, and on
  `pagehide` / hidden; never with `?nosave=1`, a showcase, `town=0`, `town=fresh` or a read-only save. When another tab
  writes the key (`storage` event) this tab goes read-only for the session with a Reload toast. A save with a newer `v`
  loads read-only. The town clock never runs while the page is hidden: nothing advances offline.
* **State keys** `village` (Villagers & wishes, default true) and `chatter` (default true), both persisted.
  `timeFlow` now defaults to true (LIVING.md §0.4): an existing player is switched to it once, on the first run with
  the town, with a toast; after that the game never changes `timeFlow` except through the player's own tap.
* **Gift pieces** (`js/pieces/gifts.js`) are ordinary batched decor-like pieces: `gift: { job }`, `walk: 'solid'|'soft'`,
  `hidden: true` until unlocked (read from both keys at registration, so an unlock survives the town failing to load;
  even reading `localStorage` is guarded, so blocked site data never stops the gifts registering);
  `catalog.setHidden(id, hidden)` un-hides one. `world.validate` ignores `hidden`, so saves, share codes and Pick always
  work with gift pieces. They add no material (the `mat()` cache is unchanged).
* **Other core hooks.** env.js exports `LANE` and `DAY_SECONDS` (the town reads them through `app.modules.env`); a
  smoke emitter's def may set `smokeAlpha` (default 1) for a thinner wisp (the fire pit); env.js lets the dusk linger
  (17:45–20:10 sunset into blue dusk; every time preset looks as before). blueprints.js: with villagers on and drawn, a
  "Place it instantly" stamp ends with the finishing glide, framing the garden too (pull-back capped at ×1.15).
  main.js's autosave never overwrites a restored build that dropped unknown pieces with a camera-only flush.
* **Events.** `town-ready`, `-homes`, `-traveller`, `-movein`, `-wish`, `-granted`, `-expired`, `-gift`, `-cozy`,
  `-status`, `-fixed`, `-passerby`, `-readonly`, `-savefail`, `-day`, `-showme`, `-showme-end`, `-intro`, `-select`,
  `-enabled` (payloads in LIVING.md §12.5; every one is logged with `townlog=1`). index.js also sends `sfx` (`wish`,
  `wish-granted`, `move-in`, `gift`, `hop`, with `pan` / `gain`) and `toast` (with `action` for buttons such as
  👀 Watch and Reload); the hud sends `villager` on card open.
* **URL params** (validated; malformed values are ignored): `town=0|1|fresh`, `townrender=0`, `townseed=n`,
  `townspeed=n`, `spawn=jobs|n`, `wish=<tpl>`, `cozy=n`, `unlock=all|ids`, `townnav=1`, `townhud=1`, `townlog=1`
  (LIVING.md §12.12). `town=0` and showcases load index.js but import nothing else, leave the rig unwrapped and draw
  nothing; `unlock` still applies.
* **Tests.** `tools/town-regress.mjs` (R1–R21, end to end), and the package scripts `tools/town-brain.js` (B1–B12),
  `tools/town-look.js` (L1–L11) and `tools/town-hud.js` (H1–H15), run through `shot.mjs --script` (LIVING.md §13.4).

## Offline & install (sw.js, manifest.webmanifest)

main.js registers `./sw.js` on https only (local dev servers stay worker-free). The worker's scope is its folder, so the
game works from any subpath (GitHub Pages: `/hearthwood/`); the manifest's `start_url`, `scope` and `id` are `./`.

* `CORE` in sw.js lists every file the game can request: index.html, both css files, every js module (incl. `js/pieces/`
  and the vendored three.js + addons it imports), the manifest and its icons. Fonts are system fonts and audio is
  synthesized, so there is nothing else. Add a new file to `CORE` and bump `VERSION` (that renames the cache; old ones
  are deleted on activate). Content-only changes need no bump.
* One source per page load, so old and new modules never mix: if the page itself comes from the network (within 6 s),
  every file of that load comes from the network revalidated (`cache: 'no-cache'`), falling back to the offline copy
  only if the network fails; otherwise (offline, or stalled) every file comes from the offline copy. Responses reach
  the page marked `Cache-Control: no-cache` so the browser's own caches can't reuse a module behind the worker's back.
* The offline copy is always one complete set: installed with `addAll` (all or nothing), and refreshed ~4 s after a
  page load the network answered (at most once a minute): every CORE file is fetched first and the changed ones are
  stored only if all of them arrived.
* Other pages in the folder (docs, README) are left to the browser.

## Dev tools

* `?showcase=<category>` lays out every piece of a category in every material (rows = pieces, columns = materials) at level 0
  starting at cell (−9, −9), 2 cells apart; a category with more than 10 pieces wraps into side-by-side blocks of
  10 rows (centred on the lot). `?showcase=all` is a contact sheet: every piece once (default material), 10 per row,
  2 cells apart, all on the lot. The camera frames the layout (from the usual angle when it fits; a narrow portrait
  phone gets a higher / squarer view, and if needed the showcase page lifts `rig.maxRadius` to 150 to fit it).
* `?clean=1` start empty · `?nosave=1` don't autosave · `?ui=0` no UI · `?bp=<id>` stamp a blueprint ·
  `?time=0.8` · `?season=winter` · `?weather=rain` · `?level=1` · `?seeAll=1` · `?cam=theta,phi,radius,tx,ty,tz` ·
  `?welcome=1` show the welcome card · `?thumbs=0` no blueprint pictures · `?batch=0|batchsize=n|batchglass=1` (batching).
  Values are validated: numbers must be strict numbers (`time=0.5abc` is ignored), `level` an integer (then clamped to
  0..MAX_LEVEL), `batchsize` an integer 1..20; `cam` parts that aren't numbers are ignored (a bad theta / phi / radius
  drops the whole view, missing target parts default to 0, 1, 0).
* `node tools/shot.mjs --query "showcase=walls&ui=0" --out /path/shot.png [--w 1280 --h 800] [--mobile] [--cam …]
  [--eval "js"] [--script file.js] [--wait ms] [--mobile --landscape]` — serves the game, screenshots it, prints console errors, piece count,
  draw calls & triangles. `--script` bodies run inside an async function in the page and may `return` a value.
* With more than 100 pieces (`?showcase=all` holds 106: 96 + the 10 gifts) the contact sheet's last row sits just past
  the lot's front edge (z = 11).
* `node tools/batch-regress.mjs` — static-batching regression, 48 checks (stamp/erase/paint/undo/levels/pick/touch,
  mid-cascade invariants, batched vs unbatched pixel comparison, draw-call ratio). Exits 1 on failure. `HW_ROOT=…` tests
  another checkout.
