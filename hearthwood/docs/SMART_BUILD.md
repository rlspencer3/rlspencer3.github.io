# Smart building — auto facing & the lifted aim (build spec)

The owner, playing on a phone: *"It is sometimes hard to get the pieces to place where you want, and turning them
manually is annoying. Is there a better and faster way to just choose the parts you want and when you tap they are
placed where they need to go?"* They chose two features:

1. **Smart facing.** Every piece faces the sensible way by itself, worked out from what is around the spot. To change
   one, tap the placed piece again with the same part in hand and it turns; the Turn button stays as an override.
   Goal: zero turning in the common case, one gesture to fix a rare wrong guess, no hidden sticky state.
2. **Lifted preview.** While pressing and holding (aim), the preview floats just above the finger, so the fingertip
   never hides where the piece lands; lifting places it there. Quick taps stay exactly where tapped.

Not part of this work (the owner did not choose them): suggested spots, one-tap whole jobs.

This spec is grounded in the code as it is today (`js/builder.js`, `js/camera.js`, `js/world.js`, `js/pieces/*.js`,
`js/blueprints.js`, `js/town/*`) and in a working prototype of every facing rule that was measured against the five
stock blueprints in four build orders (§10) and 220 purpose-built scenes (Appendix A, Appendix B). The prototype and
its runners are reference material for the implementer (§12); they are not part of the game.

**Revision 2** answers a design critique: tap-again now decides the slot exactly as today first and only then looks
at what is in it (§5.1), Turn / R turn the placed piece under the preview (§5.2), pins and the memo are keyed by the
slot before facing (§4.1, §4.6), Show me previews use the wish's own facing (§5.5), and eight rules were corrected
(lean-to roofs, garden fronts against the house, fences beside a path, seats beside a hearth, benches in the open,
valley corners, a chair beside a desk, a deck's second row; §4.5). Every change and every suggestion not taken is listed in §13.

**Repair round 1** (after the verifiers' phone playtest and regression pass) changed six things, each listed with its
finding in §14: a tall piece's own window beats a wall a cell away and a back never presses against another piece
(§4.5 back); porch steps fall back to the player's last facing in the open and climb toward the house before their
porch exists (§4.5 steps); a tap on top of a same-part piece in the open turns it (§5.1 T1); tap again steps to the
next most likely facing (§5.1); a finished blueprint piece answers a tap (§5.5); and the lifted aim is judged at the
aim point, so the finger may rest on the tray (§6.1).

**Repair round 2** (§15) changed three things: furniture with a wall, window, half wall, railing or fence on one of its
own edges backs onto one of them — the "wall a cell or more away" fallback is only for a cell with none, so a cook
stove on a window wall keeps its back to the glass with a table in front of it (§4.5 back); the first tap again on a
piece that is not facing the rules' best turns it straight to the best, and a run of taps then goes round every facing
(§4.4, §5.1); stairs ignore an item outside, behind the wall at their foot (§4.5 climb).

---

## 1. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | Facing is decided **once, when a piece is placed** (and shown by the preview before that). Stored records keep their `r`; loading, undo, stamping and contextual rebuilds never re-decide it. | Saves, share codes, blueprints and guided mode load and look exactly as before. |
| D2 | One pure module **`js/facing.js`** decides: `autoFacing(def, p, ctx)` scores the candidate facings from slot-key lookups around the spot (`world.get(K.…)`), never scans the world. | Testable on its own; cheap (0.3–80 µs average by group, 0.15 ms at the worst spot, §4.6); `resolve()` calls it on every pointer move, behind a one-entry memo. |
| D3 | Every rotatable piece belongs to one **rule group** (19 groups, §4.5) — walls face outward, roofs run downhill to the nearest eave, furniture puts its back to a wall, chairs face tables, steps climb to the platform, fences show their good side to the street… | One table, one place to extend (`def.face` override for future pieces). |
| D4 | Ties are broken by the **camera** (the piece's front, or the slope's face, toward the viewer); when nothing around the spot says anything, the **fallback is the facing the player last chose** (`state.rot`). | Deterministic; the fallback keeps today's "R sticks" feel only where auto has no opinion (a tree in the meadow). |
| D5 | **Tap again to turn**: the slot is decided **exactly as today** (guides, gables, gap filling, stroke lines, the level and top-rim rules, roof panels); only then, if that slot — or, for a furniture-like cell piece, the piece under the finger when the slot is no sensible place (occupied, invalid, or ground hidden behind a wall) — holds the *same part with the same look*, the tap turns it — to the **next most likely facing** for its spot (the rules' order; flip for edge pieces) — as **one undo step**. Same part, different look → restyle in place, facing kept. Anything else → place / replace as today, auto facing. Trees and plants never take the picked slot. | One gesture fixes a wrong guess, and nothing that works today changes: building on a wall top from the floor above, filling a gap, planting a row of trees away from the camera, furnishing behind a tall piece with another part (§5.1, measured). |
| D6 | **Turn button / R** = "turn what you are looking at": a placed piece under the preview (hovering it shows its turn) is **turned at once**; an empty slot under the preview gets a **pin** (the preview turns, a placement there uses it); with no preview, **the piece you just placed** turns; else a one-line hint. No sticky manual mode, no "Auto/Manual" toggle. | On a phone the preview is hidden once the finger lifts; a "turn the next piece" state would be invisible and would silently stick — exactly the surprise the owner dislikes. On desktop the cursor rests on the piece just clicked, so R must turn that piece, not pin a preview that can't win (§5.2). |
| D7 | Guides, Show me spots and autoGable keep their **exact** facing; smart facing never overrides them — the Show me **preview** too (the town tells the builder its highlighted recs, §5.5). Draw strokes use auto facing per segment and never turn pieces they pass over. | Blueprint fidelity; the preview always matches what a tap builds; strokes stay predictable. |
| D8 | The **lifted aim lives in `camera.js`**: after the hold starts, the aim point eases from the fingertip to `lift` px straight above it (62 px on an iPhone) in 140 ms; the rig passes that point to `onAimStart / onAimMove / onAimEnd`, so the builder **and the town's wrappers** (Show me snapping) use it with no change. A small ring marks the point. | One owner of the offset; the town's aim wrappers need no change (its only change is the Show me hint hook of D7); quick taps, mouse, pen and Draw strokes are untouched. |
| D9 | A setting **Preview above your finger** (default on, persisted). | Some players prefer the old behaviour; zero cost. |

---

## 2. Guardrails (must hold)

* **Saves / share codes / blueprints / guided mode**: byte-identical `serialize()` after load; `world.normalize`,
  `world.load`, `storage.sanitize` unchanged. Facing is decided only in `builder.resolve()` for new placements.
* **Guides** snap with the blueprint record's `r` (today's `fixed === 'guide'` path) — unchanged.
* **Desktop / mouse**: R and Shift+R, the Turn button, hover preview, click — all keep working (§5.2).
* **Village** (`js/town`): beds, chairs (+`chairTuck` / `CHAIR_SEAT_Z`), sofas, ranges, desks, fireplaces, stoves,
  benches, woodpiles keep reading their record's `r`. Turning a piece someone uses re-poses them (the existing
  `recheckInside` path, §5.8). Smart facing produces the facings the village uses best (§4.5 notes). The town's only
  code change is the three-line Show me hint hook (§5.5); `sim.js`, `recipes.js`, `wishes.js` are untouched.
* **Performance**: facing is computed per `resolve()` (every pointer move while aiming / hovering): local lookups only
  (at most 168 cells of ring search), ≤ 0.1 ms median and ≤ 1 ms p99 on desktop SwiftShader, plus a one-entry memo
  (§4.6). Measured: 0.3–80 µs average by rule group, 0.15 ms at the worst spot, p99 0.2 ms.
* `tools/batch-regress.mjs` 48/48 (and `HW_TOWN=1`), `tools/town-regress.mjs` (~217) and the package tests stay green.
* Don't change unrelated behaviour (gap filling, roof settling, gables, stroke corner logic, floors, cutaway…).

---

## 3. Inventory: every rotatable piece

106 registered pieces; **81 `rot: 'four'`** (cell pieces) and **19 `rot: 'flip'`** (edge pieces); the other 6 are
`'none'` (foundation, floor, path, post, roof_flat, roof_pyramid) and are not affected.

Conventions (`config.js`): `r` 0..3 turns the piece `r·90°` about +Y; its local **+Z** ("front") points along
`DIRS[r]`: **r 0 → +Z** (south, toward the default camera), **r 1 → +X**, **r 2 → −Z**, **r 3 → −X**; local +X points
along `DIRS[(r+1)&3]`. Edge pieces: `r` is 0 or 2 (flip); at `r 0` local +Z is world +Z (axis `x`) or world +X
(axis `z`).

How the table was made: `catalog.allDefs()` dumped in the page (id, cat, slot, layer, rot, levels); every piece built
at r 0..3 (`world.buildPlaced`) in an empty spot and its world-space vertex sets compared (rounded to 2.5 cm, per
material): "4 looks" = all four facings differ; "r ≡ r+2" = a half turn looks the same (the rule answers 0 or 1);
"flip barely shows" = r 0 / r 2 differ by < 0.4 of the vertex mass (end-cut, quoin or brace mirroring); "flip
invisible" = identical. The local-frame column was read from the builders (`pieces/*.js`) and checked against each
piece's local bounding box (wall-huggers all have their back at local z ≈ −0.89, `BACK` in decor.js).

| Piece | id | cat | slot · layer | rot | floors | local frame at r = 0 (front = +Z) | looks | rule |
|---|---|---|---|---|---|---|---|---|
| Porch Deck | `deck` | base | cell · F | four | 1–5 | boards run along local X | r ≡ r+2 | deck |
| Porch Steps | `steps` | base | cell · F | four | 1–1 | climbs from the ground at −Z up to the platform at +Z (r points at the house) | 4 looks | steps |
| Beam | `beam` | frame | edge · B | flip | 1–5 | flip only mirrors the end cuts | flip barely shows | canon |
| Stairs | `stairs` | frame | cell · I | four | 1–4 | foot at −Z, top tread at +Z (climbs toward r); handrail on +X | 4 looks | climb |
| Spiral Stairs | `stairs_spiral` | frame | cell · I | four | 1–4 | landing (exit upstairs) on +Z | 4 looks | climb |
| Loft Ladder | `ladder` | frame | cell · I | four | 1–4 | leans on its +Z side; climbs toward r | 4 looks | climb |
| Pergola Top | `pergola` | frame | cell · F | four | 2–5 | rafters run along local Z | r ≡ r+2 | pergola |
| Wall | `wall` | walls | edge · W | flip | 1–5 | outer face +Z (relief, footing) | flip barely shows | wallEdge |
| Half Wall | `wall_half` | walls | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Archway | `wall_arch` | walls | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Gable Wall | `gable` | walls | edge · W | flip | 1–5 | local +X uphill (set by autoGable) | 2 looks | gable |
| Gable Window | `gable_window` | walls | edge · W | flip | 1–5 | local +X uphill (set by autoGable) | 2 looks | gable |
| Window | `wall_window` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Tall Window | `wall_window_tall` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Picture Window | `wall_window_wide` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Round Window | `wall_window_round` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Arched Window | `wall_window_arch` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Shuttered Window | `wall_window_shutters` | openings | edge · W | flip | 1–5 | shutters & flower box on +Z unless floors say which side is outdoors (`outsideSide`) | 2 looks | wallEdge |
| Door | `wall_door` | openings | edge · W | flip | 1–5 | outer face +Z; knob on local +X (flip = hinge side) | 2 looks | wallEdge |
| French Doors | `wall_door_glass` | openings | edge · W | flip | 1–5 | outer face +Z; handles mirrored | flip barely shows | wallEdge |
| Barn Door | `wall_door_barn` | openings | edge · W | flip | 1–5 | outer face +Z | flip barely shows | wallEdge |
| Railing | `railing` | frame | edge · W | flip | 1–5 | symmetric | flip invisible | canon |
| Picket Fence | `fence_picket` | garden | edge · W | flip | 1–5 | pickets on the +Z face (rails behind) | 2 looks | fence |
| Split-Rail Fence | `fence_rail` | garden | edge · W | flip | 1–5 | rails set toward +Z | 2 looks | fence |
| Hedge | `hedge` | garden | edge · W | flip | 1–5 | slightly fuller on +Z | 2 looks | fence |
| Roof Slope | `roof_slope` | roof | cell · R | four | 1–5 | eave (downhill) at −Z, ridge side (uphill) at +Z | 4 looks | slope |
| Steep Roof | `roof_steep` | roof | cell · R | four | 1–5 | eave −Z, uphill +Z (a storey per cell) | 4 looks | slope |
| Hip Corner | `roof_corner` | roof | cell · R | four | 1–5 | hip: low along −X and −Z, peak at (+X, +Z) | 4 looks | hip |
| Valley Corner | `roof_inner` | roof | cell · R | four | 1–5 | valley: low only at the (−X, −Z) corner | 4 looks | valley |
| Steep Hip Corner | `roof_corner_steep` | roof | cell · R | four | 1–5 | hip: low along −X and −Z | 4 looks | hip |
| Steep Valley Corner | `roof_inner_steep` | roof | cell · R | four | 1–5 | valley: low only at the (−X, −Z) corner | 4 looks | valley |
| Skylight | `roof_window` | roof | cell · R | four | 1–5 | eave −Z, uphill +Z | 4 looks | slope |
| A-Frame Glass | `roof_steep_window` | roof | cell · R | four | 1–5 | eave −Z, uphill +Z | 4 looks | slope |
| Chimney | `chimney` | roof | cell · I | four | 1–5 | hearth opens to +Z, stack on the −Z side | 4 looks | back |
| Quilted Bed | `bed` | interior | cell · I | four | 1–5 | headboard −Z, foot +Z (the sleeper's head at −Z) | 4 looks | back |
| Nightstand | `nightstand` | interior | cell · I | four | 1–5 | back −Z; slides toward a bed at ±X | 4 looks | back |
| Wardrobe | `wardrobe` | interior | cell · I | four | 1–5 | back −Z, doors +Z | 4 looks | back |
| Chest of Drawers | `dresser` | interior | cell · I | four | 1–5 | back −Z, drawers & mirror face +Z | 4 looks | back |
| Cosy Sofa | `sofa` | interior | cell · I | four | 1–5 | back −Z, seat faces +Z | 4 looks | seat |
| Reading Armchair | `armchair` | interior | cell · I | four | 1–5 | back −Z, seat faces +Z | 4 looks | seat |
| Rocking Chair | `rocking_chair` | interior | cell · I | four | 1–5 | back −Z, faces +Z | 4 looks | seat |
| Rug | `rug` | interior | cell · D | four | 1–5 | long axis X (1.8 × 1.26 m) | r ≡ r+2 | rug |
| Braided Rug | `rug_round` | interior | cell · D | four | 1–5 | oval, long axis X | r ≡ r+2 | rug |
| Floor Lamp | `floor_lamp` | interior | cell · I | four | 1–5 | round; nothing to face | r ≡ r+2 | free |
| Bookshelf | `bookshelf` | interior | cell · I | four | 1–5 | back −Z, shelves face +Z | 4 looks | back |
| Stone Fireplace | `fireplace` | interior | cell · I | four | 1–5 | back −Z, firebox +Z; a villager stands at local z 0.75 | 4 looks | back |
| Wood Stove | `wood_stove` | interior | cell · I | four | 1–5 | back −Z, fire door +Z; a villager stands in front | 4 looks | back |
| Upright Piano | `piano` | interior | cell · I | four | 1–5 | back −Z, keys & bench +Z | 4 looks | back |
| Grandfather Clock | `grandfather_clock` | interior | cell · I | four | 1–5 | back −Z, face +Z | 4 looks | back |
| House Plant | `plant_pot` | interior | cell · I | four | 1–5 | leafy, nothing to face | 4 looks | free |
| Sleepy Cat | `cat` | interior | cell · I | four | 1–5 | curled up; cosmetic | 4 looks | back |
| Dog Bed | `dog_bed` | interior | cell · I | four | 1–5 | bolster bed with a sleepy pup; cosmetic | 4 looks | back |
| Farmhouse Table | `table` | interior | cell · I | four | 1–5 | long axis X (1.8 × 1.2 m); chairs tuck from any side | r ≡ r+2 | table |
| Ladder-back Chair | `chair` | interior | cell · I | four | 1–5 | faces +Z; tucks into a table in the +Z cell (`chairTuck`; never a desk, which has its own chair) | 4 looks | chair |
| Kitchen Sink | `kitchen` | interior | cell · I | four | 1–5 | back −Z, cupboards +Z | 4 looks | back |
| Kitchen Counter | `kitchen_counter` | interior | cell · I | four | 1–5 | back −Z, cupboards +Z | 4 looks | back |
| Cook Stove | `kitchen_range` | interior | cell · I | four | 1–5 | back −Z, oven doors +Z; a villager stands in front | 4 looks | back |
| Writing Desk | `desk` | interior | cell · I | four | 1–5 | back −Z, its own chair at +Z; a villager stands in front | 4 looks | back |
| Clawfoot Tub | `bathtub` | interior | cell · I | four | 1–5 | along X against −Z | 4 looks | back |
| Washstand | `washstand` | interior | cell · I | four | 1–5 | back −Z (mirror), basin +Z | 4 looks | back |
| Crates | `crate_stack` | interior | cell · I | four | 1–5 | loose stack; cosmetic | 4 looks | back |
| Barrel | `barrel` | interior | cell · I | four | 1–5 | barrel + keg; cosmetic | 4 looks | back |
| Oak Tree | `tree_oak` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Pine Tree | `tree_pine` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Birch Trees | `tree_birch` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Apple Tree | `tree_apple` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Bush | `bush` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Flower Patch | `flowers` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Lavender | `lavender` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Sunflowers | `sunflowers` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Vegetable Bed | `veggie_bed` | garden | cell · I | four | 1–5 | long axis X | 4 looks | front |
| Pumpkin Patch | `pumpkins` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Mossy Boulders | `boulders` | garden | cell · I | four | 1–5 | organic | 4 looks | free |
| Lily Pond | `pond` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Garden Bench | `bench` | garden | cell · I | four | 1–5 | backrest −Z, seats face +Z (town: approached from the front cell) | 4 looks | bench |
| Picnic Table | `picnic_table` | garden | cell · I | four | 1–5 | long axis X, benches ±Z | 4 looks | table |
| Fire Pit | `fire_pit` | garden | cell · I | four | 1–1 | log seats on −Z and +X | 4 looks | free |
| Lamp Post | `lamp_post` | garden | cell · I | four | 1–5 | basket arm +X | 4 looks | front |
| Mailbox | `mailbox` | garden | cell · I | four | 1–5 | door +Z, flag +X | 4 looks | front |
| Birdhouse | `birdhouse` | garden | cell · I | four | 1–5 | hole +Z | 4 looks | front |
| Birdbath | `birdbath` | garden | cell · I | four | 1–5 | near-round | 4 looks | free |
| Wishing Well | `well` | garden | cell · I | four | 1–1 | crank along X | 4 looks | front |
| Woodpile | `woodpile` | garden | cell · I | four | 1–5 | rack −Z, chopping block +Z (the woodcutter works from the +Z cell) | 4 looks | front |
| Hay Bales | `hay_bale` | garden | cell · I | four | 1–5 | a seat with a view; uneven pile | 4 looks | front |
| Wheelbarrow | `wheelbarrow` | garden | cell · I | four | 1–5 | wheel +Z, handles −Z | 4 looks | front |
| Washing Line | `clothesline` | garden | cell · I | four | 1–1 | line along X, basket +Z | 4 looks | front |
| Chickens | `chickens` | garden | cell · I | four | 1–1 | organic | 4 looks | free |
| Beehive | `beehive` | garden | cell · I | four | 1–5 | entrance +Z | 4 looks | front |
| Doghouse | `doghouse` | garden | cell · I | four | 1–5 | door +Z | 4 looks | front |
| Scarecrow | `scarecrow` | garden | cell · I | four | 1–1 | face +Z | 4 looks | front |
| Flower Cart | `gift_flower_cart` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Hen House | `gift_hen_house` | garden | cell · I | four | 1–1 | front at +Z (gift) | 4 looks | front |
| Carved Bear | `gift_carved_bear` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Little Rowboat | `gift_rowboat` | garden | cell · I | four | 1–1 | front at +Z (gift) | 4 looks | front |
| Honey Stand | `gift_honey_stand` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Bread Oven | `gift_bread_oven` | garden | cell · I | four | 1–1 | front at +Z (gift) | 4 looks | front |
| Festoon Lights | `gift_festoon` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Signpost | `gift_signpost` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Garden Gnome | `gift_gnome` | garden | cell · I | four | 1–5 | front at +Z (gift) | 4 looks | front |
| Tea Table | `gift_tea_table` | garden | cell · I | four | 1–5 | two stools; near-symmetric | 4 looks | table |

**How the village reads facings** (so smart facing should produce these):

| Reader | Uses `r` for | Best facing |
|---|---|---|
| `sim.js` sleep spot | sleeper at local (0, −0.10), head toward local −Z, yaw `(r+2)·90°` | headboard against a wall |
| `sim.js` seats (sofa ±0.4, armchair, rocker, chair) | sitter at local (lx, lz) facing `r·90°`; a chair's `lz = CHAIR_SEAT_Z[chairTuck]` | chairs face a table; seats face into the room / the hearth |
| `sim.js` `byPlace` (range, desk, fireplace, stove) | stands at local (slot, +0.75) facing −DIRS[r] | back to the wall, front open |
| `sim.js` woodcutter | works from the woodpile's +Z cell | front open, away from the house |
| `recipes.js` SPOT_DEFS bench / rocking chair (`approach: 'front'`) | approached from DIRS[r] cell; seats face `r` | front cell free and walkable |
| `recipes.js` picnic table, fire pit, tea table, boulders, hay | seats placed by `r` (any approach) | any |
| `wishes.js` `rotFor` (Show me spots) | its own facing for wish recs (bed: back to a wall) | unchanged; Show me snaps with the rec's `r` |

---

## 4. Smart facing

### 4.1 Where it runs

`builder.resolve(sx, sy)` decides the **slot exactly as today** — steps 1–4 and the floor plane, untouched: guides,
gables, gap filling (`_gapSlot`), stroke lines (`_strokeLine`), the piece under the finger only on the active level
(`e.p.y === L`, or `_swapAcross` for an opening below the top rim — the top rim still means "build on top"), roof
panels (`fixed === 'roof'`), roofs settling on wall tops (`roofLv`, `lift`). Only then does it decide `p.r`.

**The pre-facing slot.** Everything that must survive a change of facing is keyed by the slot as it stands before
`r` is known: `slotKey = layer|a|x|y|z` for cell, edge and corner pieces (their world keys don't contain `r` either)
and `R|x|y|z|roofLv|lift` for roof panels, whose world key `R|x|hs|z` (`hs = 2y + h`) depends on `r` through
`autoRoofHeight`. The pin (§5.2), the memo (§4.6) and the Show me hints (§5.5) use `slotKey`, never the final key.

Replace today's

```js
if (def.rot === 'four') p.r = state.rot & 3;
else if (def.rot === 'flip') p.r = state.rot >= 2 ? 2 : 0;
```

with this order (first match wins):

| Case | `p.r` | `out.action` |
|---|---|---|
| `fixed === 'guide'` (a blueprint guide) | the guide record's `r` (today) | `place` / `replace` |
| a **Show me hint** for `slotKey` (the town's highlighted rec, §5.5), the slot not already holding that part | the rec's `r` (roofs: its `h` too) | `place` / `replace` |
| **same part in the slot** (§5.1 T1 / T2: the slot holds it, or a furniture-like piece under the finger when the slot is no sensible place) | identical look → `turnOf(def, cur.r)`; other look → `cur.r` | `turn` / `restyle` |
| `fixed === 'roof'` (a *different* roof piece tapped onto a panel) | the tapped panel's `r` (it swaps in place) | `replace` |
| a **pin** for this `slotKey` (Turn / R on a preview of an empty slot, §5.2) | `pin.r` | as the slot says |
| a draw stroke's line facing (fences, hedges, railings, §5.4) | the line's memo | `place` |
| otherwise | `autoFacing(def, p, ctx).r` (memoised, §4.6) | `place` / `replace` |

Then, as today: roof `h` from `autoRoofHeight(def, x, z, p.r, …)` (except `turn` / `restyle` of a panel and a hinted
roof, which keep their `h`), and `autoGable` (which overrides `r` when it finds a roof). `resolve()` returns `{ p, def,
key, slotKey, valid, reason, existing, action, facing }` where `facing = { rule, tie, fallback }` (for tests and the
one-time tip).

Never decided by smart facing: guide snaps, Show me snaps (`town/index.js snapToHighlight` places `rec.r`) and their
previews, autoGable pieces under a roof, `world.load` / `stamp` / undo / redo, contextual rebuilds.

### 4.2 `js/facing.js` (new core module, pure: imports `config.js` and `catalog.js` only)

```js
export const FACE;            // rule group per piece id (the table in §3, column "rule")
export const SYM;             // { deck: 2, pergola: 2, rug: 2, rug_round: 2, table: 2, floor_lamp: 2, railing: 1 }
export function faceGroup(def)            // def.face ?? (autoGable ? 'gable' : R kind) ?? FACE[id] ?? (edge ? 'canon' : 'front'); null for rot 'none'
export function symOf(def)                // 1 (all alike) | 2 (r ≡ r+2) | 4
export function turnable(def)             // rot !== 'none' && !autoGable && symOf(def) !== 1
export function turnOf(def, r, dir = 1)   // four: (r + dir) & 3 ; flip: r >= 2 ? 0 : 2
export function sameFacing(def, a, b)     // equal up to the piece's symmetry
export function roofHeight(get, def, x, z, r, L)   // today's builder.autoRoofHeight body, over a getter
export function autoFacing(def, p, ctx)   // → { r, rule, tie, fallback, scores }
//   ctx = { get(key) → record | undefined,   // world.get, or a masked getter in tests
//           cam: [cx, cz],                    // unit vector target → camera: [sin θr, cos θr], θr = rig.goal.theta
//                                             //   rounded to 0.01 rad (the memo of §4.6 keys on θr, so it is exact)
//           fallback: 0..3,                   // state.rot
//           roofLevel, lift }                 // roofs: the level whose floor plane is the wall tops; the lift (half-steps)
```

* `registerPiece` passes an optional `face: '<group>'` (and `sym`) through unchanged (catalog.js comment); new pieces
  can declare their rule there. `FACE` is the fallback table for the current pieces.
* `builder.autoRoofHeight(def, x, z, r, L)` stays as the public API (the town calls it) and becomes
  `roofHeight((k) => this.world.get(k), def, x, z, r, L)`.
* Add `js/facing.js` to `CORE` in `sw.js` and bump `VERSION`.

### 4.3 Lookups (all `get(key)` on slot keys)

```js
DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0]; opp(d) = (d + 2) & 3
yaw4(dx, dz) = |dx| >= |dz| ? (dx >= 0 ? 1 : 3) : (dz >= 0 ? 0 : 2)
eKey(x, y, z, d): d0 K.W('x', x, y, z+1) · d1 K.W('z', x+1, y, z) · d2 K.W('x', x, y, z) · d3 K.W('z', x, y, z)   (bKey: same with K.B)
edge(x, y, z, d): class of the W piece on that side of cell (x, z):
   openings → 'door' (wall_door*) | 'window';  wall_arch → 'door';  wall_half → 'half';  other walls (wall, gables) → 'wall';
   railing → 'rail';  fences & hedges → 'fence';  none → null
solidEdge(c) = c is 'wall' | 'window' | 'half'
beam(x, y, z, d) = !!get(bKey(…))
fk(x, y, z): F kind — foundation / floor → 'room'; else the piece id (deck, path, steps, pergola); none → null
item(x, y, z) = get(K.I(x, y, z)); rug(x, y, z) = get(K.D(x, y, z)); roofAt(x, z, hs) = get(K.R(x, hs, z))
roofed(x, y, z) = any roofAt(x, z, hs) for hs in 2y .. 2y + 12
roofWall(x, y, z): a slope panel at hs 2y or 2y+1 over this cell (an A-frame's roof is its wall) → its downhill dir opp(r), else −1
insideness(x, y, z) = (fk = 'room' ? 3 : fk = 'deck' ? 1 : 0) + (roofed ? 1 : 0) + (fk(x, y+1, z) is room/deck ? 1 : 0)
wallDist(x, y, z, d, max, test): k = 0.. max: if test(edge(cx, y, cz, d)) return k; step one cell toward d.  → Infinity
bldKind(x, y, z) = fk = 'room' → 'room' ; else a wall / window / door on one of its 4 edges → 'wall' ; else null
   (half walls, fences, railings are not a house)
ownWalls(x, y, z): the sides d of the cell itself that hold a wall / window / door → { dx: Σ DX[d], dz: Σ DZ[d] },
   null when none or when they cancel (a cell between two parallel walls)
nearestBuilding(fx, fz, y, rad = 6): where the nearest building lies from a centre (fx, fz) in cell units — cell (i, j)
   spans [i, i+1] × [j, j+1]; a cell piece's centre is (x + .5, z + .5), an edge's midpoint (x + .5, z) for axis x,
   (x, z + .5) for axis z. Ring k (1..rad) = the cells whose centre is at Chebyshev distance k−1 < d ≤ k from it.
   The FIRST ring with any building cell decides: the mean offset (centroid) of its 'room' cells, or, if it has none,
   of its 'wall' cells → { dx, dz, k, kind }; null when no ring has one. Never the first hit in scan order.
   (≤ 168 cells for a cell centre, 156 for an edge midpoint, × 5 keys; stops at the first ring with a hit)
awayFrom(dx, dz): the facing(s) whose front points away from that offset: |dx|, |dz| both < 0.25 → none (the piece
   sits in the middle of it); ||dx| − |dz|| < 0.25 (a diagonal) → both axes, yaw4(−dx, 0) and yaw4(0, −dz);
   else yaw4(−dx, −dz)
visible(x0, z0, x1, z1, y): an L path (x first, or z first) crosses no solid edge
roofReach(x, lv, z, d, max = 10): cells from (x, z) to the edge of the roofed footprint toward d:
   b = lv − 1; onPlat(c) = fk(c, b) || fk(c, lv); plat = onPlat(start)
   k = 0..max: if b >= 0 and (W holdsRoof or B) on edge (cx, b, cz, d) → k
               if plat and !onPlat(next) → k          // the platform's edge (an A-frame's roof rests on its foundation)
               step.   → Infinity
leansOn(x, lv, z, d): the reach toward d ends at a wall the roof LEANS ON rather than an eave:
   k = roofReach(x, lv, z, d) finite, lv ≥ 1, the edge (x, z) + k·DIRS[d] toward d on level lv − 1 holds a wall /
   opening (not a beam), and either
     (a) the same edge on level lv also holds a wall / opening that is not a gable (the wall carries on up: a taller
         house beside a lean-to, an upper storey over a skirt roof), or
     (b) the roof cell's own floor fk(x, lv − 1, z) is not a room (a porch deck, the grass) and the cell beyond that
         wall is a room (a porch or shed roof against the house)
covered(c, lv) = fk(c, lv − 1) = 'room' || roofReach(c, lv, d, 8) is finite for all four d   // inside the walls
```

### 4.4 Deciding

Each rule fills `S[r]` for its candidate facings (`cands`: four-way 0..3; flip 0, 2; `SYM 2` pieces 0, 1).

```js
pick(S, cands, camPref):
  if every S[r] === 0 → null                                   // no signal at all
  top = cands with S[r] === max
  if top.length === 1 → { r: top[0] }
  → { r: argmax over top of camPref(r) (first wins on equality), tie: true }
autoFacing(): res = pick(...) ?? { r: normalise(ctx.fallback), fallback: true }
   normalise: flip → (fb >= 2 ? 2 : 0); SYM 2 → fb & 1; else fb & 3
```

`camPref` defaults to "front toward the camera": `DX[r]·cam.x + DZ[r]·cam.z`. Rules override it where the visible
face is another side (roof slopes and stairs: `−(…)`, the downhill face / the foot toward the viewer; edges: the
outer face toward the viewer; `SYM 2`: the long side toward the viewer, `r 0` when `|cam.z| ≥ |cam.x|`).

Ties are real ties, never an artefact of loop order: a building offset on a diagonal scores both "away" facings
(`awayFrom`), and the camera — what the player is looking at — breaks it. When the camera itself is exactly between
two candidates (θ on a 45° line), the lower `r` wins (stable, documented, tested).

With a signal, `autoFacing` also returns `order`, the order a tap again steps through (§5.1): the winner first, then
the other candidates by score (ties broken as above); for a roof slope the winner's opposite comes second (a wrong
slope guess is the other side of the ridge far more often than a sideways panel). Tables (the rule knows only the
long axis; a picnic table turned half way looks the same) and spots with no signal have `order: null`: a tap there
turns +90°. `nextFacing(def, r, order, cont)` walks it: a fresh tap on a piece not facing `order[0]` goes to
`order[0]`; a fresh tap on one facing `order[0]` goes to `order[1]`; a tap that carries on a run (`cont`: the last
tap again turned this same piece and nothing has changed since) goes to the facing after `r` (repair round 2, §15).

### 4.5 The rules

Weights below are the prototype's (§10 numbers); keep them unless a test proves a better value.

#### wallEdge — walls, half walls, archways, windows, doors (and gables when autoGable finds no roof)

Local +Z points **outdoors**. For edge `p`: `plusD = a === 'x' ? 0 : 1`, `plus = (x, z)`, `minus = a === 'x' ? (x, z−1) : (x−1, z)`.

```
inP = insideness(plus), inM = insideness(minus)
encP = wallDist(plus, plusD, 8, solidEdge) < ∞ ? 1 : 0          // the plus side has an opposite wall: a room
encM = wallDist(minus, opp(plusD), 8, solidEdge) < ∞ ? 1 : 0
s = (inM + encM) − (inP + encP)          // > 0: plus is outdoors → r 0
if s: S[0] += s, S[2] −= s
else: a collinear wall-like neighbour (W on the same line, x±1 / z±1) → +1 to its r
camPref: the outer face toward the camera
```

Works for houses on foundations, walls straight on the grass (the opposite-wall probe), upper floors, porches (a deck
counts 1, a room 3) and partitions (tie → collinear → camera). Shuttered windows over a floor still read their
outdoor side from floors (`outsideSide`), so their look is right either way.

#### gable — Gable Wall, Gable Window

`autoGable` sets `r` (local +X uphill) whenever a roof slope runs along the edge — unchanged. With no roof found it
keeps the wallEdge facing. Not turnable (§5.1).

#### fence — Picket Fence, Split-Rail Fence, Hedge

The good face (+Z: pickets) faces **the street**: in Hearthwood that is a path beside the fence, else away from the
house.

```
path: a path (or porch steps) in the cell right beside the edge, or the next one out, on ONE side only
      → +5 to the facing whose good face points at it (plus side → r 0, minus side → r 2)      // outweighs the house
house: nb = nearestBuilding(edge midpoint, y, 6); off = nb's offset across the line (> 0: on the plus side)
      off ≥ 1 → S[2] += 3 ; off ≤ −1 → S[0] += 3 ; |off| < 1 → nothing (the house lies along the fence line)
a collinear neighbour of the same kind → +1 to its r
```

Fences flanking the path to the front door both show their pickets to the path (Appendix B, N14); a yard fence with
no path beside it faces away from the house. In a draw stroke, every segment on one grid line takes the facing its
first segment decided (§5.4).

#### canon — Railing, Beam

The flip of a railing is invisible and a beam's only mirrors its end cuts: `S[0] += 1` (blueprint convention), or a
collinear neighbour of the same layer → +4 to its r. Railings are not turnable (`SYM 1`, no Turn button).

#### slope — Roof Slope, Steep Roof, Skylight, A-Frame Glass

Downhill (local −Z, `D = opp(r)`) toward the nearest eave; rows continue; must agree with `autoRoofHeight`.

```
lv = roof level (resolve's roofLv: 1..MAX_LEVEL+1), dist[d] = roofReach(x, lv, z, d)
spanX = dist[1] + dist[3] + 1, spanZ = dist[0] + dist[2] + 1, rise = def.roof.rise
for r in 0..3:
  h  = roofHeight(get, def, x, z, r, lv) + lift          // the same h resolve() will store
  hs = 2·p.y + h                                          // this panel's slot height if facing r
  +8 per row neighbour: roofAt(cell toward r±1, hs) is a non-flat panel with r                 (continue the row)
  +6 stacked: roofAt(cell toward D, hs − rise) has r                                           (the panel below it)
  +4 ridge partner: roofAt(cell toward r, hs) is a slope facing opp(r)                          (two top rows meet)
  −6 back to back: roofAt(cell toward D, hs) is a slope facing D
  lean-to: leansOn(r) and not leansOn(D) → +5 ; leansOn(D) and not leansOn(r) → −5     // uphill toward the wall it
                                                                                        //   leans on, at any depth
  if dist[D], dist[r] finite:
     if neither side leans on a wall:
        dist[D] < dist[r] → +3 ; > → −3                    // downhill toward the nearer eave
        equal → +1 if insideness just past the reach on the downhill side < on the uphill side (−1 if >)
     across = D is ±Z ? spanZ : spanX; along = the other
     across < along → +2 ; > → −2                          // ridge along the longer axis (like a gable)
     equal (square) → +1 if the door walls are on one axis and the slope runs along it   // the gable end over the door
camPref: the downhill face toward the camera
```

A wall the roof leans on is never an eave, so lean-tos and porch roofs of any depth slope away from the house — with
or without the house roof already on (Appendix B, N1–N7) — while a gable wall standing on the same edge (a gable end)
does not count as "carrying on up" and ordinary eaves are unchanged (N8, N9). A porch row that is meant to continue
the house roof (the Log Cabin) does so as soon as the house row beside it exists (row +8 beats lean-to +5); placed
before it, it becomes a lean-to (§10.3).

`doorAxis`: scan each wall line at `dist[d]` (±8 cells along it) for a door edge; 0 = doors only on ±Z walls,
1 = only on ±X, −1 = none / both. Square house with a front door → ridge toward the door → gable over the door (the
shed blueprint). A roof over the top floor's walls uses `lv = MAX_LEVEL + 1` and `lift = 2` exactly like resolve.

#### hip — Hip Corner, Steep Hip Corner (low on local −X and −Z)

```
lo1 = opp(r), lo2 = (r + 3) & 3
if dist[lo1], dist[lo2] finite: S[r] += 6 − min(6, dist[lo1] + dist[lo2]) − (dist[r] < dist[lo1] ? 3 : 0) − (dist[r+1] < dist[lo2] ? 3 : 0)
+6 roofAt(toward r+1, hs) faces r ; +6 roofAt(toward r, hs) faces r+1     // the two slope rows it closes
```
A 4×4 house: NW corner → r 0, NE → r 3, SE → r 2, SW → r 1 (Appendix A, F34–F37).

#### valley — Valley Corner, Steep Valley Corner (low only at the local (−X, −Z) corner)

```
+6 roofAt(toward opp(r), hs) faces r+1 ; +6 roofAt(toward r+3, hs) faces r      // the two wing slopes (autoRoofHeight's probes)
+4 the low diagonal cell (toward opp(r) and r+3) is not covered while both cells beside it are   // the notch of an L
   covered(c) as in §4.3: a room under it, or walls round it in all four directions (direction-free, so all four
   orientations of an L agree — Appendix B)
```

#### climb — Stairs, Spiral Stairs, Loft Ladder (climb toward r onto the floor above)

```
anyUp = some 4-neighbour of (x, z) has an F piece on y+1
for r: exit = (x, z) + DIRS[r], foot = (x, z) − DIRS[r]
  anyUp: fk(exit, y+1) room/deck → +6 else −6
  solidEdge(edge(x, y+1, z, r)) → −3                         // a wall where you step off upstairs
  ladder: beam on edge (x, y, z, r) → +3, else solidEdge there → +2 ; solidEdge behind (opp r) → −2
  stairs & spiral: a solid side edge (r±1) → +3 (along a wall); solid or door edge at the foot (opp r) → −6;
                   else a solid item on the foot cell (not rug, cat, plant) → −4   // (one behind that wall: no matter)
                   foot cell is a room → +1
camPref: the foot toward the camera
```

#### steps — Porch Steps (climb toward r onto the platform)

```
f = fk(cell toward r, 0), b = fk(cell toward opp r, 0)
f room/deck → +6 (+1 deck) ; a door edge round that platform cell → +1
no platform beside it (steps laid before the porch): the nearest building (nearestBuilding, 6 rings) → +3 to the
   facing(s) climbing toward it (opp of awayFrom)
b path → +2, another floor → −2, none → +1 only once a term above scored (in the open meadow nothing scores: the
   fallback, D4 — before repair round 1 the +1 on all four was a signal and the camera decided)
camPref: the foot toward the camera
```

#### deck (Porch Deck) & pergola (Pergola Top) — `SYM 2`, candidates 0 / 1

```
a 4-neighbour of the same piece → +6 to its (r & 1)
deck: each side d with a room cell beyond or a wall/door edge → +3 to (d even ? 1 : 0)   // boards run away from the house
      else, the next cell toward d empty or a deck and the house one further (a room, or a wall/door on that cell's
      far edge) → +2 to the same axis                                                      // the second row out
pergola: each beam (or solid edge) under its sides on y−1 → +3 to (d even ? 0 : 1)       // rafters (local Z) rest across the beams
camPref: the long side toward the camera
```

#### back — bed, nightstand, wardrobe, dresser, bookshelf, fireplace, wood stove, piano, grandfather clock, kitchen sink / counter / cook stove, desk, washstand, bathtub, chimney, dog bed, crates, barrel, cat

Back (local −Z) against the best wall, front into the room. For each front `f` (back `b = opp(f)`):

```
c = edge(x, y, z, b)
s = wall 10 | window (desk 11, low pieces 8, TALL 4.5) | half 6 | door −20 | rail/fence 4
    | roofWall(here) = b → 7
    | else (only when the cell has nothing to stand against: no wall, window, half wall, railing or fence on any of
           its own edges, and no roofWall(here) — `own`, back group only; seats and chairs always use it)
           k = wallDist(b, 3, solidEdge): k < ∞ → max(0.5, 5 − 1.5k) ; else roofWall(next cell toward b) = b → 4
         and, either way, an item in the cell behind (not rug, cat, plant) → −2   // never its back against a piece
HEARTH (fireplace, wood stove, chimney) with a wall/window behind whose far cell is not a room → +2   // an outside wall for the flue
solidEdge(edge toward f) → −8                                       // never face a wall
item in the front cell (not rug, cat, plant, chair) → −2
front cell is a room → +0.5
company, for each side neighbour (f±1) already facing f: kitchen next to kitchen → +4; nightstand ↔ bed → +6
TALL = wardrobe, bookshelf, grandfather clock, fireplace, wood stove, cook stove, chimney, washstand
```

A TALL piece would rather not stand in front of a window (a plain wall beside it wins: 10 > 4.5). A piece of the back
group with a wall, window, half wall, railing or fence on one of its own edges never scores the "wall a cell or more
away" fallback, so a facing with its back to open floor gets at most +0.5 (the room in front) plus the company terms,
and its own window (4.5, less 2 for a table in front) still wins: before repair round 1 (TALL window 3) a cook stove in
the second cell from a corner on a window wall turned sideways, its back to open floor and its flank on the glass (S1.1,
§14); after repair round 1 (window 4.5, the fallback 3.5) it did again whenever a table, counter, bed, sofa or crates
stood in front of it (4.5 − 2 < 3.5; S2.4, §15). In a hallway one cell wide the same rule stands a wardrobe against a
long wall facing across, rather than sideways along the hall. The fallback stays for seats and chairs: an armchair's
hearth term and a chair's table term turn them away from a wall on purpose, and the far wall keeps backing them up.

A chimney tapped onto a roof stands on the storey under it (today) and uses that storey's walls.

#### seat — sofa, armchair, rocking chair

```
hearth (fireplace, wood stove, chimney) within 2 cells (Chebyshev), same level, visible, and the seat IN FRONT of its
   firebox: dot(seat − hearth, DIRS[hearth.r]) ≥ 1 → +12 toward yaw4(it)
   (a seat beside the hearth on the same wall gets nothing from it and faces the room by the back rule — N10)
indoors (cell is a room): then the back rule above (adds to the hearth score)
outdoors / on a porch: porch = fk = 'deck'; a wall/window/door edge behind at k ≤ (porch ? 2 : 0) → +8 / +5 / +3
                      (sit with the house at your back)
                      then, ONLY IF some term above already scored: +1 per free, walkable front cell
                      (nothing scored → the fallback: a rocker in the open meadow takes the player's last facing)
```

#### chair — Ladder-back Chair

```
+20 toward a 4-neighbour table / picnic table / tea table with no solid edge between   // chairTuck tucks it in
   (never a desk: it brings its own chair, and a chair at its side would face its flank — N15)
then the back rule (a chair with no table stands against a wall, facing the room)
```

#### bench — Garden Bench

```
focal (pond, fire pit, birdbath, well, tea table) within 2, visible → +12 toward it
porch (on a deck): a wall/window/door behind within 2 → +8 / +5 / +3 ; on grass only the edge right behind (k 0)
a path within 2 cells straight ahead → +6 / k
a fence / railing / half wall right behind → +2
nothing so far → face the house: nb = ownWalls(cell) || nearestBuilding(centre, y, 6) → +3 to opp(each awayFrom(nb))
then, ONLY IF some term above already scored: +1 per free, walkable front cell (town SPOT_DEFS approach 'front')
nothing scored at all (the open meadow) → the fallback (F45, N16)
```

#### table — Farmhouse Table (`SYM 2`), Picnic Table, Tea Table

```
long axis (X: r 0, Z: r 1): a same table as a 4-neighbour in the same room → +6 to that axis (a long table)
the room's longer span (wallDist both ways ≤ 8) → +0.5
SYM 2: candidates 0 / 1, camPref long side toward the camera; else r and r+2 score alike (camera tie)
```

#### rug — Rug, Braided Rug (`SYM 2`)

```
+1 to an axis per item in a 4-neighbour cell on that axis, same room only (the rug runs toward the furniture beside it)
the room's longer span → +0.5 ; camPref: long side toward the camera
```

#### front — garden things with a front (mailbox, birdhouse, doghouse, scarecrow, beehive, woodpile, wheelbarrow, well, lamp post, washing line, vegetable bed, hay bales, the gifts)

```
nb = ownWalls(cell)                       // right against the house: the wall on its own edge decides
     || nearestBuilding(centre, y, 6)     // else the centroid of the nearest ring's room cells (else wall cells)
→ +6 to each facing of awayFrom(nb)       // face away from the house (the street, the garden); a diagonal: both
a 4-neighbour of the same piece → +4 to its r                          // rows of hay, hives, veg beds
if any signal: +0.5 per open front (no item, no solid edge)
```

A woodpile stacked against the house faces away from it on every side, on a foundation or on the grass (the
woodcutter works from its +Z cell) — Appendix B, N12 (48 checks).

#### free — trees, bush, flowers, lavender, sunflowers, pumpkins, boulders, pond, chickens, house plant, floor lamp, fire pit, birdbath

No rule: always the fallback (the facing the player last chose; 0 at first, which also matches every blueprint).

### 4.6 Cost

Measured with the revised prototype in the page (desktop SwiftShader, farmhouse stamped, 400 random spots per piece
over the whole lot, median of 5 passes; ranges over four runs): average per call by group — tree (free) 0.3 µs, steps
2–4, deck 3–5, table / rug / sofa 6–8, stairs 7, wall / door 9–13, chair / bed 10–11, roof slope 30–43, hip 40–55,
valley 54–62, fence / hedge 61–71, woodpile / mailbox 62–75, bench 74–80. The worst spot is a garden piece in an empty
meadow corner (every ring searched, nothing found): 0.08–0.15 ms. Over 7,200 single calls per run: p99 0.2 ms, max
0.3–1.3 ms (one-off GC / JIT spikes; the page timer's resolution is 0.1 ms).

* Memo: the builder keeps the last answer keyed by
  `${world.version}|${slotKey}|${def.id}|${θr}|${fallback}` — `slotKey` is the pre-facing slot of §4.1 (for roofs it
  already holds `roofLv` and `lift`), `θr` the rounded camera angle autoFacing itself uses (§4.2), so a hit is exactly
  what a fresh call would return. Only `autoFacing` is memoised; the guide / hint / same-part / pin / stroke cases of
  §4.1 are cheap lookups done on every resolve. Pointer moves inside one slot cost nothing.
* Budget (smart-regress J): median ≤ 0.1 ms, p99 ≤ 1 ms per call over 2,000 resolves on the farmhouse.

---

## 5. Turning and every interaction

### 5.1 Tap again (touch tap, aim lift, mouse click)

**Slot first.** `resolve()` decides the slot exactly as today (§4.1) — so every rule that decides *where* a tap goes
keeps working: a tap into a gap fills the gap (not the wall seen through it), a tap on the top rim of a Floor-1 wall
while on Floor 2 builds a Floor-2 wall on top (step 3 only takes a picked edge on the active level), a roof piece
tapped onto a panel takes that panel's slot and height. Only then does it ask whether that slot already holds the
part in hand. Let `K0` be today's slot, `cur0 = world.get(K0)` (roofs: the tapped panel of `fixed === 'roof'`; a roof
placed from a wall top has no `cur0`, its key depends on `r`), `pick` the piece under the finger, `L` the level:

```
if drawing || fixed === 'guide' || !turnable(def) → no turn (today's behaviour)
T1  the piece under the finger, furniture-like cell pieces only:
    pick && pick.entry.def.id === def.id && pick.entry.p.y === L && def.slot === 'cell' && faceGroup(def) !== 'free'
    && ( K0 is not a valid EMPTY spot (!valid || cur0)                        // nowhere sensible to put a new one
         || !visible(pick cell, K0's cell, L)                                  // its ground is hidden behind a wall
         || def.layer === 'I' && K0's cell is next to the pick's (Chebyshev 1) ) // the floor right behind it, under
    → target = pick.entry (take its slot)                                      //   the finger on it (repair round 1)
T2  the slot itself: cur0 && cur0.t === def.id
    && !(pick && pick.entry.def.id === def.id && pick.entry.key !== K0)       // never a piece other than the one
    → target = cur0                                                            //   the finger is on
target && !(guided build && blueprint keys has target.key with the same t)    // never spoil a guide-built piece
  → would-be look (m, c, k as materialFor / colorFor / accent give) equal to target's (after normalize)
       ? action 'turn',    p.r = nextFacing(def, target.r, autoFacing(def, target.p).order, cont)   // the preview shows it
                           //   cont: the last tap again turned this very piece to target.r and world.version is unchanged
       : action 'restyle', p.r = target.r
```

**The turn order** (repair round 1): a tap again goes to the **next most likely** facing for the piece's spot — the
facing after its current one in `autoFacing`'s `order` (§4.4: the rules' best first, then the rest by score; a roof
slope's opposite right after its best) — and round all of them with more taps. So stairs along a wall climb the other
way along it, a roof slope flips to the other side of the ridge, a bed in a corner moves to the other wall, each with
one tap; before, every tap was +90° and those fixes took two taps through a broken middle (stairs climbing into the
wall, a sideways roof panel). Edge pieces still flip; tables and spots with no signal still turn +90°. Turn / R stay a
plain quarter (`turnOf`, §5.2) — the predictable override.

**Best first** (repair round 2, S2.2): the order is worked out at the moment of the tap, from the room as it is then, and
a placed piece is often not facing its first entry any more — a corner bed whose tie went the camera's way, then a
nightstand beside its foot; an armchair against the front wall, then a fireplace; a chair against a wall, then a table
beside it. Stepping "after its facing" then went through two wrong facings before the one the rules now prefer. So the
**first** tap again on a piece that is not facing `order[0]` turns it straight to `order[0]` (one tap fixes it); on one
already facing `order[0]` it goes to `order[1]`, as before. The taps after that, on the same piece with nothing else
changed (`builder._turnRun = { key, r, v: world.version }`, set by a tap-again turn), carry on round the order, so a run
of four taps visits every facing: bed r 1 → 0 → 1 → 2 → 3, armchair r 2 → 3 (facing the fire) → 2 → 1 → 0. Turn / R,
an undo, any other change to the world or a tap on another piece starts a fresh run.

What this means in play — taps on a cell piece, measured with the real `resolve()` and mesh picks (revise/pick-rev.js:
a 24 × 24 grid over the piece's screen box, the points whose ray hits its mesh; desktop and iPhone 13 give identical
results; default view θ π/4 φ 1.0, a low view θ 0.15 φ 1.38, a high view φ 0.6):

| Piece | Where | Taps on the piece that turn it (default / low / high view) |
|---|---|---|
| wardrobe | against the back wall · the side wall | 380/383 · 484/484 · 317/323 — 377/380 · 411/460 · 319/325 |
| bookshelf | against the back wall | 422/423 · 521/521 · 351/352 |
| grandfather clock | against the side wall | 411/411 · 450/477 · 380/380 |
| bed | against the back wall | 221/262 · 354/359 · 237/249 |
| kitchen counter | against the back wall | 298/313 · 466/468 · 237/260 |
| wardrobe / bookshelf / clock | middle of a room | 15–47% (the lower part); since repair round 1: wardrobe 263/368 · 127/127 · 312/312 |
| bed / armchair | middle of a room | bed 16–79%, armchair 22–100%; since repair round 1 every tap on them: 262/262 · — · 257/257, 316/316 · — · 289/289 |
| sofa / table / bench (repair round 1) | middle of a room / on the grass | before: sofa 165/307 · — · 234/273, table 88/199 · — · 201/242, bench 169/205 · 146/271 · 201/207; after: all of them, the low-view bench 269/271 |
| woodpile | on the grass | 30–60%; since repair round 1 213/213 · 186/245 · 180/180 |
| oak / apple tree (`free`) | on the grass | 3–20% (the trunk base); taps on the canopy over the cells behind: **0** of 4–76 turn |

* **Walls, windows, doors, fences, roof panels**: tap the piece → its own slot → it turns (T2). A tap into a gap still
  fills the gap; a tap on a lower floor's wall top still builds on top (measured by the critique: 25/25 gap taps and
  4/4 wall-top heights resolve exactly as today, so T2 never sees the far wall).
* **Furniture against a wall** (the usual place — the back rule puts it there): 84–100% of taps anywhere on the piece
  turn it: the floor point behind it is across the wall (T1).
* **Furniture in the open middle of a room** (and garden things on the grass): since repair round 1 a tap anywhere on
  the piece turns it — a tap high up whose floor point is the cell right behind it means the piece under the finger,
  not that hidden cell (before, 3–56% of the taps on a sofa, table, bench or bed, by view, placed a second one behind it). Only
  a tap whose floor point lies two or more cells behind (the top of a tall wardrobe from a low view) still places there,
  and with **another part in hand** a tap on the piece furnishes the cell behind it as before (T1 needs the same part).
  Decks and porch steps (layer F) still grow from a tap at their edge. The press preview shows which before the finger
  lifts. (Measured with the real `resolve()` over a 24 × 24 grid of the piece's screen box, the piece at (−1, 0) of a
  7 × 6 room or on the grass, default / low / high view; the low view sees furniture inside only past the front wall:
  repair1/p-t1.js, §14.)
* **Trees and plants** (`free`): never via the pick, only when the finger's floor point is the plant's own cell.
  Taps on the canopy plant the next tree behind it as today, so an orchard row going away from the camera plants
  normally (the critique's opposite check, test D9).

`tap()` (build tool): `action === 'turn'` → `world.update(key, { r: p.r })` (one undo step: remove + add) — unless
the same key was placed by the last placement less than **250 ms** ago (an accidental double tap: ignore). Then
`effects.popIn(obj, 0.22)`, `sfx 'rotate'`, `buzz(6)` on touch, `state.rot = p.r`, `lastPlaced` = that piece.
`restyle` / `replace` / `place` → `place(p)` as today.

| Tap on… with the part in hand | Result |
|---|---|
| empty spot | place, auto facing |
| a piece of the **same part, same look** (its slot is where the tap resolves, or it stands against a wall / in front of an occupied or invalid spot, or the floor under the finger is the cell right behind it) | **turn** it (to the rules' best facing if it is not facing it, else the next most likely; further taps go round / flip), one undo step |
| a piece of the same part, another look | restyle it in place, facing kept |
| the top of a tall same-part piece whose floor point is two or more cells behind it (a low view) | place a new one there (today's behaviour) |
| the top of a piece in the open with another part in hand | furnish the cell behind it (today's behaviour) |
| the canopy of a tree with a tree in hand | plant behind it (today's behaviour); the trunk base turns it |
| the top rim of a lower floor's wall (Floor 2 active, wall in hand) | build on top (today's behaviour), never turn the wall below |
| a gap in a wall line | fill the gap (today's behaviour), never turn the wall seen through it |
| a different piece in that slot (wall → window, slope → skylight) | replace it; walls/windows: auto facing; roof panels keep the panel's `r` and `h` |
| a blueprint guide (guided mode) | place with the blueprint's facing (unchanged) |
| a finished blueprint piece (guided mode) | no turn; with its own look in hand (nothing would change) a click and '✨ This one follows the blueprint' (repair round 1); another look restyles it as before |
| a Show me ring / ghost (village) | the town snaps it exactly (unchanged); the preview shows the wish's facing (§5.5) |
| a villager's body (village) | opens their card (unchanged) — to turn a bed with a sleeper, tap its foot end or use Turn right after placing |

Not turnable (tap = today's behaviour): `rot 'none'`, autoGable pieces, railings (`SYM 1`).

### 5.2 Turn button and R (Shift+R = the other way)

`builder.rotate(dir)`:

```
def = piece in hand; if !turnable(def) → return
0. a draw stroke is in progress → turn its current line (§5.4)
1. the preview is over a PLACED piece of this part (ghostVisible && target.action is 'turn' or 'restyle' — the
   cursor resting on the piece just clicked, a finger aiming at one):
     turn THAT piece now, like a tap again: world.update(target.key, { r: turnOf(def, cur.r, dir) }) — one undo step,
     popIn, sfx 'rotate', state.rot = its new r; lastPlaced = it; then hover(lastScreen): the preview again shows what
     a tap would do (the next turn). During a touch aim, the lift that ends this aim on the same piece does nothing
     more (no second turn).
2. the preview is over an EMPTY or replaceable slot (ghostVisible && target.action is 'place' or 'replace'):
     r = turnOf(def, target.p.r, dir); pin = { slotKey: target.slotKey, r }; state.set({ rot: r }); sfx 'rotate'
     then hover(lastScreen) directly (state.set fires nothing when rot is unchanged): the ghost turns — roofs too:
     the pin is keyed by the pre-facing slot (§4.1), so it still matches after `autoRoofHeight` gives the turned
     panel another `h` and so another world key; a placement into that slot uses the pin
3. else the piece just placed is live (lastPlaced: same key still holds the record placed by the last single placement,
   world.version unchanged since, the piece in hand is that part, tool Build, not a guide-built blueprint piece):
     turn it like a tap again (one undo step, popIn, sfx, state.rot = r); lastPlaced follows it
4. else: toast '↻ Tap a piece you placed with the same piece in hand to turn it' (2.2 s), sfx 'click'
```

So on desktop the usual "click, it faced the wrong way, press R" works with the mouse still on the piece (case 1:
the piece turns, one undo step per press), and with the mouse moved off the canvas (case 3). R over an empty slot
turns the preview (case 2), including a roof's second row.

* The pin is cleared when the resolved `slotKey` changes, on any placement, on a piece / tool change. Nothing sticks
  to a future placement except the no-context fallback (`state.rot`).
* `lastPlaced` is set by `place()` for single placements (taps, aims, clicks, the town's Show me snap); strokes and
  stamps never set it and `drawStart` clears it.
* The button (`ui.js`): caption **Turn** / **Flip** as today; its icon no longer shows a stored angle — it spins 90°
  (or 180°) per press as feedback; title "Turn what you're pointing at, or the piece you just placed (R)". Hidden for pieces that
  aren't turnable (railing, gables). No "Auto" badge: facing is always auto at placement.
* Why this and not the alternatives: an **"override the next placement"** mode is invisible on a phone (the preview
  only shows while a finger is down) and sticks silently until reset; an **Auto/Manual toggle** adds a mode to forget;
  **"always turn the last placed piece"** breaks desktop R-on-hover, which players use before clicking. "Turn what you
  are looking at" covers both: desktop users keep hover + R + click; phone users place, then fix with one tap (on the
  piece or on Turn).

### 5.3 The fallback facing (`state.rot`)

`state.rot` (session only, not persisted, default 0) now means "the facing the player last chose": set by a turn
(tap again, Turn, R), by Pick (the picked piece's `r`) and by the town's Show me hand-over (`rec.r`). It is used only
when a rule has no signal (§4.4). Normalised per piece at use (flip / `SYM 2`), so the shared value is safe.

### 5.4 Draw strokes

* Every segment / cell resolves with auto facing; continuation rules (rows of slopes, kitchen runs, deck boards,
  collinear walls) keep a row consistent because earlier segments already exist.
* Fences, hedges, railings: `drawing.face` maps a grid line (`axis|line`) to the facing its first segment took; later
  segments on that line reuse it; a new line (after a corner or hop) decides afresh. Wall-like pieces decide per
  segment (outward is local and agrees along a wall).
* A stroke never turns a piece it passes over: `skip` already ignores same-part picks; a stroke over the same part
  keeps the existing `r` (restyle), and `_strokeRec` fill-ins use auto facing (or the existing `r` when restyling).
* Turn / R during a stroke (desktop R, or the Turn button pressed with a second hand) turns the stroke's current line:
  later segments use the new facing and the segments this stroke laid fresh on that line are turned too (inside the
  open batch, so still one undo step).
* A pin on the stroke's first slot (hover, R, then drag from there) seeds that first line (matched by `slotKey`).

### 5.5 Guided mode and Show me

* Guides: `_guideSlot` copies the blueprint `r` (unchanged); "Next piece" hands the piece over without touching
  facing; a completed guided build serialises exactly like the blueprint.
* A tap on a finished blueprint piece never turns it; Turn on a guide-built `lastPlaced` shows
  '✨ This one follows the blueprint' instead. Since repair round 1 the tap itself says so too (a click and the same
  toast) when nothing would change — the part in hand with that piece's look — and Turn right after it (no preview,
  nothing else tapped since, `_guideTap`) answers the same instead of the generic hint. With another look in hand the
  tap restyles the piece as before. While glowing guides for the piece in hand remain, a tap off the guides is refused
  as today (`_guidesLeft`) — a turn included.
* Show me: `snapToHighlight` places the wish rec with its own `r` (unchanged). Its hand-over still sets
  `state.rot = rec.r` (now only the fallback) and the roof `hOffset` (unchanged; it no longer matters on the hinted
  slot, below).
* **Show me hints** (so the builder's preview equals what the snap builds — while a finger presses or aims, or the
  mouse hovers, a Show me ring): the builder gets `setHints(recs | null)`, a `Map` from each rec's `slotKey` (§4.1;
  roofs `R|x|y|z` with any `roofLv` / `lift`, matched on the cell and the record level) to the rec. In `resolve()`,
  right after the guide step, a hint for the resolved slot — unless that slot already holds that part (then the town
  has nothing to build and §5.1 applies) — sets `p.r = rec.r` and, for roofs, `p.h = rec.h` exactly as a guide does.
  The builder's ghost and the town's ghost then show the same facing and height, and `snapToHighlight` builds that.
  `js/town/index.js` gets three one-line hooks: `app.builder.setHints?.(hl.hits.map((e) => fullRec(e)))` after
  `actors.highlight(hl.h)` in the Show me start and in `retarget()`, and `app.builder.setHints?.(null)` in
  `endShowMe()`. Guided mode never sets hints (Show me only frames the spot there).

### 5.6 Paint, Pick, Erase

* Paint: unchanged — repaints keep `r` (`world.update` with m/c/k only); a paint tap never turns.
* Pick: copies the piece, material, colours, accent and floor as today and sets `state.rot = p.r` (the fallback). It
  does not lock the next placement's facing: in a spot with context the auto facing wins (README says so).
* Erase: unchanged.

### 5.7 Undo / redo

A turn is `world.update(key, { r })` → `world.add` with the previous record in the same slot → one undo step
(remove + add). Undo restores the old facing, redo turns it again; a stroke (incl. its line turns) is one step; the
contextual neighbours refresh (`_refreshAround`: a chair's tuck follows a turned table, a nightstand slides to a
turned bed).

### 5.8 The village

* Turning a bed, sofa, chair or stove in use: one `world-change`; the town recomputes 0.3 s later and
  `recheckInside` (R6 T6.2, "its seat, bed or piece removed or turned") re-books the indoor place → the sleeper /
  sitter eases to the new pose. Outdoor seats (bench, rocker) are rebuilt from `r` by `recipes.js` on the recompute.
* Taps on a villager's body still open their card (index.js wrapper runs before the builder).
* Smart facing produces village-friendly facings: headboards to walls, chairs into tables, ranges/desks/fireplaces
  with an open front, benches and rockers with a walkable front cell, woodpiles facing away from the house.

### 5.9 Feedback and tips

* Turn: `sfx 'rotate'`, `popIn(0.22)`, haptic 6 ms on touch.
* One-time tip (`_tip('autoface')`) after the first placement whose facing came from a rule (not the fallback):
  '✨ Pieces turn the right way by themselves — tap one again with the same piece to turn it.'
* The undo tip after a touch placement becomes '💡 Tip: press and hold — the preview lifts above your finger; slide to
  adjust, then lift to place.'

---

## 6. Lifted preview (aim)

### 6.1 Behaviour (touch only; `pointerType === 'touch'`)

1. Finger down: the preview appears **under** the finger as today (`onPress` → hover) — a quick tap places there.
2. Held 450 ms without moving (`AIM_MS`, unchanged): aim starts. The aim point **eases up** from the fingertip to
   `lift` px straight above it over **140 ms** (easeOutCubic); the ghost glides with it and a small ring fades in at
   the aim point with a thin tether down toward the fingertip. Haptic 5 ms (today).
3. Sliding moves the aim point with the finger, keeping the offset (no lag).
4. Lifting places at the aim point **as drawn at that moment** (also mid-ease). Lifting with the **aim point** over the
   UI (or off the view), or with the finger past the screen edge, cancels (`_aimOff`). Judged at the point the ring
   marks, so the finger may rest on the tray while the ring is over the view (repair round 1, S1.2: judged at the
   finger, the 52–62 px strip above the tray — 16–25 % of the view — could only be aimed at with the finger on the tray,
   and lifting there silently cancelled). While a lift would cancel (`aim.off`), the builder hides the preview and the
   ring turns dashed and dimmer; over the tray or a bar the ring slips under it (it lives under `#ui`).
5. A second finger cancels (today); the ring hides.

### 6.2 Geometry

```
lift   = clamp(round(min(innerWidth, innerHeight) × 0.16), 52, 72) px     // 62 on an iPhone 13 (both orientations), 52 at 320 px, 72 on tablets
e      = 1 − (1 − k)³,  k = 0 → 1 over 140 ms (rig.update(dt))
L      = lift × e
top    = rig.insets.top + 6                                               // under the top bar (54 px portrait, 50 landscape on iPhone 13)
dy     = min(L, max(0, fy − top))
dx     = sqrt(max(0, L² − dy²)) × (fx < width / 2 ? +1 : −1)              // no room above: lean toward the middle instead
aim    = (clamp(fx + dx, 2, width − 2), fy − dy)
```

Mouse: no aim mode (unchanged). Pen (`pointerType 'pen'`): lift 0 (a stylus tip hides nothing). Setting off: lift 0.

As built: the ease advances at most 25 ms per frame (`AIM_EASE_DT`), so a slow frame never jumps the point more than
~28 px (62 px lift); at 40 fps and up it takes exactly 140 ms. Turning `aimLift` off mid-aim (photo mode) drops the
point back to the finger.

### 6.3 The ring (DOM, in `camera.js`)

One element created lazily: `div.hw-aim` appended to the canvas's parent (`#game`, fixed, same origin as the canvas;
under `#ui`, z-index 10, so it never covers buttons), `position: absolute; left: 0; top: 0; pointer-events: none`
(so `elementFromPoint` at the aim end still sees the canvas), moved with `transform` only.

* Ring: 18 px, 2 px white border, 1 px dark halo (`box-shadow: 0 0 0 1px rgba(60,40,20,.45)`), 4 px centre dot.
* Tether: 2 px, white 55 %, from `(fx, fy − 26)` (just past the fingertip) to the ring's edge; hidden under 6 px.
* Opacity follows `e` (× 0.6 while `aim.off`: a lift would cancel, when the border also turns dashed and the root gets
  `hw-aim-off`); hidden on aim end / cancel / multi-touch. Inline styles (no CSS dependency) with the class
  name for overrides. In photo mode the builder ignores aims, so the rig gets `aimLift = false` there (§6.6) and draws
  no ring.

### 6.4 Callbacks and the town

The rig calls `onAimStart(fx, fy)` (k = 0: the finger), then `onAimMove(aimX, aimY, off)` on every finger move and on
each frame of the ease (only when the point moved ≥ 0.5 px; `off`: a lift now would cancel — the builder then hides the
preview instead of hovering), and `onAimEnd(aimX, aimY, cancelled, e)`. So:

* `builder.aimEnd` → `tap(aimX, aimY, e)` places at the lifted point; `lastScreen` is the lifted point (state
  changes during an aim — e.g. Turn pressed with the other hand — re-hover there).
* `town/index.js` wraps `onAimEnd` → `snapToHighlight(aimX, aimY)`: a Show me ring under the **lifted** point snaps.
  No town change. `onPress` (villager swallow) still uses the finger, as it should.
* Erase / Paint / Pick aims highlight and act at the lifted point too (they share the aim).
* `rig.aim` (read-only, null outside an aim): `{ fx, fy, x, y, k, lift, off }` for tests.

### 6.5 Unaffected

Quick taps (onTap at the finger), the press preview, mouse, two-finger gestures, orbit, **Draw mode** (a held finger
starts a stroke when it moves: no aim), the 450 ms hold, cancel rules.

### 6.6 Setting

`state.aimLift` (default `true`), added to `PERSIST` (boolean, `cleanSetting` default branch). Settings: **Preview
above your finger** On / Off (shown everywhere; it only matters for touch). `main.js` sets
`rig.aimLift = state.aimLift && !state.photoMode` at boot and `builder._onState` keeps it in sync on `aimLift` /
`photoMode` changes (like `drawMode`).

---

## 7. Files to change

| File | Change |
|---|---|
| `js/facing.js` (new) | §4.2–4.5; pure, no THREE |
| `js/builder.js` | `resolve()`: slot exactly as today, then the facing order (§4.1) with `slotKey`, the same-part step T1 / T2 + `action` (§5.1), Show me hints + `setHints()` (§5.5), pin keyed by `slotKey`, `lastPlaced`, `rotate()` cases 0–4 (§5.2), `_turnEntry`, double-tap guard, the aim's no-second-turn flag, stroke line facing + stroke turns (§5.4), `_strokeRec` auto facing, memo (§4.6), `autoRoofHeight` → `facing.roofHeight`, tips (§5.9), `aimLift` sync; expose `builder.facingAt(def, p)` for tests |
| `js/camera.js` | lifted aim (§6): `aimLift`, `_liftPx`, `aim`, ease in `update(dt)`, ring element, lifted coordinates to `onAim*` |
| `js/state.js` | `aimLift: true`, in `PERSIST` |
| `js/ui.js` | Turn button (§5.2), Settings toggle, How-to-play gesture text |
| `js/catalog.js` | document optional `face` / `sym` def fields |
| `js/main.js` | `rig.aimLift = state.aimLift && !state.photoMode` at boot |
| `sw.js` | add `js/facing.js` to `CORE`, bump `VERSION` |
| `js/town/index.js` | three one-line Show me hint hooks (§5.5): `setHints` after `actors.highlight` in the Show me start and `retarget()`, `setHints(null)` in `endShowMe()`. Nothing else in `js/town` changes (verify with the suites) |
| `README.md` | phone gestures (press and hold lifts the preview), keys (R / Shift+R), Tools → Build (pieces face the right way; tap again to turn; Turn button), Roofs and A-frame sections (no more "use Turn so the sides face each other"), Pick (facing is the fallback), Settings table (Preview above your finger) |
| `docs/ARCHITECTURE.md` | new module, Builder API (`resolve` action/facing/slotKey, `rotate` semantics, `facingAt`, `setHints`), Camera (aim lift, `rig.aim`, lifted `onAim*`), state key `aimLift`, `state.rot` meaning |
| `tools/smart-regress.mjs` (new) | §9 |

---

## 8. Acceptance criteria

1. Every rotatable piece placed by a tap / aim / click / stroke gets the auto facing of §4 (or the fallback when no
   rule has a signal); the preview shows that facing before the tap.
2. The 266 scene checks pass with `facing.autoFacing` against the real world getter: the 46 of Appendix A and the
   174 of Appendix B (the revision-2 scenes and the critique's adversarial scenes), the 12 of repair round 1 (R1) and
   the 34 of repair round 2 (R2).
3. Blueprint agreement (§10 method) over the **241 deliberate, player-placeable** facings is no worse than the
   reference of §10.2: leave-one-out ≥ 97% and build order ≥ 97%; stage-cold ≥ 90%; shuffled within stages ≥ 92%;
   walls / windows / doors, porch steps, decks and tables 100% in all four orders; roof slopes 100% leave-one-out and
   build order, ≥ 90% stage-cold and shuffled; and every disagreement in the three fixed orders is in the list of
   §10.3 (with its reason). Categories with fewer than ten blueprint pieces are judged by their scenes, not by these
   percentages (§10.1).
4. Tap again turns (to the rules' best facing first, then the next most likely / flip) as one undo step; it decides the slot exactly as today
   first (§5.1): gap filling, building on a lower floor's wall top, planting behind a tree and furnishing behind a
   piece with another part in hand all work as today (a tap on a same-part piece in the open turns it, repair round
   1); restyle and replace behave as today; the double-tap guard holds.
5. Turn / R follow §5.2 exactly — including with the cursor still over the piece just clicked and on a roof's second
   row; nothing sticks to a later placement except the documented fallback.
6. Guides, Show me snaps **and their previews** and autoGable keep their exact facing; every stock blueprint stamped
   and guided serialises identically; old saves / share codes round-trip byte-identically.
7. Aim: the placement lands at the lifted point (the slot `resolve(aimX, aimY)` gives), the ring is drawn there, a
   quick tap lands under the finger, mouse / pen / Draw strokes are unchanged, the setting turns it off; the cancel is
   judged at the aim point, so a finger on the tray with the ring over the view places (repair round 1).
8. Facing cost within budget (§4.6). No console errors. batch-regress 48/48 (both modes), town-regress and the package
   tests green.

---

## 9. Test plan — `tools/smart-regress.mjs`

Built on `tools/harness.mjs` (`startServer`, `launch`, `openGame`, `injectHelpers`; `HW_ROOT` for another checkout),
`check(name, cond, detail)`, exit 1 on any failure, `--only=A,C` to run sections. Real touches through
`Input.dispatchTouchEvent` on a CDP session (the `touchOf` pattern of `town-regress.mjs`): `tap(p)` = start, 60 ms,
end; `hold(p, ms, moves)` = start, wait `ms`, optional moves (30 ms apart), end. Pages: iPhone 13 (390 × 664 canvas),
iPhone 13 landscape (844 × 390), a 320 × 568 phone, desktop 1280 × 800; queries
`clean=1&nosave=1&town=0&thumbs=0` unless stated. Scenes are built with `world.add(rec, { record: false })` and
`world.load({ pieces })`; screen points with `__t.toScreen`.

**A. Rules (pure).** `const F = await import('/js/facing.js')`; the 46 scenes of Appendix A, the 174 of Appendix B,
the 12 of repair round 1 (Appendix B, R1) and the 34 of repair round 2 (§15, R2) — 266 in all,
`ctx = { get: (k) => world.get(k), cam, fallback, roofLevel, lift }`. One check per scene (the "built" scenes place
panel after panel with the auto facing and `roofHeight`, then check every panel).

**B. Blueprint agreement.** For `starter, aframe, logcabin, cottage, farmhouse`: every item of `blueprints.get(id)
._items` with `faceGroup` not null / not `'gable'`; `cam = [sin θ, cos θ]` of `bp.cam.th`; `fallback 0`; four getters:
leave-one-out (`k === key ? undefined : map.get(k)`), build order (only records earlier in `bp.pieces`, the guided /
cascade order), stage-cold (only records of EARLIER stages, `foundation, walls, porch, upper, upperWalls, roof,
gables, inside, garden`: each piece as if it were the first of its stage) and shuffled (stages in order, a seeded
random order inside each stage, 20 runs, LCG seed 12345); compare with `sameFacing`. Report the A-frame's 20 roof
panels at `y 0` apart (only a guide can place them). Checks: the thresholds of §8.3; disagreements in the three fixed
orders ⊆ §10.3 (print new ones); report the table.

**C. Real taps place the auto facing** (iPhone 13; a 4 × 3 foundation house with a wall ring, a shuttered window on
the back, a table at (1, 1), a deck row in front, a 4 × 6 walled shell elsewhere):
C1 bed tapped in a corner cell → `r` = the corner rule (headboard on the plain wall);
C2 door tapped on the front wall → `r 0`, on the back wall → `r 2`;
C3 chair tapped beside the table → faces it (all four sides);
C4 roof slope tapped on the west wall top of the 4 × 6 shell → `r 1`, then the cell above it → `r 1`, `h 1`;
C5 porch steps in front of the deck → toward the deck;
C6 picket fence drawn round the house (Draw mode, real drag) → every segment's pickets face away from the house;
C7 the press preview (touchStart, 120 ms) shows the same `r` the tap then places (`builder.target.p.r`);
C8 a tree in the empty meadow → `state.rot` (set it to 3 first) → `r 3`.

**D. Tap again** (iPhone 13):
D1 tap a placed bed again (≥ 400 ms later) → same key, the `r` its preview showed (the next in the turn order), count
unchanged, one undo step, `sfx rotate` seen;
D2 a door → flip (`r ^ 2`); D3 more taps → all four facings, then back to the first;
D4 undo → old `r`; redo → turned again;
D5 restyle: another material selected → `m` changes, `r` kept;
D6 replace: a window tapped onto a back wall → outward `r 2`;
D7 double tap on an empty cell → one piece, not turned (as built: two taps back to back through `rig.onTap` — on
software GL two real touches 60 ms apart reach the game about a second apart — then a tap 400 ms later turns it);
D8 precedence, furniture: a wardrobe against the back wall, tapped on its upper half → it turns, nothing is placed
outside; a wardrobe in the middle of the room, tapped on its upper half (the floor under the finger the cell right
behind it) → it turns, nothing placed (repair round 1; before, a second one was placed there); tapped at its foot → it
turns; a bookshelf in hand, the same tap → a bookshelf in the cell behind it;
D9 precedence, trees (the opposite check): an oak at (0, 0), oak in hand, tap the canopy over the cell diagonally
behind it → a second oak is planted there, the first is unchanged; tap the first oak's trunk base → it turns;
D10 level: Floor 2 active, wall in hand, tap the top rim of a Floor-1 wall at the four heights the critique used
(95 / 90 / 80 / 60% of its height) → a new y 1 wall is placed each time, the Floor-1 wall is unchanged;
D11 gap: a front wall with a gap, low camera (θ 0.15, φ 1.38, iPhone 13), 25 taps across the gap → the gap is filled
every time, no wall behind it turns;
D12 roofs: a roof slope tapped on a panel of the same part → that panel turns to the other side of the ridge (r 1 →
3) and keeps its `h`; a skylight tapped on it → replaced in place with the panel's `r` and `h`.

**E. Turn button & R.**
E1 phone: tap-place a sofa, real tap on the tray's Turn button → the sofa turns (one undo step);
E2 then place a different piece, press Turn → the hint toast, nothing changes;
E3 desktop: hover an empty cell → ghost `r = auto`; R → ghost `r + 1`; click → placed `r + 1`; hover another cell →
ghost back to auto; E4 R with the mouse off the canvas right after a click → that piece turns; Shift+R → `r − 1`;
E4b desktop, the mouse still over the piece just clicked (moved 3 px after the click so hover resolves 'turn'): R →
that piece turns +1 at once (count unchanged, one undo step per press); R again → +2; Shift+R → back to +1; a click
→ the facing its preview showed (tap again: the next in the turn order); undo × 4 → the original auto facing;
E5 the Turn button is hidden for railings and gables;
E6 during an aim over an empty cell, Turn (second touch on the button) turns the preview and the lift places it
turned; during an aim over a placed piece of that part, Turn turns the piece at once and the lift adds no second turn;
E7 roofs: a 4 × 4 house with an r 1 eave row placed; hover the second-row cell beside it (auto r 1, `h 1`); R → the
ghost shows r 2 with its own `h` (0: another world key, the same `slotKey`); R → r 3; R → r 0; R → r 1 and `h 1` again;
R → r 2; click → placed r 2 with the `h` the ghost showed.

**F. Strokes.**
F1 a hedge stroke along one line → one facing for all segments;
F2 a wall stroke restyling existing walls with mixed `r` keeps each wall's `r`;
F3 a stroke over identical pieces turns none; F4 R mid-stroke (desktop) turns the line, the whole stroke undoes in one
step.

**G. Guides, Show me, saves.**
G1 guided cottage: snap the first 20 guides (walls front / back / sides, roof rows) with real taps → every placed `r`
equals the blueprint's; G2 a tap on a finished blueprint piece (a wall with its own look in hand, after the guides
moved on and handed over the next stage's piece) doesn't turn it;
G3 stamp each blueprint → `serialize()` equals the blueprint records (sorted compare);
G4 a hand-written save with deliberately "wrong" facings (walls `r 0` on the back, a bed facing a wall) → load →
serialize byte-identical; share code round trip identical;
G5 `town=fresh&wish=…` Show me for a bench: aim so the **lifted** point is on the ring and the finger is not → lift →
the bench lands exactly on the spot with the wish's `r`;
G5b the preview on a Show me ring: Show me for a bed (and for a bench) whose rec `r` differs from the auto facing there
(set the fallback differently too) → a touch press on the ring and a desktop hover over it: `builder.target.p.r ===
rec.r` and the builder's ghost has the town ghost's facing; for a roof rec, `target.p.h === rec.h`; after Show me ends,
the same spot previews the auto facing again (`setHints(null)`).

**H. Lifted preview.**
H1 iPhone 13: hold at (x, y) 700 ms → `rig.aim.k === 1`, `rig.aim.y ≈ y − 62` (±1), the ring's rect centre within 2 px,
`builder.target.key === resolve(x, y − 62).key`; lift → the piece is in that slot;
H2 the ease: samples at aim start + 30 / 70 / 150 ms → `aim.y` decreasing, no step > 30 px;
H3 a quick tap at (x, y) → placed at `resolve(x, y)`;
H4 finger 20 px under the top inset → `aim.y ≥ insets.top + 6`, `aim.x` leaned toward the middle, placement there;
H5 landscape and the 320 px phone: lift 62 / 52, placement at the lifted point;
H6 lift with the ring over the tray (the finger 40 px further in) → `aim.off` and no preview before, nothing placed,
ring hidden (repair round 1: judged at the aim point; R2 is the other half — the finger on the tray, the ring over the
view, places);
H7 mouse: press 700 ms, release → never `mode 'aim'`, placed under the pointer;
H8 Draw mode: hold then drag → the stroke starts under the finger;
H9 setting off (and after a reload) → aim places under the finger;
H10 Erase with an aim → removes the piece under the lifted point.

As built (`tools/smart-regress.mjs` H, G5L): H1 / H5, H2, H3, H4 and **H6b** (a hold that becomes a pinch: the ring
hides at the second finger, nothing is placed) run on all three phones (iPhone 13 portrait, 844 × 390 landscape,
320 × 568); H6, H8, H9 (a real tap on the Settings switch, a reload, photo mode) and H10 on the iPhone 13; H7 on a
1024 × 700 desktop page that also takes touches (mouse, a CDP pen, a finger). H2 checks every frame of the ease (never
back down, no step over 30 px, still rising at +30 ms, +30 / +70 / +150 ms decreasing, the ring fading in). Checks that
guard unchanged behaviour (H3 quick tap, H7 mouse / pen, H8 Draw) also contrast it with the lifted hold at the same
point, so each fails on the code before the lift. **G5L**: Show me for a bench, the finger held `lift` px under the
ring (off it), the lifted point on it → the preview has the wish's facing and the lift builds the bench there. E6 holds
its finger `lift` px under the cell so the lifted point is on it.

**I. Village** (`town=fresh&spawn=gardener`, a home with a bed, a table and two chairs, time pinned at night):
I1 the sleeper's bed turned (debug API, then a real tap on the bed's foot end) → within 3 s the sleeper lies in the
bed with the head at the new headboard (`localToWorld(bed, 0, −0.1)` within 5 cm), nobody inside furniture (`near`);
I2 a sitter's chair turned toward the table → within 3 s seated at the new `CHAIR_SEAT_Z` spot;
I3 a range turned to face the room → the stand-by spot moves in front of it.

**R. Repair round 1** (real touches; each check fails on the code before the round): R1 a Cook Stove tapped onto a
window wall with the side wall a cell away (the verifier's hand build) and beside a corner bookshelf → `r 0`, its back
to its own window (S1.1); R2 / R2b on the three phones, held 20 px above the tray: the finger slid 24 px onto the tray
with the ring over the grass → the preview is the ring's slot and the lift places it there; slid `lift + 14` px in, the
ring over the tray → `aim.off`, a dashed ring, no preview, nothing placed (S1.2); R3 a real tap on the top of a sofa in
the open (its floor point the empty cell behind it), sofa in hand → it turns, nothing placed; R4 one tap again turns
stairs along the back wall to climb the other way along it and a front-eave roof slope to the other side of the ridge;
R5 guided cottage, a finished wall tapped with its own look in hand → nothing changes, a click and '✨ This one follows
the blueprint', and Turn right after → the same toast; R6 porch steps in the open meadow → the player's last facing.
Repair round 2 (§15): R7 a Farmhouse Table (or a Kitchen Counter) tapped in front of the S1.1 window spot, then a Cook
Stove (or a Wardrobe) tapped onto it → `r 0`, its back to its own window (S2.4); R8 a bed in a corner then a nightstand
beside its foot, an armchair then a fireplace, a chair then a table — one tap again turns each to the facing the rules
now prefer (bed `r 0`, armchair `r 3` facing the fire, chair `r 1` facing the table) and three more go round the other
three facings, one undo step each, nothing placed (S2.2).

**J. Performance.** J1 2,000 random resolves over the farmhouse: facing median ≤ 0.1 ms, p99 ≤ 1 ms;
J2 `resolve()` median with facing ≤ 1.5 × without (`?facing=0` dev switch or a timing hook; since repair round 2 the
lowest median of three alternating batches of each, §15).

**K.** No console errors in any page.

**Existing suites:** `node tools/batch-regress.mjs` (48/48) and `HW_TOWN=1 node tools/batch-regress.mjs`;
`node tools/town-regress.mjs` (full); `shot.mjs --script tools/town-brain.js` and `tools/town-look.js` with
`--query "bp=cottage&nosave=1&town=fresh"`; `tools/town-hud.js` with `--query "bp=cottage&nosave=1&town=0"` on
`--mobile`, `--mobile --landscape` and desktop.

---

## 10. Blueprint agreement

### 10.1 Method

For each stock blueprint, every record whose piece is rotatable (not `rot 'none'`, not autoGable — gables follow
the roof) was taken out and the rules asked what they would pick **in that exact spot**, in four build orders:

* **leave-one-out**: every other record of the blueprint present (the most context there can be);
* **build order**: only the records before it in `bp.pieces` (the guided / cascade order: foundation, walls, porch,
  upper floor, upper walls, roof by height, gables, interior, garden) — a player following the steps;
* **stage-cold**: only the records of *earlier* stages — each piece as if it were the first of its stage (the
  chairs before their table, the porch roof before the house roof, the bench before the path): the hardest order;
* **shuffled**: stages in order, a random order inside each stage, 20 seeded runs (mean agreement) — a player who
  builds stage by stage but in no particular order within one.

Camera = the blueprint's own view (`bp.cam.th`), fallback 0. Facings compared up to the piece's symmetry. Records:
521 in all; 126 `rot 'none'`, 36 gables, **359 measured**.

A facing counts as **deliberate** when the blueprint chose it on purpose and it is visible (walls outward, roofs,
decks, steps, stairs, furniture, benches, rugs, tables, and the garden things the author turned: woodpile,
wheelbarrow, veggie beds, mailbox); **authoring default** when it is the helper's `r 0` (`at()`, `run()`): plants,
railings, beams, fences, the lamp post and beehive. The A-frame's 20 roof panels at `y 0` are reported apart: they
rest on the foundation, `resolve()` always settles a roof on wall tops (`roofLv ≥ 1`), so only a guide places them
and guides keep the blueprint's facing anyway. The headline is the **241 deliberate, player-placeable** facings.

**Small samples.** Stairs (2), benches (2), steps (3), tables (4), seats (5), garden fronts (6), chairs (8) and rugs
(8) are too few in the blueprints to mean much as percentages; those rules are carried by the 220 scenes (Appendix A,
Appendix B: chairs 7, seats 17, stairs 8, steps 2, decks 4, benches 10, garden fronts 79, fences 19, roofs 48, walls
11, other furniture 6, plants 2, a gable 1, and 6 "built" sequences).

### 10.2 Results (revised rules, revise/all.out)

| Category | n | Leave-one-out | Build order | Stage-cold | Shuffled (20×) |
|---|---:|---:|---:|---:|---:|
| Walls, windows, doors | 82 | 82/82 (100%) | 82/82 (100%) | 82/82 (100%) | 100% |
| Roof slopes, hips, valleys (player-placeable) | 64 | 64/64 (100%) | 64/64 (100%) | 60/64 (93.8%) | 93.2% |
| Porch deck boards | 17 | 17/17 (100%) | 17/17 (100%) | 17/17 (100%) | 100% |
| Porch steps | 3 | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 100% |
| Stairs & ladder | 2 | 2/2 (100%) | 2/2 (100%) | 2/2 (100%) | 85.0% |
| Back-to-wall furniture | 40 | 37/40 (92.5%) | 36/40 (90.0%) | 36/40 (90.0%) | 90.8% |
| Tables | 4 | 4/4 (100%) | 4/4 (100%) | 4/4 (100%) | 100% |
| Dining chairs | 8 | 8/8 (100%) | 8/8 (100%) | 3/8 (37.5%) | 68.8% |
| Armchair / sofa / rocker | 5 | 5/5 (100%) | 5/5 (100%) | 4/5 (80.0%) | 87.0% |
| Rugs | 8 | 6/8 (75.0%) | 7/8 (87.5%) | 4/8 (50.0%) | 66.3% |
| Garden bench | 2 | 2/2 (100%) | 2/2 (100%) | 1/2 (50.0%) | 72.5% |
| Garden things with a front | 6 | 5/6 (83.3%) | 5/6 (83.3%) | 5/6 (83.3%) | 83.3% |
| **All deliberate, player-placeable** | **241** | **235/241 (97.5%)** | **235/241 (97.5%)** | **221/241 (91.7%)** | **93.5%** |
| A-frame roof panels at `y 0` (guide only) | 20 | 20/20 (100%) | 20/20 (100%) | 20/20 (100%) | 95.0% |
| Plants & round things (authoring default) | 45 | 45/45 (100%) | 45/45 (100%) | 45/45 (100%) | 100% |
| Railings & beams (authoring default) | 33 | 33/33 (100%) | 33/33 (100%) | 33/33 (100%) | 100% |
| Garden things with a front (authoring default) | 2 | 1/2 (50%) | 1/2 (50%) | 1/2 (50%) | 50% |
| Fences & hedges (authoring default) | 18 | 16/18 (88.9%) | 16/18 (88.9%) | 16/18 (88.9%) | 88.9% |
| **Everything** | **359** | **350/359 (97.5%)** | **350/359 (97.5%)** | **336/359 (93.6%)** | **94.5%** |

Against revision 1, measured with the same harness (revise/old.out): deliberate player-placeable 236/241 (97.9%)
leave-one-out and build order, 218/241 (90.5%) stage-cold, 93.5% shuffled; scenes 156/220. Revision 2 gains the
A-frame's second deck row in every order (stage-cold decks 13/17 → 17/17), passes all 220 scenes, and loses one
blueprint facing: the Tiny Garden Shed's wheelbarrow, exactly diagonal from the shed's corner (§10.3). Roof slopes
shuffled 93.7% → 93.2%: the Log Cabin porch row, placed before the house row beside it, is now a lean-to (§10.3).

Per blueprint (all · deliberate player-placeable; leave-one-out / build order / stage-cold): Tiny Garden Shed 15 →
14/14/14 · 12/12/12 of 13; A-Frame Cabin 71 → 69/69/67 · 28/28/26 of 30; Log Cabin 76 → 76/76/69 · 56/56/49 of 56;
Timber-Frame Cottage 73 → 72/72/69 · 53/53/50 of 53; Farmhouse 124 → 119/119/117 · 86/86/84 of 89.

Notes: plants and railings / beams agree only because the fallback (0) equals the helpers' default — which is the
point of the fallback, not evidence for a rule.

Repair round 1 (smart-regress B, as built): every figure above is unchanged but one — dining chairs shuffled 70.0% →
68.8% (110/160): a chair placed before its table no longer backs onto another piece one cell away (the back rule's
new −2), so in two more shuffled runs it backs onto the other wall. The steps rule's new "toward the house" term keeps
porch steps at 100% stage-cold: they are laid before their deck, and withholding the +1 for free ground alone (for
the open-meadow fallback) would have left them no signal there (0/3).

### 10.3 Disagreements (all of them, in the three fixed orders) and why each is acceptable

Deliberate facings — in leave-one-out and build order (6 each):

| Blueprint | Piece (x, y, z) | Blueprint `r` | Rule `r` | Orders | Why it is acceptable |
|---|---|---|---|---|---|
| Garden Shed | wheelbarrow (1, 0, 1) | 1 | 0 | all three | exactly diagonal from the shed's corner: both "away" facings score alike and the camera shows the player its front; the author picked the other. (Revision 1 matched only because its ring search preferred the x axis.) One tap turns it |
| A-Frame | cat (0, 0, 1) | 3 | 2 | all three | cosmetic: the rule curls it against the glass front facing the room; the author turned it toward the armchair |
| A-Frame | rug (−1, 1, −3) loft | 1 | 0 | all three | half-turn symmetric, neighbours on both axes (dog bed +X, plant +Z): camera tie / no signal yet; aesthetic |
| Farmhouse | rug (1, 0, −1) | 1 | 0 | leave-one-out, stage-cold | more furniture on its X sides (dog bed, chair) than Z (armchair); the author ran it in front of the armchair — aesthetic |
| Farmhouse | grandfather clock (−2, 0, −3) | 0 | 1 | build order, stage-cold | a corner between two windows (bad for a tall piece either way); before the kitchen exists +X looks freer; leave-one-out agrees |
| Farmhouse | dresser (−2, 1, 0) | 1 | 2 | leave-one-out, build order | a corner between two shuttered windows; the rule backs it onto the front window facing into the room, the author onto the side window — both natural; stage-cold agrees |
| Farmhouse | cat (1, 1, −1) upstairs | 2 | 3 | all three | open floor, camera tie; cosmetic |

Deliberate facings — stage-cold only (the piece placed before what its facing depends on; 14 more, 20 in all):

| Blueprint | Piece (x, y, z) | Blueprint `r` | Rule `r` | Why it is acceptable |
|---|---|---|---|---|
| A-Frame | chimney (1, 0, 0) | 3 | 0 | placed before the A-frame's roof panels, which are its walls: nothing to back onto yet (a camera tie); in build order the roof is there and it agrees |
| A-Frame | chair (−1, 0, −2) | 0 | 1 | placed before its table: it stands with its back to the nearest wall (the back rule) |
| Log Cabin | roof slopes (−2…1, 1, 1), the porch row ×4 | 1 / 3 | 2 | the porch row placed before the house row beside it: a 1-deep roof on a porch against the house is a lean-to (`leansOn` (b)), a perfectly good porch roof; once the house row exists the row term continues the gable (+8 beats +5), as in leave-one-out, build order and 94% of shuffled orders |
| Log Cabin | chair (−2, 0, 0), chair (−1, 0, −1) | 2, 3 | 1, 1 | placed before their table |
| Log Cabin | rug (0, 0, −2) | 1 | 0 | placed before the furniture round it: no signal → the fallback; half-turn symmetric |
| Cottage | chair (0, 0, −1) | 3 | 0 | placed before its table |
| Cottage | rug (−1, 0, 0) | 1 | 0 | placed before most of the furniture round it; aesthetic |
| Cottage | bench (−2, 0, 4) | 1 | 2 | placed before the garden path (same stage): it faces the house instead of the path |
| Farmhouse | armchair (1, 0, 0) | 1 | 2 | placed before its fireplace: back to the wall, facing the room |
| Farmhouse | chair (0, 0, −1) | 3 | 1 | placed before its table (a camera tie between two walls) |

Facings are decided once, when a piece is placed (D1, a guardrail), so a chair placed before its table keeps its
wall-facing guess; one tap turns it. The village is fine either way (a chair not facing a table is a plain seat).

Authoring defaults (3, all orders): the Cottage beehive (4, 0, 0) — `at()` left it at `r 0`, the rule turns its
entrance away from the house; the Farmhouse's two left-side picket fences (−4, 0, 2 / 3, axis z) — `run()` gave the
left side's pickets to the yard while the front and right sides face the street; the rule faces all of them out.

So in the orders a player following the steps sees, every deliberate disagreement is a cosmetic cat or rug, a corner
with two equally good walls (clock, dresser), or an exact diagonal (wheelbarrow). The stage-cold ones are all "placed
before the thing it faces" — chairs, rugs, an armchair, a bench, the A-frame chimney — or the lean-to guess for a
porch roof before the house roof.

### 10.4 Purpose-built scenes

All **220** scenes pass with the revised rules (revise/all.out): the 46 of Appendix A (walls on the grass,
foundations, corners with windows, doors never behind a bookshelf, chairs on every side of a table, hearths seen and
hidden by a partition, stairs along a wall and onto a loft, steps, decks, fences on all sides, roof rows / stacking /
squares with a door, all four hip corners, an L valley, a lean-to porch roof, benches by ponds and on porches,
fallbacks) and the 174 of Appendix B (95 revision-2 scenes and the critique's 79 adversarial ones). Revision 1 passed
156 of the 220.

---

## 11. Risks and open questions

* **Accidental turns.** A double tap on a piece now turns it; mitigated by the 250 ms guard and a cheap undo. The
  turn plays `rotate` and bounces the piece so a turn is never silent.
* **Tall pieces in the open.** A wardrobe or bookshelf standing free in a room turns only from taps on its lower part
  (15–47%); a tap on its top places a second one behind it, as today (§5.1). That is the price of keeping "plant /
  furnish behind it" working. The press preview shows a turn vs a new piece before the finger lifts, Turn right after
  placing always works, and the back rule puts tall pieces against walls, where 89–100% of taps turn them.
* **Plain walls barely change when flipped** (relief mirroring only): a tap-again on a wall gives a bounce and a sound
  but little visible change. Acceptable (consistent rule); doors and shuttered windows (without floors) change clearly.
* **Corners with two equal walls, exact diagonals** (§10.3): decided by the camera — the piece shows its front to the
  player, which is what they will look at; one tap fixes it.
* **Pieces placed before their context** (chairs before the table, a rug before the furniture, a porch roof before
  the house roof; §10.3 stage-cold): the guess is decided once and kept (D1). Stage-cold agreement is 91.7%; one tap
  fixes the rest.
* **Lift on very small screens**: 52 px minimum; near the top bar the point leans sideways (§6.2). If players find the
  lean confusing, an alternative is to drop the lift to 0 within 60 px of the top inset.
* **Desktop habit**: R no longer sticks for the next placement in spots with context: over an empty slot it pins that
  slot, over a placed piece it turns it (§5.2). The fallback keeps it sticky in the open meadow. README / How-to-play
  explain "R turns what you're pointing at".
* Open: should Pick lock the next placement's facing (a "copy exactly" intent)? This spec says no (auto wins, Pick
  sets the fallback); revisit if playtests ask for it.

---

## 12. Reference prototype (scratch, not in the repo)

Revision 2 — `/tmp/claude-0/-home-user-rlspencer3-github-io/f5cfed31-bcc1-5c81-91fc-f28912dffdbc/scratchpad/smart/revise/`:
`facing-rev.js` (every rule of §4 as revised, plain functions over `ctx.get`); `run-metric.js` (§10: the four
orders), `new-scenes.js` (Appendix B, N1–N17), `run-perf.js` (§4.6); `mk.sh <proto> <out>` concatenates the
prototype, the runners, Appendix A (`../design/run-scenes.js`) and the critique's scenes (`../critique/crit-scenes*.js`)
and runs them through `shot.mjs --script`; `report.cjs <out> [--rows]` prints the tables; `all.out` (revision 2),
`old.out` (revision 1 through the same harness); `pick-rev.js` + `pick-desktop.out` / `pick-mobile.out` (the §5.1
tap measurements with the real `resolve()` and mesh picks), `pick-nowall.js` / `.out` (the same without T1's wall
clause, §13).
Revision 1 — `../design/` (`facing-proto.js`, `inventory.cjs`, `flip.js`, `geo.js` for §3). `js/facing.js` should
reproduce `facing-rev.js`'s answers; smart-regress A and B are the same checks against the real module.

---

## 13. Decisions (revision 2)

The design critique's findings and what this revision did with each. Measurements: revise/all.out (rules, scenes,
blueprints, cost), revise/pick-*.out (taps with the real `resolve()`), and the critique's own logs.

### Must-change items — all applied

| # | Critique item | Decision | Where | Evidence |
|---|---|---|---|---|
| M1 | Tap again ignored the level: on Floor 2 a tap on a Floor-1 wall top would turn that wall instead of building on top | The slot is decided **exactly as today first** (step 3 only takes a picked edge with `e.p.y === L`, `_swapAcross` keeps "top rim = build on top"); only then is the slot checked for the same part. T1 also requires `pick.entry.p.y === L`. Roofs keep `fixed === 'roof'` | §4.1, §5.1 | the critique measured today's resolve: 4/4 wall-top heights → a valid y 1 slot; test D10 |
| M2 | The same-part step ran before `_gapSlot`: 10/25 low-camera taps into a gap would turn the wall behind | Same change: gap, gable and stroke-line steps decide the slot; the same-part check looks only at that slot (a gap is empty → place) | §4.1, §5.1 | the critique's 25/25 gap fills today; test D11 |
| M3 | Cell pieces took the picked piece's slot: planting a row of trees away from the camera and furnishing behind tall pieces broke; old test D8 required it | Explicit precedence T1 / T2: turn when today's slot holds the part; take the picked piece only for non-`free` cell pieces when today's slot is no sensible place — occupied, invalid, **or its ground hidden behind a wall** (added: a tap on a bookshelf against a wall would otherwise put a bookshelf outside); never a piece other than the one under the finger; `free` pieces never via the pick. Old D8 reworded, D9 added (tree behind a tree is planted) | §5.1, §9 D8–D9 | real picks: canopy taps over the cells behind turn 0 of 4–76; furniture against a wall turns on 84–100% of taps; in the open only the lower part turns (15–47% for tall pieces), the rest places behind as today |
| M4 | R with the cursor resting on the piece just clicked pinned a preview that the same-part case outranks: R did nothing, the next click turned +1 | `rotate()` case 1: a preview over a placed piece of this part turns **that piece** at once (one undo step), lastPlaced follows; during an aim the lift adds no second turn. The pin is only for previews of empty / replaceable slots | §5.2, §9 E4b, E6 | — (behaviour spec; E4b covers the exact flow) |
| M5 | Pin and memo were keyed by the final slot key, which for roofs depends on `r` through `h` | Both keyed by the **pre-facing slot** `slotKey` (`R|x|y|z|roofLv|lift` for roofs); the memo also keys the rounded camera angle autoFacing uses | §4.1, §4.6, §5.2, §9 E7 | — |
| M6 | Show me: the builder's preview showed the auto facing while the snap builds `rec.r` (two ghosts disagree; roof `hOffset` off) | Show me **hints**: the town hands its highlighted recs to `builder.setHints`; `resolve()` copies `rec.r` (and `rec.h` for roofs) right after the guide step, so the preview, the town ghost and the snap agree. Three one-line hooks in `town/index.js` | §4.1, §5.5, §7, §9 G5b | — |
| M7 | Lean-to and porch roofs deeper than one cell sloped into the house wall | `leansOn(d)`: a reach that ends at a wall carrying on up through the roof level, or (from a non-room cell) at a wall with a room behind, is not an eave; uphill toward it +5 / −5 at any depth; the eave comparison only between true eaves | §4.3, §4.5 slope | Appendix B N1–N9: 1/2/3-deep lean-tos (first panel, built eave-first, and after the house roof), 2/3-deep porches with no house roof, after a shed roof and after a gable roof — all pass; gables on level 1 and a 2-storey roof keep their eaves |
| M8 | Garden fronts right against the front or back wall faced sideways (14/28): ties went to scan order | `ownWalls` first (a wall on the piece's own edge decides), then `nearestBuilding` returns the **centroid** of the first ring's room cells (else wall cells), never a scan-order hit; `awayFrom` scores both axes on a diagonal. Bench and fence use the same search | §4.3, §4.5 front / bench / fence | the critique's 28 checks pass; Appendix B N12: 48 checks on foundation and grass houses |
| M9 | Fence: "mid" undefined; fences on the two sides of the front path disagreed | A path beside the fence (adjacent cell or the next) on one side wins (+5); the house term uses the edge's exact midpoint and ignores a house less than one cell across the line | §4.5 fence | the critique's 6 path-fence checks and N14 (9) pass |
| M10 | Seat hearth bonus ignored the side: a sofa beside the fireplace faced its flank | Only a seat **in front of the firebox** (`dot(seat − hearth, DIRS[hearth.r]) ≥ 1`) gets +12 | §4.5 seat | the critique's 2 checks, N10 (6) pass; F13 / F14 still pass |
| M11 | Bench / outdoor seat text gave +1 per free front even with no other signal (F45 failed when read literally) | The text now says what the prototype does: the free-front +1 only when another term already scored; nothing → the fallback | §4.5 seat, bench; Appendix A F45 | F45, the critique's meadow bench / rocker, N16 pass |

Found while measuring and fixed too: the valley's `covered` test only looked toward +Z, so one of the four L
orientations got no signal (the critique's scene) — now direction-free (§4.3); a chair beside a writing desk turned
to the desk's flank — a desk brings its own chair and no longer attracts one (§4.5 chair, N15); the A-frame's second
deck row had no signal when placed before the first row — the house two cells away now counts (§4.5 deck; stage-cold
decks 13/17 → 17/17).

### Should-change items

* **Blueprint metric (§8.3, §9 B, §10) — applied.** Stage-cold and shuffled-within-stage orders are now measured,
  reported and gated beside leave-one-out and build order; the A-frame's 20 `y 0` roof panels (guide-only) are
  reported apart from the player-placeable headline; small categories are flagged as carried by their scenes, and the
  scene count grew from 46 to 220. Thresholds in §8.3 are set at the measured values, not at the easiest order.
* **Re-deciding a chair's facing when its table arrives — not done.** The stage-cold chair numbers (3/8) come from
  chairs placed before their table. Turning existing pieces when a neighbour is placed would break D1 and the brief
  (facing decided only when a piece is placed, stored records keep their `r`, "no hidden state that surprises"); a
  chair that suddenly turns because a table appeared is exactly such a surprise. One tap fixes it.
* The critique as handed to this revision was cut off partway through its should-change list (after the metric item
  above, at "…stairs 2, benches 2, ste…"). Items after that point were not visible and are not addressed here.

### Other choices made in this revision

* **Diagonal ties go to the camera.** The centroid makes exact diagonals visible as ties; the camera picks the facing
  the player sees. This costs one blueprint facing (the shed's wheelbarrow) that revision 1 matched only through an
  x-axis bias.
* **The camera angle is rounded to 0.01 rad, not snapped to octants**, so the memo is exact without changing any tie
  the blueprints measure.
* **Roof `hOffset` from the Show me hand-over is left as it is**: the hint path copies `rec.h` directly, so the offset
  no longer matters on the hinted slot, and elsewhere it behaves as today.
* **T1's "hidden behind a wall" clause** goes slightly beyond the critique's precedence: without it a tap on the top of
  a bookshelf against a wall resolves to the cell outside (valid, empty) and places a bookshelf there — today's
  behaviour, but never what the player means, and it would make tap-again useless for the most common furniture.
  Measured (revise/pick-nowall.out, default view, the same taps as §5.1): without the clause a bookshelf against the
  back wall turns on 62 of 423 taps on it and 361 put a second bookshelf outside the house; with it 422/423 turn
  (wardrobe 68 → 380 of 383, clock 70 → 411 of 411, bed 137 → 221 of 262, kitchen counter 109 → 298 of 313). It
  changes nothing in the open or for trees (the same counts with and without it).

---

## 14. Repair round 1

The verifiers' findings after the first build (a phone playtest with real taps at 390 × 664, 320 × 568 and 844 × 390,
and a regression pass) and what changed. Scratch: `/tmp/claude-0/-home-user-rlspencer3-github-io/f5cfed31-bcc1-5c81-91fc-f28912dffdbc/scratchpad/smart/repair1/`
(`prerepair/` is the code before the round, rebuilt by reverse-applying its edits — `unrepair.py`; every new check
below fails on it: `prerepair-A.log`, `prerepair-R.log`).

| # | Finding | Change | Where | Checks |
|---|---|---|---|---|
| S1.1 (remainder: §15) | A Cook Stove tapped on a window wall, a wall one cell to its side, turned sideways — its back to open floor, its flank on the glass (scores r 0 3.5, r 3 4.0); beside a corner bookshelf it backed onto the shelves. Every TALL piece without the hearth bonus did the same | A window behind a TALL piece scores 4.5 (was 3): its own window beats any wall a cell away (3.5 at best); a plain wall beside it still wins (10). In the "wall k cells away" fallback an item in the cell behind (not a rug, cat or plant) −2 | `facing.js` back rule; §4.5 | A R1 (8 scenes); R R1 (real taps, both spots) |
| S1.2 | With the lift on, a spot within the lift distance above the tray could only be aimed at with the finger on the tray, and lifting there silently cancelled (16–25 % of the view) | The cancel is judged at the aim point (`_aimOff`: the aim point off the view or over the UI, or the finger past the screen edge); `aim.off` / `onAimMove(x, y, off)` while it would cancel: the builder hides the preview, the ring turns dashed and dimmer (over the tray it slips under it) | `camera.js` `_up`, `_move`, `_easeAim`; `builder.js` `onAimMove`; §6.1, §6.3, §6.4 | R R2 / R2b (three phones); H6 now slides the ring itself onto the tray |
| low | A tap on the upper part of a same-part piece in the open placed a second one in the cell behind it (sofa 15 %, table 18 % of the hit points) | T1 also takes the piece when the floor under the finger is the cell right next to it (layer I: furniture and garden things; decks and steps still grow from their edge). Another part in hand still furnishes behind it | `builder._sameTarget`; §5.1 | R R3; D8 (updated: the open wardrobe turns from its upper half, a bookshelf in hand furnishes behind it) |
| low | Tap again turned four-way pieces +90°, so stairs and roof slopes took two taps through a broken middle | Tap again steps to the next facing in `autoFacing`'s `order` (best first, then by score; a slope's opposite second); tables and no-signal spots +90°; edge pieces flip; Turn / R stay ±90° | `facing.js` `order`, `nextFacing`; `builder._nextTurn`; §4.4, §5.1 | R R4; D1, D3, D12, E4b, I2 (updated to the order) |
| low | In guided mode a tap on a finished blueprint piece did nothing at all, and Turn then showed the generic hint | A tap that changes nothing there: a click and '✨ This one follows the blueprint'; Turn right after (`_guideTap`) says the same | `builder.tap`, `rotate` case 4; §5.5 | R R5; G2 (now really has the wall, with its own look, in hand) |
| low | Porch steps never took the fallback: +1 for free ground on all four candidates was a signal, the camera decided (D4 / §5.3 vs the §4.5 table) | Free ground scores only once something else did; with no platform beside them, steps climb toward the nearest house (+3) | `facing.js` steps rule; §4.5 | A R1 (4 scenes); R R6; B porch steps stay 100 % in all four orders |

Also found and fixed in the suite: D7 (the double-tap guard) had passed by coincidence — the window D6 puts behind its
cell made the old rule face the wardrobe r 3, and on software GL the second of two real taps 60 ms apart reaches the
game about a second later, so the guard never applied and the turn (+90°) happened to land on the r 0 the check
expected. D7 now taps twice back to back through `rig.onTap` and checks the guard (and that a later tap turns it).

Not changed: the verifier's other S1.2 option (easing the lift down near the tray) — judging at the aim point already
lets the whole view be aimed at with the full lift; a tap on top of a tall piece whose floor point is two or more cells
behind it still places there (the slot rule, §5.1).

---

## 15. Repair round 2

The second verification (a phone playtest with real taps on an iPhone 13 and a regression pass with a random-interior
audit) and what changed. Scratch: `/tmp/claude-0/-home-user-rlspencer3-github-io/f5cfed31-bcc1-5c81-91fc-f28912dffdbc/scratchpad/smart/repair2/`
(`pre/` is the code before the round; every new check below fails on it — `pre-AR.log`, 35 failures — and passes after;
`repro-rule.js` reproduces the findings at the rule level: `repro-rule-pre.out` / `repro-rule-post.out`).

| # | Finding | Change | Where | Checks |
|---|---|---|---|---|
| S2.1, S2.3, S2.4 | S1.1 only partly fixed: a TALL piece's own window (4.5) beat a wall a cell to its side (3.5) by one point, less than the −2 for an item in front, so with a table, counter, crates, bed or sofa in front of the S1.1 spot the cook stove, wardrobe, bookshelf, clock and washstand turned sideways again (scores r 0 3.0, r 3 4.0); 1 % of the wall- or window-side cells of a random-interior audit, every one this pattern | The "wall a cell or more away" fallback (and its A-frame-roof-next-door twin) scores only when none of the cell's own edges holds a wall, window, half wall, railing or fence (a door does not count) and no roof comes down over it — back group only; seats and chairs keep it (their hearth / table term) | `facing.js` back rule (`own`); §4.5 | A R2 (25 scenes: five pieces in front × five TALL pieces; the mirror, two scenes; a one-cell hallway); R R7 (real taps: table / counter in front, stove / wardrobe). Audit (`repro-rule.js`, the verifier's seed): back to open floor 47–49 → 0 per TALL piece, but for 5 cook stoves lining up with a counter beside them (the kitchen-run term) |
| S2.2 | Tap again stepped to the facing after the current one in the order. After the room changed round a piece (a nightstand beside a corner bed, a fireplace for an armchair, a table for a chair), or after a camera-broken tie, the piece sat at `order[1]`: the first tap went to `order[2]` (a broken facing) and the right one came third | `nextFacing(def, r, order, cont)`: a fresh tap on a piece not facing `order[0]` goes there; on one facing it, to `order[1]`; a tap continuing a run (`builder._turnRun`: the last tap-again turn was this piece, to this facing, and `world.version` is unchanged) goes on round, so a run visits all four. Turn / R stay a plain quarter | `facing.js` `nextFacing`; `builder._nextTurn`, `tap`; §4.4, §5.1 | A R2 (three walks, a piece already at its best, a window's flip); R R8 (real taps, the verifier's three scenes); D1, D3 (a run still goes round all four) |
| S2.2 (also) | Stairs in a house corner counted a woodpile outside, behind the wall at their foot, as something in the way (−4 on a facing already −6 for that wall) | The foot-cell item counts only when the foot edge is open | `facing.js` climb rule; §4.5 | A R2 (the scores with and without the woodpile are equal) |
| low | (the same as S2.4, from the phone pass: a table or counter in front of the S1.1 spot) | as S2.4 | | R R7 |

Also in the suite: J2 compared one batch's median `resolve()` time with the facing against one without it; the page
timer is coarse (the medians move in 0.02 ms steps), so the ratio swung from 1.1 to 1.6 between runs of the same code —
the code before the round too (1.0–1.43 in three runs, `J-repeat.log`). It now takes the lowest median of three
alternating batches of each (1.14–1.29 in three runs, `J2-hardened.log`); J1 (the facing itself: median 0.01 ms, p99
≤ 0.21 ms) is unchanged.

Unchanged by the round: the blueprint agreement (§10.2: 235/241, 235/241, 221/241, 93.5 % — identical, every category),
the other 232 scenes, the village's reading of `r`.

---

## Appendix A — scene checks (smart-regress A)

Helpers: `box(t, x0, x1, z0, z1, y)` fills cells; `ring(x0, x1, z0, z1, y, t, swaps)` puts walls round a footprint
(edges at `z0`, `z1 + 1`, `x0`, `x1 + 1`). Camera vector `[0.5, 0.86]`, fallback 0 unless stated.

| # | Scene | Expected `r` |
|---|---|---|
| F01 | wall ring (0..2, 0..2) on the grass; shuttered window at the front edge (x 1, z 3) | 0 |
| F02 | same; door at the back edge (x 1, z 0) | 2 |
| F03 | same; window on the left edge (axis z, x 0, z 1) | 2 |
| F04 | same; window on the right edge (axis z, x 3, z 1) | 0 |
| F05 | foundation (0..3, 0..2) + wall ring; door at the front (x 1, z 3) | 0 |
| F06 | same; window on the left side (axis z, x 0, z 1) | 2 |
| F07 | foundation + ring with a window at (x 0, z 0) back; bed in the corner cell (0, 0) → back to the plain left wall | 1 |
| F08 | same; wardrobe at (2, 0) against the back wall | 0 |
| F09 | same + a door at the back of (3, 0); bookshelf at (3, 0) → back to the right wall, never the door | 3 |
| F10 | 4 × 4 room, table at (1, 1); chair at (0, 1) | 1 |
| F11 | same; chair at (1, 2) | 2 |
| F12 | same; chair at (3, 0), no table beside it → faces into the room | 0 or 3 |
| F13 | 5 × 4 room, fireplace at (2, 0); armchair at (2, 2) | 2 |
| F14 | same; sofa at (3, 1) (diagonal to the hearth) | 3 or 2 |
| F15 | same + a full partition at x = 2; armchair at (1, 2) → ignores the hidden hearth | 0, 1 or 3 |
| F16 | 4 × 3 house, floor upstairs everywhere, clock at (0, 0); stairs at (0, 1) by the left wall | 2 |
| F17 | same without the clock; stairs at (1, 0) against the back wall → along it | 1 or 3 |
| F18 | 4 × 3 house, loft floor over x 0..1; stairs at (2, 1) | 3 |
| F19 | same; spiral stairs at (2, 1) | 3 |
| F20 | same; ladder at (2, 1) | 3 |
| F21 | foundation (0..2, 0..1), deck row z 2, path at (1, 4); steps at (1, 3) | 2 |
| F22 | same; steps at (−1, 0) beside the foundation | 1 |
| F23 | foundation (0..2, 0..1); deck at (3, 0) | 0 |
| F24 | same; deck at (0, 2) | 1 |
| F25 | foundation + ring (0..2, 0..2); picket fence (axis x, x 1, z 6) south | 0 |
| F26 | same; picket fence (axis x, x 1, z −3) north | 2 |
| F27 | same; hedge (axis z, x −3, z 1) west | 2 |
| F28 | 4 × 6 walled house (x 0..3, z 0..5), roof level 1; slope at (0, 2) west eave | 1 |
| F29 | same; slope at (3, 2) east eave | 3 |
| F30 | same; slope at (1, 0) on the north row → across the short span | 1 |
| F31 | 4 × 4 house with a door in the front wall; slope at (0, 1) → gable over the door | 1 |
| F32 | same + that panel (r 1); slope at (0, 2) → continues the row | 1 |
| F33 | same; slope at (1, 1) → stacks on it (h 1) | 1 |
| F34 | 4 × 4 walled house; hip corner at (0, 0) (NW) | 0 |
| F35 | same; hip corner at (3, 0) (NE) | 3 |
| F36 | same; hip corner at (3, 3) (SE) | 2 |
| F37 | same; hip corner at (0, 3) (SW) | 1 |
| F38 | L-shaped foundation (0..3 × 0..1 + 0..1 × 2..3) with its walls; valley at (1, 1) | 2 |
| F39 | small house, pond at (6, 6); bench at (4, 6) | 1 |
| F40 | same; mailbox at (1, 4) south of the house | 0 |
| F41 | same + a deck row z 2; bench at (1, 2) against the front wall | 0 |
| F42 | same; rocking chair at (0, 2) on the porch | 0 |
| F43 | same; an oak at (7, −5), nothing around → fallback | 0 |
| F44 | same with fallback 3 | 3 |
| F45 | empty meadow; bench at (0, 0), fallback 2 (no term scores, so no free-front bonus either: §4.5) | 2 |
| F46 | 4 × 3 house, deck row z 3, beams along its front (z 4) and sides; slope at (1, 3) on the porch → lean-to, downhill away from the house | 2 |

---

## Appendix B — revision-2 scenes and the critique's scenes (smart-regress A)

Same helpers as Appendix A; camera = the rig's default view (θ = π/4, `[0.707, 0.707]`), fallback 0 unless stated.
`house(x0..x1, z0..z1)` = foundation + a wall ring; "built" scenes place panel after panel with the auto facing and
`roofHeight`, then check every panel. Source: revise/new-scenes.js (N) and critique/crit-scenes*.js (C1–C3).

| # | Scene | Checks | Expected |
|---|---|---:|---|
| N1–N3 | lean-to 1, 2 and 3 cells deep against a 2-storey 4 × 4 house (walls on both floors), its own walls round it; the first panel at every cell of the middle row | 6 | r 3 (downhill away from the house) |
| N4 | the same three lean-tos built eave-first, then along the rows; and a 2-deep one added after the house's own gable roof over Floor 2 is on (an inner and an outer panel) | 5 | every panel r 3 |
| N5–N6 | 1-storey house, a porch 2 and 3 cells deep with beams round it, no house roof; the first panel at every porch row | 5 | r 2 |
| N7 | the 2-deep porch after a front-sloping (shed) house roof: inner and outer row; after a gable house roof (ridge along X): inner row | 3 | r 2 |
| N8 | 4 × 6 house with gable walls on level 1 at both ends: west and east eaves | 2 | r 1, r 3 (gables are not taller walls) |
| N9 | 2-storey 4 × 6 house, roof over Floor 2: west eave | 1 | r 1 |
| N10 | 5 × 4 room, fireplace (2, 0) r 0: armchair (1, 0) and sofa (3, 0) beside it; armchair (2, 1) in front; rocker (1, 1) diagonal in front. 4 × 5 room, wood stove (0, 2) r 1: sofa (0, 1) beside it; armchair (2, 2) in front | 6 | r 0, r 0, r 2, r 1 or 2; r 1, r 3 |
| N11 | house (0..3, 0..2), no path or focal: bench (1, 6) three cells in front; (5, 1) beside the east wall; (2, 3) against the front wall | 3 | r 2, r 3, r 0 |
| N12 | woodpile, mailbox, beehive, doghouse against the front / back / east / west wall, two cells off the front, off the NE corner diagonally — on a foundation house and on a grass house | 48 | r 0 / 2 / 1 / 3, r 0, r 1 or 2 |
| N13 | foundation (0..2, 0..1); second deck row (1, 3) with the first row's middle missing; with the first row | 2 | r 1, r 1 |
| N14 | house with a door at (x 1, z 3), a path x 1, z 3..8: picket fences west (axis z, x 1) and east (x 2) of it at z 4, 6, 8; a hedge across the yard front (axis x, x 3, z 9); a west yard fence (axis z, x −2, z 1); a fence continuing the front wall line (axis x, x 5, z 3) | 9 | west r 0, east r 2 (toward the path); hedge r 0; west fence r 2; either |
| N15 | 4 × 4 room, desk (1, 0) r 0: chair (2, 0) beside it | 1 | r 0 (back to the wall, not the desk's flank) |
| N16 | empty meadow: bench, fallback 2; rocking chair, fallback 3; then a path at (1, 0), (1, 1): bench (0, 0) | 3 | r 2, r 3, r 1 |
| N17 | a lone half wall (axis x, x 0, z 0); birdhouse (0, 2) | 1 | the fallback (a half wall is not a house) |
| C1 | the critique's set 1: beds / sofas / chairs in plain and door corners, a wardrobe between two windows; armchair and sofa beside a fireplace, in front of it, three cells in front; chairs beside and in front of a desk; bench and rocker in the open meadow; fences on both sides of the front path; a bench beside it; a mailbox at its end; two grass houses side by side; a lot-edge door and hedge; a partition door; stairs in a one-cell hall; the first panel of every cell of an L house and the L built wing by wing; 2-deep lean-to and porch; a valley in all four L orientations | 39 | as listed in crit-scenes.js |
| C2 | the critique's set 2: porch after a front-sloping roof; 3-deep lean-to; valleys and hips after the wings in all four L orientations; a shuttered window on a partition; a gable with no roof | 12 | as listed in crit-scenes2.js |
| C3 | the critique's set 3: woodpile, mailbox, birdhouse, lamp post, beehive, doghouse, wheelbarrow against the front, east and back walls and two cells off the west wall | 28 | away from the house |
| R1 | repair round 1 (camera θ 0.5, the verifier's view): house (−3..2, −2..1) with a Window behind (1, −2): cook stove, wardrobe, bookshelf, grandfather clock, washstand at (1, −2); a 4 × 3 room (−2..1, −1..1), Windows behind (−1, −1) and (0, −1), a bookshelf r 0 in (−2, −1): cook stove and wardrobe at (−1, −1); a 4 × 4 room, a bookshelf r 0 at (1, 0): wardrobe at (1, 1); porch steps in the empty meadow with fallback 1 and 3; house (0..3, 0..2) with a front door, no deck: steps at (1, 4) seen from behind the house (camera [0, −1]) and at (5, 1) | 12 | r 0 ×7 (back to its own window); r 1 (not against the bookshelf); r 1, r 3 (the fallback); r 2, r 3 (toward the house) |
| R2 | repair round 2 (camera θ 0.5): the R1 house with a Farmhouse Table, Kitchen Counter, Crate Stack, Bed or Sofa at (1, −1): cook stove, wardrobe, bookshelf, grandfather clock, washstand at (1, −2); the mirror (Window behind (−2, −2), a table at (−2, −1)): cook stove and wardrobe; a hallway one cell wide (0..2, 0): wardrobe at (1, 0); stairs in the corner (1, 1) of a house (−2..1, −1..1) with a floor above except over the stairs, with and without a woodpile outside at (2, 1); the turn order (`nextFacing`, four taps, the first fresh) in a room (−3..1, −2..1): a bed r 1 at (−3, −2) with a nightstand r 0 at (−2, −2), an armchair r 2 at (−1, 1) with a fireplace r 1 at (−3, 0), a chair r 2 at (−1, 1) with a table at (0, 1); a wardrobe on the back wall already at its best; a Window's flip | 34 | r 0 (25 + 2); r 0 or r 2; equal scores; the walks 0,1,2,3 · 3,2,1,0 · 1,2,3,0 (each starting at the rules' best); `order[1]`; a flip either way |
