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
  tools/shot.mjs        headless screenshot / test runner
  tools/batch-regress.mjs  static-batching regression test (node tools/batch-regress.mjs, ~6 min, exit 1 on failure)
  sw.js                 service worker (network-first, offline cache) — add every new module to its CORE list
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
| `MAX_LEVEL` | 4 | levels 0..4 |

`levelY(y) = BASE_Y + y * LEVEL_H` is the floor height of level `y`.

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
  h: 0..9,           // roof pieces: half-steps above levelY(y); gables: half-steps of rectangular wall under the slope
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
  corners stack diagonally. Users can nudge with roof ▲▼ (`state.hOffset`).
* Roof visibility follows `p.y` (the level the roof was built from), so a whole roof hides together.
* A gable roof over a W-wide house: slopes of rotation r on the downhill half, rotation (r+2)%4 on the other half,
  stacked by `h`; the two top rows meet at the ridge with the same `hs + rise`.

### Gables (`autoGable: true` edge pieces)

Placed on an edge under a roof slope that runs **along** the edge. The builder sets `h` (half-steps from `levelY(y)` to the
roof slope's base at that edge), `s` (the slope's rise) and `r` so that local +X points uphill. Shape: from local x = −1 to +1,
bottom at 0, top line from `h*STEP` (at x = −1) to `(h+s)*STEP` (at x = +1) — exactly the underside of the roof panel.

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
  emitterOffset: [0, 3.2, 0],  // local offset of the emitter
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
`photoMode`, `blueprint`, `slot`. Settings persist in localStorage (validated on load; writes debounced to at most one
per 600 ms and flushed on `pagehide` / hidden; `state.save()` writes now). Replace objects (`mats`, `colors`) — don't mutate.

Event bus `events.emit(type, detail)` / `events.on(type, fn)`:
* `world-change` {kind: 'add'|'remove'|'clear'|'load'|'undo'|'redo', p, prev, count} (`discardLast()` reports 'undo')
* `placed` {p, def, replaced}
* `sfx` {name, flavor} — names: place, replace, remove, paint, rotate, click, undo, level, error, success, open, close, camera, blueprint-step, blueprint-done
* `toast` {text, kind?: 'info'|'warn'|'success', ms?} — also sent once by storage.js when an autosave can't be written
* `blueprint-progress` {id, done, total, stage, stageName}
* `history` {canUndo, canRedo} — after a batch (blueprint stamp, draw stroke), a load or `discardLast()` changes the undo stacks
* `ready` (app)

## App object (window.__hw, passed to every module's `init(app)`)

`THREE, scene, camera, renderer, world, rig, builder, effects, state, events, catalog, materials, storage,
params (URLSearchParams), errors, thumbnail(id, rec) → Promise<dataURL>, snapshot(maxWidth) → dataURL,
loadBuild(data), newBuild(), env, audio, ui, blueprints, fps`.

Feature modules export `init(app)` returning an object (optionally with `update(dt)`, called each frame):
* `env.js` → `{ update(dt), heightAt(x, z), sunDir, night }` — owns lights/sky/ground; removes nothing of the world.
  Shadow maps are cached (`renderer.shadowMap.autoUpdate = false`): env re-renders them on world changes, effect
  tweens, light movement and every 12 frames. Anything else that animates shadow-casting objects should set
  `renderer.shadowMap.needsUpdate = true`.
* `audio.js` → `{ update(dt) }` — listens to `sfx` events and state.
* `blueprints.js` → `{ list(), get(id), startGuided(id), stop(), stamp(id, {animate, record}), welcome(), update(dt), active(),
  selectNext({focus, quiet}), progress(), stages }`. An animated stamp keeps waiting pieces at scale 0.001 with their
  inner group (`entry.obj.children[0]`) hidden until their pop-in (no draw calls; `entry.obj.visible` stays the
  level cutaway's). In guided mode `selectNext` turns the camera to face a piece that is on the far side of the house.
* `ui.js` → `{ update(dt), toast, open(page), close, showWelcome, ask }`.
* `app.welcomeLot` — `world.version` right after the first-visit scenery lot was placed (unchanged version ⇒ only scenery).

World API: `new World(scene, { batch: false | batcherOptions })` (one-argument form still works; batching is on by default).
`add(rec, {record}) → entry|null`, `remove(key)`, `update(key, patch)`, `get(key)`, `entry(key)`, `keyOf(rec)`,
`normalize(rec)` (null for anything that isn't a record of a known type), `validate(rec)`, `clear()`, `load(data)`,
`serialize()`, `undo()`, `redo()`, `discardLast()` (revert the last undo step without making it a redo — for gestures
that turned out to be accidental), `canUndo()`, `canRedo()`, `beginBatch()/endBatch()` (endBatch → true when it pushed an undo step), `buildPlaced(rec)`,
`buildLocal(rec)`, `signature(rec)` (template-cache key), `setView(level, seeAll)`, `pick(raycaster)`,
`tick(dt)` (called by main.js every frame; returns true when shadow maps must be refreshed), `batcher`,
`onRemount(from, to)` (hook: a piece's object was rebuilt in place — main.js moves its tweens),
`entries` (Map key → {key, p, def, obj, level}), `count`, `version` (bumps on every change).
`load(data, {record: true})` is a single undo step; a non-recorded load resets both undo stacks and any open batch.
Unknown / malformed records in `load` data are skipped.

Template cache: `world.templates` (signature → merged template) is **read-only** for other modules. Templates used by
placed pieces are kept; unused ones stay for quick reuse up to `world.maxIdleTemplates` (160, least recently used
first) and are then disposed (on the next world change or frame). Objects from `buildPlaced` / `buildLocal` share
their template's geometry: keep them only while they are shown (ghosts), never dispose their geometry.

### Static batching (js/batcher.js, `world.batcher`)

Settled pieces are drawn by merged meshes: one **render unit** per (shared material, receiveShadow, shadow mode) for
the whole lot (split into lot quadrants past ~131k vertices) and one position-only **shadow proxy** per 8×8-cell region.
The farmhouse frame costs ~130 draw calls in total instead of ~650 (~1,250 on frames that redraw shadows).

* Batches live in the scene group `world-batches`, never inside `world.root`. The pieces' own meshes stay in
  `world.root` but move to **layer 1** (`LAYER_BAKED`: never rendered, still pickable — `world.pick` enables it on its
  raycaster). Shadow proxies use **layer 2** (`LAYER_SHADOW`), which the batcher enables on every shadow camera.
  Layers 1 and 2 are reserved: don't use them for anything else; raycast pieces through `world.pick` / `builder.pickPiece`.
* Vertices are sorted by level, so `setView` cutaways only shorten the draw range.
* Any change punches the piece out of its batches at once (it renders on its own on layer 0, so pop-in / pop-out and
  paint show immediately); touched units rebake time-sliced (≤ 6 ms/frame, 4 ms on touch devices) after 0.5 s of quiet
  and once no piece in them is scaled or tweening.
* API: `wake(obj)` (render on its own now — call before animating `entry.obj` yourself), `flush()` (bake without the
  quiet period), `bakeNow()` (synchronous, tests), `isBaked(entry)`, `unitsOf(entry)`, `stats()`, `setEnabled(b)`.
* Dev params: `?batch=0` off, `?batchsize=n` shadow-region edge in cells, `?batchglass=1` also merge glass.

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

### Effects (js/effects.js, `app.effects`)

`popIn(obj, d)`, `popOut(obj, done, d)` (an object with no parent, e.g. a piece just removed from the world, is shown
in the scene for the animation), `isAnimating(obj)`, `retarget(from, to)`, `puff(pos, color, count, spread)`,
`sparkle(pos, color, count)`, `tweens` (read by the batcher).

### Storage (js/storage.js, `app.storage`)

Every load path (autosave, slots, share codes) goes through `sanitize(data)`, which never throws: typed / bounded
fields, `#rgb`/`#rrggbb` colours, a checked `cam`, at most `MAX_PIECES` (the lot's slot count) records. Loaded data may
carry `dropped` (records rejected); the UI tells the player. Share codes `HW1:` (deflate-raw, decoded by a capped pure-JS
`inflateRaw`) and `HW0:`; `importCode(text)` finds a code inside pasted text and never rejects.

### Builder (js/builder.js, `app.builder`)

Builder API: `rotate(dir)`, `raise(d)`, `setLevel(n)`, `selectPiece(id)`, `undo()`, `redo()`, `place(rec, opts)`,
`resolve(sx, sy)`, `hideGhost()`, `pickPiece(sx, sy)`, `pointAt(sx, sy)` (world point under the pointer: a piece, else
the active level's plane), `orbitAt(sx, sy)` (middle of the building under the pointer, or null), `autoRoofHeight(def, x,
z, r, level)`, `autoGable(def, p)`, `eraseAt / paintAt / pickAt(sx, sy)`, `drawStart / drawMove / drawEnd / drawCancel`.
`resolve` tries, in order: blueprint guides (guided mode: taps snap to a glowing guide; off-guide taps for pieces that
still have guides are rejected with a hint), gables (snap to the open roof end pointed at, on any floor), the piece under
the pointer (windows / doors also swap walls on other visible floors), then the grid. Roof pieces settle on top of the
walls under the pointer whatever floor is active (fixed for the length of a draw stroke).

## Dev tools

* `?showcase=<category>` lays out every piece of a category in every material (rows = pieces, columns = materials) at level 0
  starting at cell (−9, −9), 2 cells apart; a category with more than 10 pieces wraps into side-by-side blocks of
  10 rows (centred on the lot). `?showcase=all` is a contact sheet: every piece once (default material), 10 per row,
  2 cells apart, all on the lot. The camera frames the layout.
* `?clean=1` start empty · `?nosave=1` don't autosave · `?ui=0` no UI · `?bp=<id>` stamp a blueprint ·
  `?time=0.8` · `?season=winter` · `?weather=rain` · `?level=1` · `?seeAll=1` · `?cam=theta,phi,radius,tx,ty,tz` ·
  `?welcome=1` show the welcome card · `?thumbs=0` no blueprint pictures · `?batch=0|batchsize=n|batchglass=1` (batching).
  Invalid values are ignored (level is clamped to 0..MAX_LEVEL).
* `node tools/shot.mjs --query "showcase=walls&ui=0" --out /path/shot.png [--w 1280 --h 800] [--mobile] [--cam …]
  [--eval "js"] [--script file.js] [--wait ms] [--mobile --landscape]` — serves the game, screenshots it, prints console errors, piece count,
  draw calls & triangles. `--script` bodies run inside an async function in the page and may `return` a value.
* `node tools/batch-regress.mjs` — static-batching regression (stamp/erase/paint/undo/levels/pick/touch, batched vs
  unbatched pixel comparison, draw-call ratio). Exits 1 on failure.
