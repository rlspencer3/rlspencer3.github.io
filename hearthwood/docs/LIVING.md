# Hearthwood — Living Town, Phase 1: build spec

*Final spec · 2026-11-24 · to be committed as `hearthwood/docs/LIVING.md`. Merges the experience-first draft and the
systems-first draft (every conflict is decided in §0.3 with a one-line reason) and folds in the independent review
(its main calls are listed in §18).*

Phase 1 adds **villagers with move-in recipes, wishes, day/night routines and the Cozy meter**, plus the UI and sound
feedback for them. It ends there so the owner can playtest. Resources, production, adjacency bonuses, idle production,
the season cycle, weather events, milestones, biomes, festivals and visitors are **out of scope**; §16 lists the hooks
left for them.

**How to read this.** "MUST" is a requirement and "SHOULD" a strong default. Every number is a named constant in
`js/town/data.js` (`TUNE.*`), collected in the tuning table (§15). Piece ids are the catalog's real ids. The parts the
four work packages build against are §12 (contracts) and §13 (who owns which file). Checked facts are marked
**[verified]**: they were run in the real game with `tools/shot.mjs` (Appendix A).

---

## 0. Read me first

### 0.1 Guardrails (absolute: any conflict with them is a bug)

1. No villager death, starvation or permanent loss. **Nobody ever leaves the meadow.** The roster only grows (or the
   player resets it through a dev hook). A traveller joins the roster at the move-in moment; one whose home vanishes
   before that simply turns back along the lane, because they never lived here (§4.5).
2. No decay or damage while the player is away. The town clock only runs while the page is visible and villagers are
   on. Nothing advances offline.
3. No timers that demand a check-in. Wishes fade quietly with no penalty, and no countdown is ever shown.
4. No management screen replaces looking at the town. Every card row leads back to placing something in the world.
5. Every system leads back to building or decorating.
6. Free building stays: placing never costs anything, and the **Villagers & wishes** switch gives a quiet build-only
   meadow (players with an existing build are offered it on a one-time card, §1.3). Unlocks never take away anything
   the player can already place, even when the town module fails to load or its save can't be written (§8.3).
7. Nothing that exists breaks: free building, blueprints and guided mode, undo/redo, saves and slots, share codes, photo
   mode, static batching, picking, the time-of-day setting and the offline PWA all behave exactly as today.

### 0.2 Hard technical constraints

* Plain ES modules, no build step, no new dependencies, everything procedural (no image or audio files).
* Mid-range phones: villagers, bubbles and town effects together cost **≤ 14 extra draw calls with 20 villagers**
  (≤ 20 while a Show me highlight is up). The world itself costs ~94–131 calls.
* The town never writes to the world, the undo stacks or build saves. It only **reads** the world and reacts to
  `world-change`.
* Town objects live in their own scene group on layer 0. Never inside `world.root`, never on layers 1/2, never animated
  through `effects` tweens, no shadow-map casting.

### 0.3 Decision log (where the drafts disagreed)

| # | Topic | Decision | Reason |
|---|---|---|---|
| D1 | Module folder | `js/town/` (systems) | env.js already uses `life` for fireflies and birds, so "town" avoids the clash. |
| D2 | Settings | `state.village` + `state.chatter` (systems) | Babble is the sound most likely to annoy, so it gets its own switch. |
| D3 | The 8 jobs | Gardener, Farmer, Woodcutter, Fisher, Beekeeper, Baker, Lamplighter, Postie (experience) | Farmer splits cleanly from Gardener (crops vs flowers), and Lamplighter is the GDD's "Night: lanterns lit". |
| D4 | Traits | One trait per villager, from 10 (systems) | The owner asked for "a personality trait", and one trait reads clearly on the card. |
| D5 | Home rule | Doors separate rooms, a room must be at least half roofed to count (systems); a doorless or bedless room joins its walled neighbour, low roofs and lofts seal (experience); walls on bare grass, open-sided verandas and an open doorway work as players expect (review); **one flaw forgiven** | Handles patios, porches, undercrofts, balconies, annexes, back bedrooms, A-frames and lofts **[verified]**, and one mis-tap never blocks a move-in. |
| D6 | Capacity | One villager per `bed`, at most 4 per home (experience) | Keeps houses, not beds, the unit of growth. |
| D7 | Broken or lost homes | `waiting` (stay in the broken house) → move to a free bed → `camping` at the lane camp, each committed only after 3 s of a quiet world; no "away" status (experience). Only villagers who once moved in camp | Nobody ever walks off the meadow, the tent makes "build a bed" a visible goal, and mid-edit states never flash. |
| D8 | Home identity | Each villager stores the footprints of its last 3 homes; a match needs overlap ≥ 0.3 (systems' matching, stored per villager; three kept per the review) | Survives undo, load, slot switching and redesign without a global list of vanished homes. |
| D9 | Several jobs fit | Fit-weighted score plus a fixed tie order | Cottage → Gardener (Mabel), Farmhouse → Farmer **[verified]**. |
| D10 | Free builders | First-friend rule (systems) + vacancy card (experience) | The first home is never ignored; after that, recipes give goals. |
| D11 | Nav | 22 × 22 cell grid with edge masks (systems) | Walls sit on cell edges and items fill whole cells, so cells are exact and 4× smaller than 1 m nodes. |
| D12 | Never stuck | Every path query succeeds, using fallback crossing costs (systems); regions are flooded over walk **and hop** edges, so a fenced garden is home ground, and gates are open (review); an invariant check (experience) | Nothing can trap a villager, nobody is ever teleported out of their own garden, and tests assert it. |
| D13 | Indoors | Never walked; residents are **posed** indoors (in bed, in an armchair), seen through the cutaway (experience) | The cutaway is the game's signature view, and posing costs no extra draws. |
| D14 | Lights | Global window glow unchanged + per-home light spill; no window masks (systems) | Masks risk misalignment on 9 window shapes. |
| D15 | Sim | Deterministic logic on fixed 0.25 s ticks; presentation interpolates (systems) | Testable, fast-forwardable, and survives frame drops. |
| D16 | Wish pacing | ≤ 3 open in town (the camp's single bubble is outside the cap), 40 s town-wide spacing, 15 min life (25 min for L), dreams at night (experience); multi-piece wishes show a checklist (review) | Keeps wishes from feeling like a to-do list, and a pinned night still has goals. |
| D17 | Gifts | Fixed schedule on town grants #2, 4, 7, 10, 14, 18, 23, 28, 34, 40 (systems); every gift has a use (experience) | Testable, no bad luck, and gifts feed the routines. |
| D18 | Cozy | Warmth stock (earned, tapering near the top, drifting) + Charm (decor kinds summed over homes on a soft curve) with a population-based floor | A new home never lowers Cozy, every new kind of decor still counts, a neglected town is only quieter, and the hearth never pins at 100. |
| D19 | Hearth | Its own chip after the piece counter (systems) | The counter hides at ≤ 370 px, and the hearth must stay. Above 370 px both stay: the top bar slims while the hearth shows (§10.3, R1 T1.8). |
| D20 | Card portrait | CSS circle in the outfit colour with the job emoji (experience) | No change to thumbs.js and no GPU cost. |
| D21 | Tapping villagers | The town wraps `rig.onTap` / `rig.onPress` / `rig.onAimEnd`; builder.js is untouched (systems). With the Build tool only a tap on a villager's body selects them, and a tap on a Show me spot always builds (review) | Press-and-hold and draw strokes keep building, building near villagers never opens cards, and no core file is edited. |
| D22 | Saves | One device-level key `hearthwood.town.v1` (both) | No slot load, share code or clear can delete a villager. |
| D23 | Time setting | Never flipped by the game; a one-time toast with a **Let the day pass** button, plus a row on the town card (experience). Pinned or not, a granted piece is used straight away (review) | Non-modal, the owner keeps control of the default, and the payoff of every wish shows at any hour. |
| D24 | Before the first home | A passer-by comes off the lane and along the front of the lot to wave (experience; route moved on-screen by the review) | Shows life before asking for anything, where a phone can see it. |
| D25 | Guided mode | Guided = a guide is active **and unfinished**. Homes are computed, but arrivals and new wishes pause; at the finish, campers return first, else a traveller comes 4 s after "welcome home" (both + review) | The guide stays focused and ends with someone coming home, and a finished guide never freezes the town. |
| D26 | Villager scale | 1.25 m to the top of the head (experience, scale-checked) | Reads as an adult beside a 2.5 m storey, about 25 px tall on a phone. |

---

### 0.4 Owner-review overrides (these supersede anything later in this spec)

1. **The day passes by default.** The owner chose in-game time (about 30 minutes of play per season), and pillar 2 is
   "life you can watch", so routines must be seen without hunting for a setting.
   * `state.js`: the default of `timeFlow` becomes `true` (new players).
   * Existing players: on the first run with the town feature (no town key yet, `tips.flowDefault` unset), the town
     sets `state.timeFlow = true` **once**, records `tips.flowDefault = 1`, and shows the toast
     *"🌅 The day now passes, so you can watch village life. Pin the time in Settings."* (6000 ms). After that the game
     never changes `timeFlow` again; a player who pins the time stays pinned.
   * The pinned-time behaviour (§5.4) stays fully supported for players who pin it. The one-time "Let the day pass" tip
     (`flow`) only shows to players who have pinned the time; the town card row stays.
   * Storyboard A (§1.1) is read with the day passing from 10:05; the acceptance and playtest targets for "time
     flowing" are the primary ones (R21 flowing ≥ 0.85 is a must; pinned ≥ 0.95 is still checked).
   * Guided mode, photo mode and blueprints keep working with time flowing (photo mode may pause the sky while open).
2. **One town per device is confirmed** (§12.9): villagers follow the player between builds and are never lost by
   loading a slot or a share code.

## 1. The first five minutes

### 1.1 Storyboard A: first visit, phone portrait, default settings (the day passing from 0.42 = 10:05, §0.4)

| t | What happens |
|---|---|
| 0:00 | Welcome lot as today. While villagers are on, the welcome card gains one line: *"Build a home with a bed and someone may move in."* |
| 0:12 | **Passer-by** (§4.7): a figure with a backpack comes off the country lane, walks along the front edge of the lot and steps onto the welcome lot's stepping stones at (2, 7) (§4.7: two stones up the path from the front row), in the free part of a portrait screen **[verified]**. Toast: *"🎒 A traveller passes by… build a home with a bed and someone might stay. **[👀 Watch]**"*. While they are off-screen an edge arrow points at them. |
| 0:48 | About 36 s after appearing (57 m at 1.6 m/s) they reach the stones, turn to face the camera and wave (♪ cue), look round the lot for 2 s, then walk back the way they came. They are on a portrait screen for about 12 s. |
| 0:50 | The player stamps the Timber-Frame Cottage (Place it instantly). The pop-in cascade lasts about 2 s. |
| 0:51 | 0.3 s after the burst the town recomputes. The cottage is a Home (1 bed) and fits Gardener, Beekeeper and Baker **[verified]**; Gardener scores highest. |
| 0:56 | `FIRST_ARRIVAL_DELAY` 5 s later: toast *"🎒 Someone's coming up the lane to your new home… [👀 Watch]"*. **Mabel** (straw sun hat, sage smock, watering can, backpack) appears on the lane at `LANE[2]` (−37, −8). Her shaders were compiled behind the loading screen, so nothing stutters (§12.8). |
| 1:22 | About 26 s later (17.7 m of lane plus about 22 m on the lot at 1.6 m/s) she reaches the doorstep, knocks (two wood taps) and fades through the door. A ring of chimney puffs, warm light blooming in the door and windows for 2.5 s (visible at noon, §4.6), hearts rise, `move-in` jingle. Toast *"🏡 Mabel the Gardener moved into the thatched cottage!"*. The **hearth** chip appears beside the piece counter with a one-time tip. |
| 1:28 | She steps out, waves and waters the bloom nearest the door (drop cues) for 20–30 s (`FIRST_CHORE`), before the routine (lunch included) takes over, so the payoff stays where the move-in happened (M2 feel check). |
| 1:58 | First wish, 30 s after stepping out: a 🪑 bubble pops over her head with a soft `wish` blip. A villager's first wish is always a small one: a one-piece S wish outdoors with its spot within `FIRST_WISH_NEAR` (4) cells of a door, so it takes 3 taps (§7.4). |
| 2:02 | Tap the bubble → villager card: *"A bench by my door, for morning tea."* → **🪑 Show me** → the camera turns to face the door and eases in, a golden ring and a glowing ghost bench mark the best spot, and the Garden Bench is in hand. |
| 2:05 | Tap the ring or the ghost → the bench lands exactly there (§7.6), and 0.3 s later the wish is granted: Mabel hurries over, hops, hearts, `wish-granted` chime, the hearth flares. Toast *"💛 Mabel: "It's perfect. Thank you!" · Cozy +5"*. |
| 2:10 | Mabel sits down on that bench with her tea: a granted piece is used within `GRANT_USE` (2 min) whatever the phase (§5.3). |
| 2:55 | One-time toast (90 s after the first move-in): *"⏳ Let the day pass to see Mabel's whole day [Let the day pass]"* (only while time is pinned). |
| 3:40 | The player taps the hearth → town card: *"🛏️ The thatched cottage: one more bed and Posy the Beekeeper would come [Show me]"*. |
| 4:15 | Second bed placed in the cutaway → 75 s × Cozy factor later a traveller comes → about 5:00 Posy moves in. |

### 1.2 Storyboard B: free builder

Walls (on a foundation or straight on the grass), a roof and a door, or just an open doorway, but no bed: 8 s after the
last change a grey **🛏️ almost** bubble shows above the roof for 60 s, then the hint lives on in the town card (§3.7).
Tapping it gives *"Almost a home: add a bed"* with **Show me** (ghost bed, Quilted Bed in hand) and **Just a shed 🙂**,
which mutes that building for good. A bedless building of ≤ 6 cells (a garden shed, a hen house) never shows one. With
the bed placed, the **first-friend rule** (§4.3) brings a villager even with no recipe met. Their first wish asks for the
feature their job needs (*"Some flowers by my door would be lovely."*). Later homes that match no recipe show a green
**🏡✨ vacancy** bubble for 90 s, whose card lists the three closest recipes with what each is missing, and **Show me**
for each.

### 1.3 Storyboard C: returning player with an existing build (migration)

There is no town key yet, so the town starts fresh. Homes in the restored build are detected silently when the game
is ready (§3.8). Because this player never chose villagers, a one-time **intro card** asks first: *"🏡 New: villagers may move into
your homes. **[Lovely]** **[Keep my meadow quiet]**"*. **Keep my meadow quiet** sets `state.village = false` (Settings can
turn it back on). **Lovely**, or closing the card any other way, keeps villagers on, and the first traveller arrives
`FIRST_ARRIVAL_DELAY` later with *"🎒 Word of your lovely home has spread. Someone's coming up the lane…"*. No traveller is
scheduled while the card is open. index.js shows it (event `town-intro`) when `loadTown()` reports a fresh town, the
autosave held pieces at boot (`storage.loadAutosave()?.pieces?.length`, read in `init`), villagers are on, and the
page is not a dev page (`showcase`, `bp` or `clean`, as ui.js's welcome rule); the answer is kept in `tips.intro`.

### 1.4 North-star numbers (checked in the playtest with `townhud=1`)

| Moment | Target |
|---|---|
| Passer-by on screen (welcome lot, phone portrait) | ≥ 3 s per pass |
| First home qualifies → traveller visible on the lane | ≤ 6 s |
| First home qualifies → move-in moment | ≤ 40 s for a central home |
| Move-in → first wish bubble | ≈ 36 s |
| Wish shown → granted | 3 taps (bubble, Show me, spot) |
| First thank-you gift | at the 2nd granted wish (≈ 5–10 min) |
| Villagers stuck or slipped through a wall | 0, ever (invariant test) |
| Worst frame while the first traveller appears | ≤ 50 ms (headless proxy; phone profiled) |
| Town time with ≥ 1 villager outdoors | ≥ 85 % with time flowing, ≥ 95 % pinned at Morning |
| Extra draw calls, 20 villagers | ≤ 14 (≤ 20 with a highlight up) |

---

## 2. Villagers

### 2.1 Shared vocabulary (exact piece ids)

| Set | Ids |
|---|---|
| `BLOOM` | `flowers`, `lavender`, `sunflowers`; `gift_flower_cart` counts as **2** |
| `TREE` | `tree_oak`, `tree_pine`, `tree_birch`, `tree_apple` |
| `FARM` | `veggie_bed`, `pumpkins`, `hay_bale`, `chickens`, `scarecrow`, `gift_hen_house` |
| `LAMP` | `lamp_post`, `gift_festoon` |
| `FENCE` | `fence_picket`, `fence_rail`, `hedge` (W layer) |
| `PATHY` | `path`, `steps`, `deck` (F layer, level 0) |
| `SEAT_OUT` | `bench`, `picnic_table`, `rocking_chair`, `boulders`, `hay_bale`, `gift_tea_table` |
| `SEAT_IN` | `armchair`, `sofa`, `rocking_chair` |
| `DOORWAY` | `wall_door`, `wall_door_glass`, `wall_door_barn`, `wall_arch` |
| `WALLISH` | `wall`, `gable`, `gable_window`, `wall_window`, `wall_window_tall`, `wall_window_wide`, `wall_window_round`, `wall_window_arch`, `wall_window_shutters` |

**Home regions** (computed per home, §3):
* **FOOT**: the (x, z) cells of the home's lowest level.
* **DOOR**: the doorstep cells of its exterior doors (for a door onto a veranda, §3.1 step 6, the veranda cell);
  **DOOR1** is the main door's doorstep only.
* **INSIDE**: all (x, y, z) cells of the home.
* **WORK**: the job's work piece(s).
* **ROUTE**: the cells of the villager's cached nav path from WORK (or the nearest hangout) to DOOR1. A wish that uses
  it freezes a copy of those cells when it is created (`w_route_lamp`, §7.3).

**Ids.** Wish template ids are their own namespace: general templates start with `w_`, job templates with `J_`, so none
reads like a piece id (`w_pond` is the wish, `pond` the Lily Pond piece). Trait ids are never piece ids either.

Distance `d(a, S)` is the Chebyshev cell distance `max(|Δx|, |Δz|)` to the nearest cell of S. **Outdoor** items count
on any level (x/z only: a beehive on a roof terrace counts). **INSIDE** means the record's (x, y, z) is a home cell.

### 2.2 The eight jobs

| Job (id, icon) | Recipe: a Home plus… | Fit terms (found / required) | Work: where, pose, cues | Silhouette at 30 m: hat · tool · palette |
|---|---|---|---|---|
| Gardener `gardener` 🌷 | ≥ 3 `BLOOM` within 4 of FOOT | blooms/3 | Visits 2–4 BLOOM pieces within 4 of FOOT: walks to a free neighbour cell, pose `water` 8–12 s (drop cue every 2 s), `admire` 3 s (sparkle), next | broad floppy straw sun hat `#e9c46a` · watering can (pale blue `#8fb8c9`) · sage smock `#9cae6b`, cream apron |
| Farmer `farmer` 🥕 | ≥ 2 `FARM` within 5 of FOOT | farm/2 | Cycles FARM pieces: `veggie_bed`/`pumpkins` → `hoe` (soil chips every 1.2 s), `chickens` → `scatter` (seed cue), `scarecrow` → `pat`, `hay_bale` → `fork`; 15–25 s each | flat cap `#7a5a3a` · pitchfork on the shoulder · denim overalls `#5d7fa3`, cream shirt |
| Woodcutter `woodcutter` 🪓 | `woodpile` within 3 of FOOT **and** ≥ 2 `TREE` within 6 of FOOT | woodpile/1, trees/2 | `chop` at the woodpile's front cell (axe arc every 1.6 s, chips cue, `chop` foley); every 3rd bout walks to a TREE within 6 and `knock`s, looking up 3 s | red knit beanie with bobble `#b4473a` · axe · barn-red plaid jacket (two-tone), beard on 50 % of seeds |
| Fisher `fisher` 🎣 | `pond` (the Lily Pond piece; the scenery pond behind the lot doesn't count, and cards say "a Lily Pond") within 6 of FOOT | pond/1 | `fish` from a free neighbour cell of the pond facing it (or sits on a SEAT_OUT / `gift_rowboat` beside it); bobber bob; every 20–40 s a `catch` (hop, splash drops, fish glyph, `splash` foley) | yellow sou'wester with a long back brim `#e9c46a` · 1.6 m rod carried upright (tallest silhouette) · navy cable jumper `#2f4a66` |
| Beekeeper `beekeeper` 🐝 | `beehive` within 4 of FOOT **and** ≥ 2 `BLOOM` within 2 of that hive | hive/1, blooms/2 | `smoke` at the hive (grey puff cue every 3 s) with 6 bee FX points circling it, then `admire` a bloom within 2; afternoons at `gift_honey_stand` if placed | wide white veiled hat (bell shape) · tin smoker · honey-mustard smock `#e9b949` |
| Baker `baker` 🍞 | INSIDE `kitchen_range` **and** INSIDE (`kitchen` or `kitchen_counter`) **and** (`bench` or `picnic_table`) within 4 of DOOR | 1 each | Bakes indoors (inside pose `stand` facing the range, visible in the cutaway) 60–120 s; 07:00–09:00 a **bread round** (basket) to 1–3 other homes' doorsteps (knock, bread glyph), then `knead` 20 s at the bench/table. With `gift_bread_oven` placed, bakes there outdoors | tall puffy white toque · wicker basket · terracotta dress `#c96a5a`, cream apron |
| Lamplighter `lamplighter` 🏮 | ≥ 2 `LAMP` within 6 of FOOT | lamps/2 | Days: `polish` lamp posts (cloth wiggle 6 s each), naps on a bench (z cue). 17:30–19:30 (and every 2nd pinned-Evening activity): **lamp round** to every LAMP on the lot in nearest-neighbour order, raising the pole (sparkle cue at the lamp head) | tall stovepipe hat `#3b3a3a` · pole with a glowing tip (`lampGlow`) · long navy coat `#2f4a66` |
| Postie `postie` ✉️ | `mailbox` within 3 of DOOR **and** ≥ 2 Homes on the lot | mailbox/1, homes/2 | 08:00–11:00 (and every 3rd pinned Morning/Day activity): **post round** to every home's `mailbox` within 3 of its DOOR (else its DOOR1) in nearest-neighbour order, letter cue and hop at each; afternoons `sort` at its own mailbox | peaked navy cap with a red band · satchel with a strap across the chest · red-brown jacket `#8e3b32` |

**Fit.** `fit(job, home)` = the minimum over the job's terms of `found / required`, capped at 2. The recipe is met when
every term is ≥ 1. No recipe needs a new piece **[verified]**: Cottage → gardener 2.0, beekeeper 1.0, baker 1.0;
Farmhouse → gardener 1.33, farmer 1.5; Log Cabin → woodcutter 1.0; A-Frame → woodcutter 1.0; Tiny Garden Shed: not a
home (no bed).

**Odd jobs.** A villager whose work target is missing (the woodpile was erased, or a first friend, §4.3) **potters**
instead: sweeps the doorstep, waters the nearest bloom, strolls a path. Their job's **odd-job wish** gets weight ×4:
gardener `w_door_flowers`, farmer `w_veg_patch`, woodcutter `J_wood_pile`, fisher `w_pond`, beekeeper `w_hive`, baker
`w_kitchen`, lamplighter `w_door_lamp`, postie `w_mailbox`. There is no penalty of any kind.

### 2.3 Look (procedural, shared by all jobs)

* Chunky storybook folk, **1.25 m** to the top of the head (hats add 0.15–0.4 m): a lathe "bell" body, round head
  (r 0.25 m, centre ≈ 1.0 m), two dot eyes, rosy cheek discs, a hair cap, stubby legs and mitten arms as separate parts
  so the shader can swing them. **≤ 900 triangles** per villager including hat, tool and pack. Vertex colours only, no
  textures.
* Per villager (all from its seed, all instance data):
  * **build** 0..2: slim (width × 0.92), round (width × 1.12) or tall (height × 1.06);
  * **skin** 0..5: `#f3d2b3 #e8b894 #c98f66 #a86b4a #7d4e34 #5a3a28`;
  * **hair** 0..5: `#2b2018 #5a3a22 #8a5a2b #c98a3a #d9c08a #b9b2a6`;
  * **outfit** 0..2: the job colour, lightened 15 %, or darkened 15 %;
  * **voice** 0.85–1.25.
* Accessories that toggle by flag, inside the job geometry: tool, travel pack (backpack + walking stick), basket
  (Baker), book (Bookish while reading).
* A glowing **lantern** (walking after sunset, `t > 0.74` or `t < 0.27`) and the Lamplighter's pole tip are drawn by
  one shared instanced mesh with `mat('lampGlow')`, so they glow with `setNight` like every lamp.

### 2.4 Traits (one per villager, uniform from the seed, never the same as the previous arrival's)

| id | Trait | Routine effect | Wishes it favours (×2, or ×3 where shown) |
|---|---|---|---|
| `early` | 🌅 Early riser | wake −1 h, home −1 h, sleep −1 h; mornings on own porch or bench | `w_door_flowers`, `w_washing_line`, `w_veg_patch`, `w_door_bench` |
| `owl` | 🦉 Night owl | wake +1.5 h, home +2 h, sleep +2 h; fire pit and lamps at night | `w_fire_circle` ×3, `w_door_lamp`, `w_route_lamp`, `w_lamp_seat` |
| `homebody` | 🏡 Homebody | home −1.5 h; breaks on own porch or bench; "pop home" ×2 | `w_soft_rug`, `w_reading_nook`, `w_hearth`, `w_porch`, `w_door_bench` |
| `chatty` | 💬 Chatty | home +1 h, sleep +0.5 h; prefers occupied hangouts (×1.5 per friend there); chats ×1.5 | `w_path_friend` ×3, `w_supper_table`, `w_fire_circle`, `w_picnic_shade` |
| `shy` | 🌿 Shy | prefers empty seats (×0.5 per occupant); yields in narrow spots; waves from afar | `w_shade_tree`, `w_garden_fence`, `w_water_bench`, `w_birds` |
| `bookish` | 📚 Bookish | reads on benches (book shown, page-turn cue) | `w_reading_nook` ×3, `w_birds`, `w_route_lamp` |
| `florist` | 🌸 Flower lover | stops to smell blooms on walks (sparkle) | `w_door_flowers` ×3, `w_window_boxes`, `w_bloom_riot`, `w_hive` |
| `animals` | 🐾 Animal lover | crouches by cats, chickens, the doghouse and the gnome | `w_pet` ×3, `w_chickens`, `w_birds` |
| `sweet` | 🍰 Sweet tooth | visits the Baker's doorstep; lingers at picnic tables | `w_apple_tree` ×3, `w_picnic_shade`, `w_kitchen`, `w_hive` |
| `stargazer` | ✨ Stargazer | after 21:00 under a clear sky may sit out 60 s looking up | `w_fire_circle`, `w_well`, `w_water_bench`, `w_pond` |

The card shows *"Mabel · Gardener 🌷 · 🌅 Early riser"*. Strings never use pronouns: they use the villager's name
(*"Mabel's cottage needs fixing"*), so no pronoun field is needed.

### 2.5 Names

* The **first villager of each job** takes its signature name: **Mabel** (Gardener), **Otis** (Farmer), **Bram**
  (Woodcutter), **Wendell** (Fisher), **Posy** (Beekeeper), **Hazel** (Baker), **Ivy** (Lamplighter), **Percy**
  (Postie).
* Others draw, seeded and unique within the town, from the pool: Clover, Juniper, Rowan, Fern, Basil, Tilly, Alder,
  Wren, Hollis, Marigold, Ezra, Pippa, Linus, Rosalind, Barnaby, Edie, Cedric, Willa, Odette, Amos, Florence, Jasper,
  Nell, Rufus, Agnes, Milo, Thea, Hugo, Bea, Felix, Opal, Arlo, Greta, Moss, Iris, Quill, Dottie, Silas, Juno, Maple,
  Teddy, Sorrel, Winnie, Ambrose, Lark, Bertie, Primrose, Cosmo.
* If the pool runs out, names get " II".

### 2.6 Flavour lines (bank in `data.js` `LINES`; at least this content ships)

**Selection.** One line shows on the villager card, picked deterministically from `rng(seed ^ townDay ^
hash(situation))`, so it stays the same all town-day per situation. Priority:
1. **event**: `movein` for 60 s after moving in, `granted` for 60 s after a grant, `waiting` / `camping` while in that
   status;
2. Cozy tier line (`quiet` / `glowing`) with probability 0.15;
3. phase line (`morning` / `evening` / `night`) with probability 0.3;
4. job line with probability 0.4;
5. otherwise a trait line.

A line never repeats twice in a row for a villager.

```
movein:   "Oh, it's even cosier inside than it looked from the lane!" · "I've hung my hat. That makes it home." ·
          "Look at that door! I think we'll get along, this house and me." · "Home at last. I'll put the kettle on."
granted:  "It's perfect. Thank you!" · "Oh! You remembered!" · "I'll think of you every time I see it." ·
          "Just what I was dreaming of." · "My heart is as full as a teapot." · "Look at that! I could hug it."
          (shy: "Thank you… it's just right.")
waiting:  "A little fixing up and it'll be good as new." · "I don't mind the draught. It's an adventure!" ·
          "I'll sleep on the sofa until it's mended."
camping:  "Sleeping under the stars is an adventure! Though a roof would be nice." ·
          "The lane is lovely at night. A bed would be lovelier." · "I've made friends with an owl. Still, a bed…"
moving:   "A new home! I'll carry my teapot over." · "Change is good. Especially with a fireplace."
morning:  "Morning! The dew's still on the grass." · "First cup of tea, then the world." ·
          "The birds are up before me again." · "What a morning to be busy."
evening:  "The lamps are the best part of the day." · "Supper smells are drifting over the meadow." ·
          "Come and sit. The sun's doing its best colours." · "One more chat, then home."
night:    "Zzz… mmm… honey cakes…" · "Shh, the whole meadow's asleep." · "Owls are out. So am I, apparently."
quiet:    "It's peaceful here. Maybe a little too peaceful." · "A few more flowers and this place would sing."
glowing:  "Have you noticed? Everyone's humming." · "I've never lived anywhere so warm." · "The whole meadow feels like a hug."
gardener: "Every flower has its own little song." · "Water, sunshine and a kind word. That's the secret." ·
          "The lavender's showing off again." · "I talk to the sunflowers. They listen." ·
          "Weeds are just flowers nobody asked for." · "My knees are muddy and my heart is happy."
farmer:   "The beans are climbing faster than I can count them." · "Up with the hens, down with the sun." ·
          "A pumpkin this size deserves a name." · "Good soil is better than gold." ·
          "The scarecrow and I have an understanding." · "Rain tomorrow. I can feel it in my boots."
woodcutter: "Measure twice, chop once." · "Plant one, chop one. That's the deal I made with the forest." ·
          "Nothing warms you like splitting your own logs. Twice." · "That pine's been standing longer than I have." ·
          "A tidy woodpile is a happy winter." · "Mind your toes!"
fisher:   "They're biting today. Well, one is." · "Haven't caught a thing. Best morning all week." ·
          "The pond keeps its secrets. I keep my patience." · "I named that frog Gerald." ·
          "Quiet water, quiet mind." · "The big one got away. Again."
beekeeper: "Hush now, they're busy." · "Every jar is a summer you can keep." ·
          "The bees like the lavender best. Don't tell the sunflowers." · "A gentle puff, a gentle word." ·
          "Buzzing means happy. Mostly." · "Honey on toast, honey in tea, honey on everything."
baker:    "Bread's in! Mind the steps, they're still warm." · "Flour in my hair again. It's a look." ·
          "A loaf for every doorstep." · "The secret ingredient is patience. And butter." ·
          "Smell that? That's breakfast saying hello." · "Knead, rest, bake. Like a good day."
lamplighter: "One more lamp and the whole lane will glow." · "Somebody has to wake the lamps." ·
          "I sleep late because the lamps stay up late." · "A lit lamp is a kind word to strangers." ·
          "Polished till they shine." · "Dusk is my favourite time of day."
postie:   "A letter for everyone today, and two for {neighbour}." · "Nobody's written yet. I deliver the weather instead." ·
          "Rain or shine, the post gets through." · "Every mailbox has its own personality." ·
          "Special delivery: one cheerful hello." · "I know every doorstep by heart."
early:    "Up before the sun again. The lavender smells like summer." · "Early bird gets the quiet." · "I've already had two cups of tea."
owl:      "The stars are better company than you'd think." · "Mornings are a rumour." · "Night's when the meadow tells its stories."
homebody: "My armchair knows my shape by now." · "Home is where the slippers are." · "Why go out when the kettle's on?"
chatty:   "Did you hear about the pumpkin? No? Let me tell you!" · "I've said hello to everyone twice today." · "A good chat is better than a nap."
shy:      "Oh! Hello. I didn't see you there." · "I like it quiet. Quiet is nice." · "I wave from a distance. It still counts."
bookish:  "Just one more chapter." · "This bench is perfect for reading." · "I'm on page two hundred and the dragon's still asleep."
florist:  "Smell that? Sweet peas, I'd bet." · "I stop for every flower. It takes a while." · "A house without flowers is just a box."
animals:  "The cat and I have an understanding." · "Hello, little bird!" · "Did you see the hens? They're so dignified."
sweet:    "Is that pie I smell?" · "Life is short. Eat the honey cake." · "An apple a day, a pie a week."
stargazer: "Look up! There's the Teapot constellation." · "I counted forty stars. Then I lost count." · "The moon's extra round tonight."
welcomeBack: "There you are! We kept the kettle warm." · "Back again! We missed you."
```

`{neighbour}` is filled with another resident's name (seeded per town-day), or *"the hens"* when nobody else lives
here yet. `{friend}` (wish text) is the friend's name. Phase 3 hook: lines may carry a `season` tag later. Phase 1
lines are season-neutral.

---

## 3. What counts as a home

### 3.1 The rule (exact; implemented in `homes.js` `detectBuildings`, prototype verified)

1. **Floor cells**: cells `(x, y, z)` whose F slot holds `foundation` or `floor`. `deck`, `path`, `steps` and `pergola`
   are never floor cells by themselves. In addition, a **ground floor** cell is a level-0 lot cell without a
   `foundation` / `floor` that either
   * (a) lies in a **pocket**: flood the 22 × 22 nav area at level 0 from the 1-cell ring across every edge that isn't
     *sealed* (a `wall` or `door` edge, or a low-roof edge as defined in step 9, seen from either side). An **open
     doorway** counts as sealed for this flood: an unsealed edge that is the only way from the ring into ≤ `POCKET_MAX`
     lot cells (a bridge of the lot graph over unsealed edges, the ring merged into one node; found with one Tarjan
     pass, O(cells)) leaves the cells behind it unreached (R1 T1.1: walls on grass with an open doorway and one missing
     roof panel are then a home with one forgiven flaw, not a 3-cell shed). Unreached lot cells, grouped 4-connected
     across unsealed edges, form pockets; pockets of ≤ `POCKET_MAX` (64) cells count; or
   * (b) is **roofed** (step 4) and belongs to a group of roofed level-0 non-floor cells (4-connected across unsealed
     edges, ≤ 64 cells) that touches at least one `wall` or `door` edge.

   So walls standing straight on the grass (with their stone footings), on deck tiles or round a missing foundation
   tile make a room, and so does a roof leaning on a wall; step 6 decides whether that room is indoors.
2. **Edge class** of the W record on an edge (`K.W(a, x, y, z)`):
   * `wall` = a `WALLISH` piece;
   * `door` = a `DOORWAY` piece (an archway is a doorway);
   * everything else is `open`: empty, `wall_half`, `railing`, `fence_*`, `hedge`.
3. **Rooms**: flood-fill the floor cells of one level across `open` edges only. Walls **and doors** separate rooms.
4. **Roofed cell** `(x, y, z)`: the F slot at `(x, y + 1, z)` holds `floor` or `deck` (a ceiling), **or** the column
   `R|x|*|z` holds any roof panel with `hs ≥ 2y` (flat roofs and skylights count).
5. **Covered room**: roofed cells ≥ 50 % of its cells. Uncovered rooms (patios, roofless shells, walled yards) are
   outdoors.
6. **Verandas**: a covered room with **no bed** in its cells is a veranda when, over its boundary edges,
   `open ≥ closed`, or `open ≥ 2` and it has no `door` edge to a cell outside every covered room. *Closed* edges are
   `wall` and `door` edges plus the open-class edges step 9 never counts as gaps (low roof, gallery, tall gable); the
   rest are *open*. A veranda is **outdoors**: it is not a covered room for steps 7–10, belongs to no building, is
   walkable (§6.1) and is a porch hangout (§5.5). A door from a building onto a veranda is therefore an exterior door,
   and its doorstep is the veranda cell. Covered porches of foundation or deck, the open ground floor under an
   upper-storey overhang, half-wall porches and roofed balconies are verandas **[verified]**.
7. **Own door** of a covered room: a `door` edge from one of its cells to a cell that is not in a covered room, on the
   same level.
8. **Buildings**: union-find over covered rooms, rule (c) first, then (a) and (b):
   * (c) a covered room on level y + 1 merges with every covered room on level y it overlaps in (x, z). Stairs are
     not required. The groups this makes are **towers**; a tower *has its own door* when any of its rooms does, and
     *holds a bed* when any of its rooms does;
   * (a) two rooms on one level joined by a `door` edge (an interior door) merge;
   * (b) two rooms on one level sharing a `wall` edge merge **unless both their towers (as rule c left them) have
     their own door and hold a bed**. A back bedroom without a door and a kitchen annex with its own back door belong
     to the house; semi-detached cottages with a door and a bed each stay two homes, also when the doors are
     downstairs and the beds upstairs.
9. Per building:
   * `lo` = its lowest level;
   * **exterior doors** = `door` edges on level `lo` from a building cell to a cell not in any covered room;
   * **gaps** = boundary edges (building cell → non-building cell on the same level) that are none of:
     * a `wall` or `door` edge;
     * a **low roof**: the building cell's column holds a panel with `hs ≤ 2y + 1` whose low side faces that edge (a
       `slope` whose downhill side, local −Z = −`DIRS[r]`, faces it, or either low side of a `corner`). This is how
       the A-frame's steep panels count as walls;
     * a **gallery**: y > 0, the outside cell has no floor cell, and the cell below it (y − 1) belongs to the
       building (an open loft over its own room);
     * a **tall gable**: a `gable` / `gable_window` on the same edge at a lower level `yy` with
       `h + s ≥ 2(y − yy) + 1`;
   * **doorway**: a building with no exterior door but with a gap on `lo` whose outside cell is in no covered room
     takes one such gap as its way in, an exterior door (`doorway: true`) instead of a flaw: the gap whose outside
     cell holds `PATHY`, else the one facing +Z, else the lowest W key. An open doorway works like a door;
   * **unroofed** = building cells that are not roofed;
   * **flaws** = gaps + unroofed cells;
   * **beds** = `bed` records in building cells (any level).
10. **Home** ⇔ beds ≥ 1 **and** exterior doors ≥ 1 **and** flaws ≤ `HOME_SLACK` (1).

### 3.2 Verified results (Appendix A: `final-proto.js` and `reviser/home2-proto.js`; these are WP1's acceptance numbers)

Blueprints and the original edge cases, unchanged by the ground floors of step 1, the verandas of step 6, rule 8b and
the doorway rule. The Log Cabin and the Farmhouse each also have a veranda (their covered porches, 4 and 5 cells),
outdoors as before:

| Build | Cells | Levels | Rooms | Beds | Doors | Gaps | Unroofed | Home? | Doorsteps |
|---|---|---|---|---|---|---|---|---|---|
| Tiny Garden Shed | 4 | 0 | 1 | 0 | 1 | 0 | 0 | no: `bed` | (−1, 1) |
| A-Frame Cabin | 24 | 0 + 1 | 2 | 1 | 1 | 0 | 0 | **yes** | (−1, 2) |
| Log Cabin | 16 | 0 | 1 | 1 | 1 | 0 | 0 | **yes** | (−1, 1) |
| Timber-Frame Cottage | 20 | 0 | 1 | 1 | 1 | 0 | 0 | **yes** | (0, 2) |
| Farmhouse | 40 | 0 + 1 | 2 | 1 | 2 | 0 | 0 | **yes** | (0, −4), (0, 1) |
| Cottage − 1 back wall | 20 | 0 | 1 | 1 | 1 | 1 | 0 | **yes** (forgiven) | |
| Cottage − 2 back walls | 20 | | | 1 | 1 | 2 | 0 | no: `gaps` | |
| Cottage, door → wall | 20 | | | 1 | 0 | 0 | 0 | no: `door` | |
| Cottage − 1 roof panel | 20 | | | 1 | 1 | 0 | 1 | **yes** (forgiven) | |
| Cottage − 1 panel − 1 wall | 20 | | | 1 | 1 | 1 | 1 | no: `gaps` + `roof` | |
| Cottage − front half of roof | 20 | | | 1 | 1 | 0 | 10 | no: `roof` | |
| Cottage + 3 × 2 foundation patio at the door | 20 | | | 1 | 1 | 0 | 0 | **yes** (patio is outdoors) | |
| Cottage, bed removed | 20 | | | 0 | 1 | 0 | 0 | no: `bed` | |
| Farmhouse, whole roof removed | 20 | 0 | 1 | 0 | 2 | 0 | 0 | no: `roof`* | |
| Two 2 × 2 semis, shared wall, a door + bed each (S1) | 4 + 4 | | | 1 + 1 | 1 + 1 | 0 | 0 | **two homes** | (1, 2), (2, 2) |
| Same, right door bricked up | 8 | | 2 | 2 | 1 | 0 | 0 | **one home**, 2 beds | |

\* The farmhouse's bed is upstairs in an uncovered room. **Reason override:** when a building has no bed but an
uncovered room stacked on it (or sharing a wall with it) holds one, the reason is `roof` and the highlight is that
room's cells (*"The bedroom upstairs needs a roof"*), not `bed`.

Free-build fixtures from the review (all built on `SMALL_HOME(0, 0)` of §13.4 B4 unless stated; full recipes in
Appendix A):

| Fixture | Cells | Levels | Rooms | Beds | Doors | Gaps | Unroofed | Home? | Doorstep (reached by) |
|---|---|---|---|---|---|---|---|---|---|
| V1 covered foundation porch: foundations (0, 2), (1, 2) + `roof_flat` over them | 4 | 0 | 1 | 1 | 1 | 0 | 0 | **yes**; veranda 2 cells | (0, 2) walk |
| V2 the same porch of `deck` | 4 | 0 | 1 | 1 | 1 | 0 | 0 | **yes**; veranda 2 | (0, 2) walk |
| V3 V1 with `wall_half` on its 3 open sides | 4 | 0 | 1 | 1 | 1 | 0 | 0 | **yes**; veranda 2 | (0, 2) hop (half wall) |
| V4 foundation undercroft under a 2 × 3 Floor 2 that overhangs (0..1, 2) | 10 | 0 + 1 | 2 | 1 | 1 | 0 | 0 | **yes**; veranda 2 | (0, 2) walk |
| V4b the same with grass under the overhang | 10 | 0 + 1 | 2 | 1 | 1 | 0 | 0 | **yes**; veranda 2 | (0, 2) walk |
| V5 roofed balcony: upstairs room, door onto 2 `floor` cells with railings, flat roof over all | 8 | 0 + 1 | 2 | 1 | 1 | 0 | 0 | **yes**; verandas: the balcony (Floor 2) and the porch under it | (0, 2) walk |
| A1 bedroom + kitchen annex behind it with its own back door, no interior door | 8 | 0 | 2 | 1 | 2 | 0 | 0 | **one home** | (0, 2), (0, −3) walk |
| S2 the semis with no bed yet in the right half | 8 | 0 | 2 | 1 | 2 | 0 | 0 | **one home** (splits when the bed comes) | (1, 2), (2, 2) |
| S3 two-storey semis: a door each downstairs, a bed each upstairs, a party wall on both floors | 8 + 8 | 0 + 1 | 2 + 2 | 1 + 1 | 1 + 1 | 0 | 0 | **two homes** | (1, 2), (2, 2) |
| G1 SMALL_HOME with no foundations (walls on grass) | 4 ground | 0 | 1 | 1 | 1 | 0 | 0 | **yes** | (0, 2) walk |
| G2 G1 − 1 back wall | 4 ground | 0 | 1 | 1 | 1 | 1 | 0 | **yes** (forgiven) | (0, 2) |
| G3 G1 − 1 roof panel | 4 ground | 0 | 1 | 1 | 1 | 0 | 1 | **yes** (forgiven) | (0, 2) |
| G4 SMALL_HOME with the door edge left empty | 4 | 0 | 1 | 1 | 1 doorway | 0 | 0 | **yes** | (0, 2) |
| G5 G1 with the door edge left empty | 4 ground | 0 | 1 | 1 | 1 doorway | 0 | 0 | **yes** | (0, 2) |
| G6 SMALL_HOME with a wall instead of the door | 4 | 0 | 1 | 1 | 0 | 0 | 0 | no: `door` | |
| G7 lean-to on grass: 2 × 1, walls on 3 sides, flat roof, open front, no bed | — | | | | | | | no building (a veranda) | |
| G8 gazebo: 4 posts and a flat roof on grass, a bench under it | — | | | | | | | no building | |
| G9 SMALL_HOME + a walled 3 × 3 grass yard with a door | 4 | 0 | 1 | 1 | 1 | 0 | 0 | **yes**; the yard is an uncovered room (outdoors) | (0, 2) |
| G10 G5 − the roof panel at (1, 1) (R1 T1.1) | 4 ground | 0 | 1 | 1 | 1 doorway | 0 | 1 | **yes** (forgiven) | (0, 2) |
| G11 G5 − the roof panel over the doorway's own cell (0, 1) | 4 ground | 0 | 1 | 1 | 1 doorway | 0 | 1 | **yes** (forgiven) | (0, 2) |
| G12 a walled 3 × 3 grass yard with one open gap, no roof | — | | | | | | | no building (an uncovered room, outdoors) | |

Cost **[verified]**: detection 0.1–0.6 ms per blueprint lot with the original rule; with this rule the string-keyed
prototype takes 0.8–1.2 ms (detect) + 0.2–0.45 ms (nav) on the farmhouse, averaged over 20 runs (two runs). The
implementation works on typed arrays over the 22 × 22 grid (§12.11 budget).

### 3.3 Capacity, main door, doorsteps

* **Capacity** = `min(beds, BEDS_PER_HOME_MAX = 4)`. Each resident is bound to one bed slot key `I|x|y|z` ("Mabel's
  bed"). Free beds are taken in key order.
* **Doorstep** of an exterior door = the outside cell across the door edge (a veranda cell for a door onto a veranda,
  the cell outside the gap for a doorway), projected to the ground. If `lo > 0`, the villager stands on the ground cell
  below it and "climbs in" with a fade. A doorstep outside the nav grid is ignored.
* **Main door (DOOR1)**: the exterior door whose doorstep holds a `PATHY` cell; else the one facing +Z (the blueprint
  convention); else the lowest slot key.

### 3.4 Names of homes (for the UI)

* **Adjective** from the majority roof material over its cells: `roofThatch` → "thatched", `roofSlate` →
  "slate-roofed", `roofMetal` → "tin-roofed", `roofShingle` → "shingled", `roofTile` → "red-tiled", only flat roofs →
  "flat-roofed".
* **Noun**:
  * majority wall material `log` / `logDark` → "log cabin";
  * else majority `roof_steep*` panels → "A-frame";
  * else ≥ 2 levels → "farmhouse";
  * else ≤ 8 cells → "hut";
  * else ≤ 24 cells → "cottage";
  * else "house".
* Display: *"the thatched cottage"*. If two homes in town share a name, the first resident's name is prefixed:
  *"Mabel's thatched cottage"*.

### 3.5 Home identity and re-binding (never evict)

Every villager stores `home = { feet, bed }`: `feet` holds the footprints (lowest-level cells, packed) of the last
`FEET_KEPT` (3) homes they lived in, most recent first, and `bed` is their bed key. After **every** recompute, each
resident and waiting villager is re-bound, in arrival order:

1. Its `bed` key is still a bed inside a **Home** whose foot overlaps one of its stored feet by ≥ `HOME_MATCH` (0.3,
   overlap / min(|old|, |new|)) → keep it. That foot is refreshed and moved to the front.
2. Else a **Home** overlapping a stored foot (most recent first) by ≥ 0.3 has a free bed → take it silently.
3. Else a **building** (not a Home) overlapping the most recent foot by ≥ 0.3 exists → status **`waiting`**: they stay.
   They sleep inside on a sofa, armchair or rug spot (else "a bedroll by the hearth" at the building's centre cell). No
   new arrivals go there, and they make no new wishes (the fix-up is their wish). After `FIXUP_DELAY` (60 s of town
   clock) a 🔨 bubble shows above its roof. When it qualifies again they are home again, with no second move-in.
4. Else **moving day**: the Home with a free bed whose recipe fits them best (fit, then distance), else any Home with
   a free bed. They walk there (no lane, no fanfare).
5. Else **`camping`** at the lane camp (§3.6).

**Settling.** A change of binding or status is **committed** only once the world has been quiet for `SETTLE` (3 s of
town clock since the last recompute, i.e. since the sim's last `setWorld`) and the change still holds. Until then nothing moves: plans run on, tents don't
appear, no event fires. The one exception is a villager posed inside a building that no longer exists: they step out
at once (a door-out at the old doorstep, else a fade-in on the nearest free cell) and wait there, looking round. So
erasing and re-placing a roof, a bed or a wall, or an undo within 3 s, changes nothing at all.

**When a change commits:**
* The villager's open wish is dropped silently (no fade line, no cooldown, not counted as faded), because its DOOR,
  FOOT and ROUTE anchors belonged to the old home. Their next wish comes `REWISH_AFTER_MOVE` (60 s) after the commit.
* One `town-status` event lists every change of that commit, and the hud turns it into **one** summary toast
  (§10.5): *"📦 Mabel is moving into the slate-roofed house"*, *"📦 3 neighbours moved into the new houses"*, *"⛺ 4
  villagers are camping by the lane until there are beds"*.
* Waiting → resident ("fixed up") gives the thank-you toast, event `town-fixed` and Warmth +`COZY_FIX` (3) **only if the
  fix-up bubble had been shown** (waiting ≥ `FIXUP_DELAY`). A quick remodel earns nothing and says nothing, so undo
  can't farm it.
* A villager whose binding changes walks to the new home's doorstep and goes in (no lane, no fanfare); one already
  inside the same building stays posed. Campers (and `waiting` villagers whose building vanished) take free beds
  before any new traveller (§4.2).

**Restore.** The first `setWorld` after boot is flagged `restore` (§3.8): steps 1–5 run at once and silently (no
settling, no events, no toasts, no walks, no arrival timers for existing villagers). Everyone is placed with `placeFor`;
anyone whose home is gone is put straight at the camp. A changed binding drops the open wish silently, as above. One
summary line goes to the town card (`view().note`, e.g. *"⛺ 2 neighbours are camping by the lane"*), never a toast.
The same build gives the same bindings, so a plain reload changes nothing.

Undo, load and clear simply re-run this. Because the feet are stored per villager, undoing a clear finds their old
cottage again, and switching between two saved builds puts everyone back where they lived in each.

### 3.6 The lane camp

* Off-lot ring cells `(−11, 0)` … `(−11, 9)` (world x ∈ [−22, −20], z ∈ [0, 20]), beside the lane mouth, skipping the
  lane cell and any cell that is some home's doorstep. This strip is inside env.js's `KEEP` (22.5 m), so no scenery
  grows there.
* One small canvas A-frame tent per 2 campers, in cell order, door facing +X (toward the lot), each with a lantern
  (glow mesh). Tents block their nav cells. Tents appear and go only when a camping status commits (§3.5).
* At night campers lie on bedrolls at the tent mouth. By day they follow the normal routine with "home" = their tent.
* Only villagers who once moved in can camp (a traveller turns back instead, §4.5).
* **Camp wish** (`w_camp`): while anyone camps, a single town-level ⛺ bubble shows over the camp, outside
  `MAX_OPEN_WISHES`, with no lifetime: *"A bed for the campers (n)"*. Show me: if a Home has a free floor cell inside
  and capacity < 4, a ghost bed there (the Home with the most free floor first); else a Stone Foundation framed on a
  free 6 × 6 area, with *"or try a blueprint"* on the card. When a camper moves into a bed after camping for at least
  `FIXUP_DELAY`, that camper's thank-you plays (hearts, chime, toast) with Warmth +`COZY_WISH.L` (12), once per
  (villager, bed key) ever (`campGrants`, §12.9). It doesn't count toward `GIFT_AT`. The other campers keep waiting,
  with no re-grant.

### 3.7 Hints for unfinished buildings

| Bubble | Shown when | Card text | Show me |
|---|---|---|---|
| **almost** (grey; icon of the first missing thing) | a building (or an uncovered room with ≥ 50 % of its boundary walled) of ≥ 4 cells (any size when it holds a bed, so a bedded hut is never a silent dead end; R1 T1.1), no residents, not a Home, unchanged for `ALMOST_DELAY` (8 s), **and** either (≥ 50 % of its cells roofed and it has a door or doorway) or it holds a bed. Never for a bedless building of ≤ `SHED_CELLS` (6) cells, a muted footprint, or in guided mode. Shown once per building (matched by footprint overlap ≥ 0.3, remembered for the session) for `ALMOST_SHOW` (60 s); after that it is only listed on the town card. ≤ 3 at a time | first missing, in this order: 🚪 *"Needs a way in: swap a wall for a door"* · 🧱 *"A gap in the walls (n)"* · 🏠 *"A hole in the roof (n cells)"* or *"The bedroom upstairs needs a roof"* · 🛏️ *"Almost a home: add a bed"*. Buttons: **Show me** and **Just a shed 🙂** (mutes this footprint for good, stored in the save's `muted`; a bed placed inside lifts the mute) | see below |
| **fix-up** 🔨 (amber) | a `waiting` resident's building for ≥ `FIXUP_DELAY` (60 s) | *"Mabel's thatched cottage needs fixing: {first missing}"* | as almost |
| **vacancy** 🏡✨ (green) | a Home with a free bed, after the first villager, matching no job's recipe. Never while someone is camping (or waiting with no building) or a binding change is still settling (§3.5): they take free beds first (§4.2), so the bubble would flash for a bed filled a moment later (R1 T1.5). Shown for `VACANCY_SHOW` (90 s); it comes back only when the Cozy tier changes or a piece from some recipe's item sets is placed within that recipe's radius of the home | *"Who could live here?"* plus the 3 jobs with the fewest missing items: *"🎣 Fisher: a Lily Pond within 6 cells"* | per row: the plan for its first missing piece (§7.5) |

**Hint Show me** (index.js; the ghost record comes from `wishes.hintSpots`, index.js fills `h` and copies looks):
* **door**: candidates are `lo` boundary edges holding a plain `wall` whose outside cell is walkable and in no covered
  room; the one whose outside cell holds `PATHY` first, else facing +Z, else the lowest key. Ghost `wall_door`, `m` /
  `c` from the wall it replaces (when in the door's `mats`), `k` from the nearest `DOORWAY` piece in town.
* **gaps**: a ghost `wall` on each gap edge with `m` / `c` of the nearest `WALLISH` piece of that building; the existing
  one-tap gap mending fills it.
* **roof**: rings on the unroofed cells; the ghost copies `t`, `r`, `m`, `c` from the nearest roof panel of that
  building (Chebyshev distance, then key; `roof_flat` for a flat-roofed one), with `h` =
  `builder.autoRoofHeight(def, x, z, r, level)`. An A-frame gets a steep panel, a hip a corner, a flat roof a flat.
* **bed**: a ghost bed on the free cell nearest the middle of the lowest level, `m` / `c` copied from the nearest bed
  in town.
* Show me then sets `state.mats[def.matGroup]`, `state.colors[m]` and `state.accent` from the ghost record, as Pick
  does, so the piece in hand matches the house (a log cabin is mended with logs).

### 3.8 Recompute scheduling

* **First recompute.** index.js runs it on the `ready` event, after the starting content (autosave restore, welcome
  lot, `?bp=` stamp), **always**, even when no `world-change` happened (`clean=1`). It is the silent restore of §3.5.
  Before it, `update()` draws and ticks nothing, and `world-change` events only mark the town dirty.
* After that, every `world-change` marks the town dirty. Recompute runs **0.3 s after the last change**, at most once
  per 0.5 s (a stamp or a draw stroke is one recompute), and never twice for the same `world.version`.
* A recompute rebuilds: index → buildings → nav → hangout spots → recipes → charm → re-binding (with settling) → wish
  checks.
* `load`, `clear`, `undo` and `redo` kinds recompute the same way: the town keeps no incremental state.
* Tests use `debug.edit(fn)` (§12.13): it applies the edits and recomputes synchronously at a tick boundary, so
  determinism checks never depend on frame timing.

---

## 4. Move-in

### 4.1 When it is checked

After each recompute and every 2 s of town clock. Never while villagers are off, the page is hidden, the town is not
yet `ready` (§3.8), the intro card is open (§1.3), or the game is **guided**:

```js
const p = app.blueprints?.progress?.();
const guided = !!(app.blueprints?.active?.() && p && p.done < p.total);
```

blueprints.js keeps a finished guide active until Stop / Close or another guide or stamp (its card hides the Close
button 6 s after "welcome home"), so a finished guide must **not** count as guided. Erasing a piece of a finished
guide makes it unfinished again, and the pause returns until it is done.

### 4.2 Who takes a free bed (in order)

Homes with free beds (`capacity − residents − incoming`) are served oldest vacancy first:

1. a **camper**, or a `waiting` villager whose building vanished, walks over after `RETURN_DELAY` (3 s), from where
   they are; no recipe needed. They choose the best-fitting home.
2. Else, if the roster is below `MAX_VILLAGERS` (20) and no traveller is on the road, a **new traveller** of the best
   job (§4.3) after the pacing delay (§4.4).

Only one new traveller walks at a time. Returns are not limited.

### 4.3 Choosing the job

* Candidates are the jobs whose recipe this home meets. `score = 100 × [no villager of this job yet] − 10 × (villagers
  of this job) + 10 × fit`; ties follow `JOB_ORDER` = gardener, farmer, woodcutter, fisher, beekeeper, baker,
  lamplighter, postie.
* The runners-up are remembered for the town card (*"Posy the Beekeeper would come too, with another bed"*).
* **First-friend rule**: while the roster is empty, the first Home gets a traveller even if no recipe is met. Their
  job is the one with the fewest missing items, counted as **unmet terms** (features) of its recipe, ties by
  `JOB_ORDER` (M1: counting units, Σ `max(0, required − found)`, picked the Fisher on bare semis and contradicted B2 and
  Storyboard B, which expect the Gardener). The vacancy card's "closest jobs" sort by unmet terms, then units. Their
  first wish is their odd-job wish (§2.2).
* After that, a Home with no matching recipe shows the vacancy bubble.

### 4.4 Pacing (town clock)

| Case | Delay before the traveller appears on the lane |
|---|---|
| First villager ever (also migration, §1.3, counted from the intro card's answer) | `FIRST_ARRIVAL_DELAY` = 5 s after the Home qualifies |
| Guided build finished (`progress().done === total`, §4.1) and its house is a Home | campers return to it first (`RETURN_DELAY`); otherwise a traveller after `GUIDED_ARRIVAL_DELAY` = 4 s |
| Every later newcomer | `ARRIVAL_BASE` 75 s × `lerp(1.5, 0.6, Cozy / 100)` × U(0.85, 1.15), from the later of "vacancy + recipe became true" and "previous arrival" |

The timer resets when the vacancy disappears (an undo, say, once settled, §3.5) and restarts from 0 when it returns,
so toggling a roof can't spam arrivals. Cozy 20 gives ≈ 99 s, Cozy 80 ≈ 59 s.

### 4.5 The traveller

* Spawns at `LANE[2]` (−37, −8) and walks the lane `LANE[2] → LANE[1] → LANE[0]` (17.7 m), then enters the lot at the
  ring cell (−11, −1) and follows the nav path to the doorstep. The lane polyline is resampled every 1 m with
  `env.heightAt` for y, so the walker never floats or sinks between the 10 m lane points.
* Speed `TRAVELLER_SPEED` 1.6 m/s, which is eager; residents walk at 1.25.
* Carries the travel pack and a 🎒 bubble. Tapping it gives *"Mabel, a gardener, is coming to live in the thatched
  cottage."*
* Arrives at night with a lantern and goes straight to bed after the moment.
* **Watch**: the arrival toast's 👀 button makes the camera follow the traveller (§10.2 Follow).
* If the target home stops qualifying mid-walk (once settled, §3.5), they re-target another vacancy. If there is
  none, they walk back to the lane mouth, sit on their pack for up to `TURN_BACK_WAIT` (20 s) in case it comes back (an
  undo), then **turn back** along the lane and fade out at `LANE[2]`. They never lived here, so nothing is lost: they
  are not on the roster, they never camp, and the same traveller (name, job, look, seed, kept in the save's
  `traveller`) comes again when a vacancy returns, with the arrival timer restarted.
* They join the roster at the move-in moment.

### 4.6 The move-in moment (beats, relative to reaching the doorstep)

| t | Beat |
|---|---|
| 0.0 s | Faces the door, pack off, knock-hop (0.35 s) with two soft wood taps (`move-in` starts with them) |
| 0.6 s | Steps 0.4 m into the door plane while dither-fading (0.4 s) |
| 1.0 s | **Lights on**: the home's door and lowest-level window openings fill with warm light and its ground spill blooms, at brightness `max(env.night, MOVEIN_GLOW)` (0.7) for 2.5 s, easing out over the last 0.8 s, so it reads at noon (§5.6). **Chimney puffs**: a ring of 8 FX puffs rising from the chimney's emitter position (else 0.5 m above the roof's highest panel over the door). Hearts rise at the door; the rest of the jingle plays |
| 1.2 s | Toast *"🏡 Mabel the Gardener moved into the thatched cottage!"*; nameplate bubble *"Mabel 🌷"* above the roof for 4 s; event `town-movein` |
| 1.5 s | First villager only: the hearth chip appears with a glow-up |
| 5.7 s | First villager only: the one-time tip *"🔥 Your town has a hearth now. It glows brighter as the town gets cosier."* (it waits until the 4 s nameplate has gone, so the two never stack over it; M2). The nameplate itself drops below the toast stack when its roof anchor is in the toast band |
| 6.0 s | Steps out, waves, then a chore by the door for 20–30 s (`FIRST_CHORE`: water the bloom nearest the main door within 3 cells, else sweep the doorstep), then the routine (or stays in bed at night). Warmth +`COZY_MOVEIN` (4, tapered, §9.1) |
| +30 s | First wish (`FIRST_WISH_DELAY` 30 s for the town's first villager; 60 s for later ones) |

### 4.7 Passer-by (no Home on the lot)

* While the lot has no Home and the roster is empty, a passer-by walks `PASSERBY_FIRST` (12 s) after `ready`, then every
  180 s, at most 3 per session. While a card covers the meadow (the first-visit welcome card, the menu sheet, a dialog:
  index.js sets `sim.holdPasserby`), nobody sets off: the first one comes `PASSERBY_FIRST` after it closes, so a player
  who reads the welcome card still sees the wave (M2 feel check).
* Route: they appear on the lane at `LANE[1]` (−28, −3.5), walk to the lane cell (−11, −1), then along the ring (the
  west column, then the front row z = 10) to the **viewing spot**, and back the same way, fading out at `LANE[1]`. The
  viewing spot is the first `PATHY` cell on the lot's front row (z = 9, lowest |x| first), then up to
  `PASSERBY_VIEW_BACK` (2) cells further along that path (straight back, while it stays `PATHY` and free): on the welcome
  lot the stepping stones at (2, 7), beside the lamp post, mid-screen and clear of the tray (M2). With none, it is the
  front ring cell (0, 10). The route is chosen from the world only (never the
  camera), so the sim stays deterministic.
* On the viewing spot they face the default camera direction (+Z, toward the viewer), wave (♪ cue) for 2 s, look
  round the lot (`admire`) for 2 s, then turn back. Speed 1.6 m/s: about 36 s from the lane to the stones. On a
  portrait phone the welcome lot shows the front row from x ≈ −2 to the stones in its free area **[verified]**
  (Appendix A), so each pass is on screen for about 12 s.
* They wear a random job look with the pack. They are not villagers, not saved and not tappable, but while they are
  off-screen their bubble-less **edge arrow** (§10.1) points at them, and the one-time tip toast carries **👀 Watch**,
  which follows them (§10.2).

### 4.8 Caps

* Roster ≤ `MAX_VILLAGERS` = 20 (this is also the on-stage cap).
* Residents ≤ Σ capacity.
* At the cap the town card reads *"The meadow is full: 20 neighbours live here."* Recipes for jobs nobody has then
  stop bringing anyone; whether a resident may take up a new job at the cap is an owner question (§17).

---

## 5. Day and night

### 5.1 Two clocks

* **Sky time** is `state.time` (0..1, 0.5 = noon). env.js advances it only while `state.timeFlow` is on; a day takes
  `DAY_SECONDS` = 600 s, so one game hour = 25 s. **Villagers read their phase from sky time**, so what the sky shows
  is what they do.
* **The dusk lingers** (M2 feel check: by 18:30 the evening hangouts were already in full night): env.js maps sky time
  to the sun's angle through a gentle warp, so from the Sunset preset (0.74, 17:45) the sun sinks slowly: 17:45–20:10 is
  a long sunset into a blue dusk, then night deepens by 22:05, where the sun is back in step (`DUSK = [0.74, 0.84,
  0.762, 0.92]`: from, slow part ends, sun time there, back in step). Every preset (Dawn, Morning, Noon, Sunset, Night)
  looks as it always did; only the slider's in-between evening hours look different. This is the owner's call to keep
  or drop (one constant in env.js).
* **Town clock** (`clock`, seconds) advances by `dt × townSpeed` only while the page is visible, villagers are on, the
  module is healthy and its restore recompute has run (§3.8). Wish lifetimes, arrivals, Cozy drift, the settle and
  fix-up delays and the town day (`floor(clock / 600)`, event `town-day`) all run on it, never on wall-clock time.
* Phase 3 turns a season every `SEASON_DAYS` = 3 town days (30 min of play). This is reserved, not built.

### 5.2 Personal schedule (hours h = 24 × sky time; ± seeded jitter of 0.4 h per villager)

| | wake | home | sleep |
|---|---|---|---|
| steady | 05:30 | 21:30 | 23:00 |
| `early` | 04:30 | 20:30 | 22:00 |
| `owl` | 07:00 | 23:30 | 01:00 |
| `homebody` | 05:30 | 20:00 | 23:00 |
| `chatty` | 05:30 | 22:30 | 23:30 |

The other traits keep the steady schedule. With time flowing, a steady villager is indoors from 21:30 to 05:30 (a
third of each 10-minute day), and the night is never empty (lantern strolls, below).

Phase(v, h), with wrap-around past midnight:
* `night` if h ≥ sleep or h < wake;
* else `morning` if h < 08:30;
* else `day` if h < 17:00;
* else `evening` if h < home;
* else `home`.

Lunch is 12:00–13:00 inside `day`.

### 5.3 Activities

| Phase | Options (base weight) | Notes |
|---|---|---|
| morning | chore near home 50, walk to work early 20, porch/bench sit 20, check own mailbox 10 | Postie and Baker start with their round. Chores: water a bloom within 3 of DOOR, sweep the doorstep, stretch |
| day | work 60, break on a seat 15, visit a working or seated villager within 15 m and chat 10–20 s 10, stroll to a pretty spot within 15 m (a bloom, tree, pond, gift or lamp) and admire 5–10 s 10, sit at a hangout 5 (bench, fire pit, tea table; the fire's evening bonus doesn't apply) | Lunch 12:00–13:00: break at the nearest SEAT_OUT within 10 cells, else DOOR1 |
| evening | hangout 70, stroll 15, own porch 15 | Lamplighter's round first 17:30–19:30 |
| home | inside 100 | Chatty: 30 % a doorstep chat if another home's DOOR1 is within 6 cells |
| night | asleep in bed | **Lantern strolls**: every `NIGHT_STROLL_EVERY` (90 s of town clock) one villager (owls and stargazers first, then round-robin) gets up for `NIGHT_STROLL_LEN` (30 s): a lantern stroll along paths, a sit by the fire pit or under a lamp, or (stargazers) lying back on the grass looking up. Only a villager whose own phase is `night`, and (time flowing) at least `NIGHT_STROLL_WAKE_GAP` (2.5 h) before their wake hour; back in bed it is an ordinary night's sleep, which the wake hour ends (M2: a stroll used to end in an endless sleep that kept the villager in bed all the next day). Owls before their sleep hour: hangout at the fire pit or lamps 60, stroll with lantern 40 |

**Using a granted piece** (overrides the table): for `GRANT_USE` (120 s) after a grant, the granter's next activity
uses the granted piece, whatever the phase (asleep villagers get up for it, as a night stroll would): a seat → sit
there (Bookish read); a fire pit → stand at it warming their hands (`warm`); a lamp → read or chat under it; blooms and
trees → `water` / `admire`; a pond → sit or stand by it watching; a mailbox → check it; a path → stroll along it; an
indoor piece → stand or sit by it inside (seen in the cutaway). So every wish shows its payoff even at the pinned
default hour.

**Durations** (seeded, ±25 %): work 60–120 s, break 20–40 s, chore 15–30 s, hangout 60–120 s, inside (pop home)
20–40 s. Trait multipliers from §2.4 apply to the weights. A target that can't be found (no seat, no work piece) falls
through to `wander` (a free cell within 6 of home, 8–15 s).

### 5.4 Flowing vs pinned time

| | Day passing (`timeFlow` on, the default, §0.4) | Time pinned (player's choice) |
|---|---|---|
| Phase | follows the clock | fixed at the pinned hour |
| Activities | end when the phase ends; trips started within 3 s of a phase change walk ×1.6 ("hurry") | **loop within the phase**: the picker keeps choosing (work 50–90 s → break 25–45 s → visit, stroll, hangout or pop home…) |
| Going home at night | walk home; a villager more than 20 s from home walks 6 s, then slips home (dither) | n/a |
| Night | asleep, with lantern strolls (§5.3) | asleep, with the same lantern strolls |
| Slider jump (\|Δ sky\| > 0.05 between ticks) | everyone fades out while the slider moves; `RESEAT_DELAY` (0.4 s) after the last jump they are **re-seated**: fade in where `placeFor(v)` puts them for the new phase (or a door exit / entry) | same |

The presets read well pinned:
* Dawn 0.27 (06:29): everyone up but the owls; early risers well into their chores.
* Morning 0.42 (10:05, the default): the work loop, with seat breaks, hangouts and any granted piece in use.
* Noon 0.55 (13:12): after lunch.
* Sunset 0.74 (17:45): evening hangouts and the lamp round.
* Night 0.9 (21:36): most people indoors with lights on, early risers asleep, owls and chatty folk by the fire.

Apart from the one-time switch to flowing time in §0.4, the game never changes `timeFlow` itself. Players who pin the
time are offered it once (toast with action, §10.6), and the town card has a row while time is pinned.

### 5.5 Where villagers socialise (spots, computed on recompute, reserved by the sim)

| Source | Spots (local to the piece; world via its `r` and the cell's surface y) | Pose |
|---|---|---|
| `bench` | 2 seats at x = ±0.40, z = −0.05, seat y 0.42; approached from the cell in front (local +Z) | sit, facing local +Z |
| `picnic_table` | 4 seats at (±0.45, ±0.62), y 0.45 | sit, facing the table |
| `rocking_chair` (outdoors) | 1 seat, y 0.42 | sit + rock |
| `fire_pit` | 4 seats on its two log seats (logs at local (0, −0.85) and (0.85, 0.05) per decor.js), y 0.30; plus ≤ 2 standing spots in walkable neighbour cells | sit or stand facing the fire |
| `well` | 2 standing spots in walkable neighbour cells | stand, lean |
| `boulders`, `hay_bale` | 1 seat each, y 0.45 | sit |
| gifts with seats | the seat anchors in `data.js` `GIFTS` (§12.4): `gift_tea_table` 2, `gift_rowboat` 1 | sit facing the anchor's yaw |
| porch | `deck` and veranda cells (§3.1 step 6) adjacent to a DOOR cell, ≤ 2 per home | stand / lean, facing out |
| plaza | `path` cells tiled into non-overlapping 2 × 2 blocks (cells scanned in index order; a block is taken only when all 4 cells are free path) | 4 standing spots facing the block centre |
| own doorstep | 1 per home (fallback) | stand |

**Hangout score** = free spots × (1 + 1.0 × LAMP within 2 [evening]) × (1 + 1.5 × `fire_pit` [evening/night]) × (1 +
0.2 × BLOOM within 2 [day]) × (1.5 for `gift_tea_table`) / (1 + walk metres / 15), then × the trait preferences. At
most 6 villagers per hangout and 4 per plaza block. Two villagers at the same hangout, or passing within 1.6 m, face
each other and chat (bounces, chatter, §11). (M2, in actors.js: two villagers standing or sitting within 1.6 m turn
their heads to each other and take the `chat` pose's gestures and bounces; passing, they may wave, §9.2.)

### 5.6 Lights

* The global window glow (`materials.setNight` → `windowGlass`, `lampGlow`, `ember`) **does not change**. Empty houses
  still glow at night, as today.
* **Light spill** marks occupied homes: soft warm additive quads on the nav surface + 0.03 m (so they sit on decks and
  paths without z-fighting) outside every lowest-level window and door edge of a Home. Brightness = `env.night ×
  SPILL_GAIN (0.55) × L`, eased over 2 s, where L is:
  * 1 while a resident is inside and awake;
  * 0.15 when all residents inside are asleep;
  * 0 when nobody is home.
* **Move-in glow** (§4.6): for 2.5 s the home's spill and an **opening glow** (warm quads standing in its door and
  lowest-level window openings, 2 cm proud of the wall on the outside) shine at `max(env.night, MOVEIN_GLOW)` (0.7),
  so "lights on" reads at noon. Spill and opening glow are one instanced mesh: one draw call for the whole town,
  hidden when nothing is lit (`night < 0.02` and no move-in glow running).
* **Indoor glow** (M2 feel check, so a sleeper reads in the night cutaway): one more flat quad in the same mesh per Home,
  on its lowest floor (floor + 0.04 m, 80 % of the footprint's bounding box), brightness `env.night × 0.7 × (L ≥ 0.5 ? L
  : 4 L)`, i.e. 0.7 × night while someone is up inside and 0.42 × night while all sleep, 0 when nobody is home. Walls and
  roofs hide it unless the cutaway opens the house.

### 5.7 Indoor poses (never walked; drawn only)

* A villager inside is drawn at an indoor spot of their home, at that spot's level, **only when the level is visible**
  (`world.seeAll || level ≤ world.viewLevel`). Walls and roofs hide them otherwise.
* Asleep → lying in **their bed**: body along the bed's local Z, head toward local −Z (the headboard), centre at local
  (0, 0.62, −0.10), a quilt in their own outfit colour (lighter) pulled up to the chest, its top edge folded back in
  cream (legs hidden by the lie flag). Every lying pose puts the head toward `face` (§12.3; M2 fixed actors, which had
  it at the foot). Campers lie at the tent mouth with the head into the tent.
* Awake in the `home` phase → seated in the first free `armchair` / `sofa` (2 seats, x ±0.4) / `rocking_chair` /
  `chair` of the home (facing local +Z, seat y 0.45); else standing 0.75 m in front of `kitchen_range` (always for the
  Baker), `desk` or `fireplace` / `wood_stove`, facing it; else standing at the centre cell of FOOT.
* `waiting` villagers sleep on a sofa (lying along it, centred), armchair or rug spot, else lie at the building's centre
  cell ("a bedroll by the hearth").
* A tiny 💤 bubble shows above a sleeping home's roof when the camera target is within 25 m.

---

## 6. Movement

### 6.1 Nav grid

* 22 × 22 **cells** on level 0: the lot (−10..9) plus a 1-cell ring (−11 and 10). The ring is flat (`heightAt` = 0
  within 26 m) and scenery-free (`KEEP` = 22.5 m).
* Cell (x, z) ↔ index `(x + 11) × 22 + (z + 11)`.
* Per cell: a cost, a surface height, and a 4-direction edge code (0 open, 1 hop, 2 wall). Per lot: a **region** id
  from a flood fill over open **and hop** edges (only wall edges and blocked cells separate regions), and `mainRegion`
  = the region of the lane cell (−11, −1). Hops are a cost (+`HOP_COST`), never a barrier, so a fenced garden or a
  hedge round the whole lot is home ground.

| Cell content (level 0) | Cost / effect | Surface y |
|---|---|---|
| grass | 1.0 (ring cells 1.5) | 0 |
| `path` | 0.55 (**villagers prefer your paths**) | 0.025 |
| `deck` | 0.8 | 0.25 |
| `steps` | 0.8 | 0.125 |
| any floor cell (foundation, floor or ground floor, §3.1) of a **covered room** | blocked (indoors is never walked) | — |
| a cell of a **veranda** or of an uncovered room (a patio, an unfinished house, a walled yard) | as its F content (`foundation` 1.0, grass 1.0, `deck` 0.8) | `foundation` / `deck` 0.25, grass 0 |
| a roof panel in the column with `hs ≤ 1` | blocked | — |
| solid items: every `TREE`, `pond`, `well`, `boulders`, `bush`, `fire_pit`, `birdbath`, `scarecrow`, `beehive`, `doghouse`, `woodpile`, `hay_bale`, `veggie_bed`, `pumpkins`, `picnic_table`, `bench`, `chimney`, `crate_stack`, `barrel`, `wheelbarrow`, `stairs`, `stairs_spiral`, `ladder`; **central-pole items** `lamp_post`, `mailbox`, `birdhouse`; all other `interior` furniture standing outdoors except the soft ones; gifts with `walk: 'solid'` (which include `gift_festoon` and `gift_signpost`, both poles) | blocked (seats are used from the neighbour cell, then a 0.5 m slide into the seat) | — |
| soft items: `BLOOM` 6, `plant_pot` / `chair` 2, `rocking_chair` / `armchair` 3, `chickens` / `cat` / `dog_bed` 1.5, `clothesline` 1.2, gifts with `walk: 'soft'` 2.5 | added to the base cost | as base |
| a cell 4-adjacent to a level-0 `BLOOM` (once per cell) | + `COST_NEAR_BLOOM` 0.3, so walkers keep a row off flower beds instead of wading through the blooms (a path beside flowers, 0.85, still beats grass) | as base |
| a camp tent | blocked | — |
| D-layer rugs | nothing | — |

**Edges at level 0:**
* `WALLISH` → **wall**;
* `FENCE`, `wall_half` and `railing` → **hop** (+`HOP_COST` 25: the actor hops over with a 0.5 s arc and an "oop!"
  `hop` sfx);
* `DOORWAY` and empty → open;
* **gates**: a `FENCE` edge counts as **open** when the cells on both sides are `PATHY` (the lane cell counts as `PATHY`),
  or when either cell is a doorstep or 4-adjacent to one. So everyday trips along a garden path or out of a fenced
  front door never hop.

**Posts** (`P|x|0|z`) and the ends of wall edges block corner cutting: the string-pulling line-of-sight test (sampled
every 0.25 m) fails within 0.35 m of such a vertex.

### 6.2 Paths

* A* on the 4-connected grid with a binary heap on typed arrays. Ties break deterministically on f, then h, then cell
  index.
* Then string-pull into straight runs, and add a ± 0.3 m seeded lateral lane offset on runs longer than 3 cells so two
  walkers don't share a single file.
* Output: `Float32Array` of x, y, z points (y = surface height); `hops` = segment indices crossing a hop edge; `slips`
  = segment indices crossing a wall or blocked cell.
* At most `PATHS_PER_FRAME` (4) plans per frame (queued). Target ≤ 0.1 ms per plan on a phone.

### 6.3 Never stuck, never trapped

* **Every path query succeeds.** Blocked things have fallback costs, not ∞:
  * hop edge +`HOP_COST` (25);
  * wall edge or blocked cell +200: the actor **slips through**, dither-fading out on one side and in on the other
    with a puff, over 0.5 s.

  Ordinary routes avoid both: a gate or a gap is used when one exists, and a slip only happens to a villager whose
  cell was built over.
* **After every recompute**, each outdoor villager's logical cell is checked:
  * now blocked (a pond dropped on them) → **hop** (0.35 s arc + puff) to `nearestFree` within 2 cells;
  * blocked further out, or outside `mainRegion` (walled in on every side) → **slip** to the nearest `mainRegion`
    cell.
* A spot outside `mainRegion` (inside a walled-off pocket) is replaced by the nearest reachable spot of the same kind.
  A fenced garden's bench is in `mainRegion` and is used.
* **Invariant** (tested, §13): after every tick that follows a recompute, every outdoor, non-walking, non-lane,
  non-camp villager stands on a free cell of `mainRegion`, and every doorstep is in `mainRegion` unless full-height
  walls shut it in (fences, hedges, half walls and railings never do), so homes are **reachable without slips**.
  `town.debug.stuck()` returns `[]`, and `stats().slips` counts slips on ordinary routes (0 on every regress lot).

### 6.4 Doors, indoors, upstairs

* **Entering**: walk to the doorstep (cell centre, 0.6 m from the door edge), face the door, move 0.4 m into it while
  dither-fading (0.4 s), then switch to the `inside` plan.
* **Exiting** is the reverse.
* A doorstep with no free cell (a tree planted in front of the door) → enter from the nearest reachable cell beside
  the foot ("round the back").
* Homes whose lowest level is > 0 → the same at the ground cell under the doorstep, with a vertical fade ("climbs
  in").
* Doors are never animated, so batched pieces stay untouched.

### 6.5 Crowding

* Seats and spots are reserved (one villager each).
* Cosmetic separation steering in actors (radius 0.55 m, lateral offset ≤ 0.3 m, never changes the logical position).
* Head-on in a one-cell gap: the lower-priority walker (Shy first, else the higher id) waits 0.6 s with a little bow.
* A second villager heading for the same doorstep waits a step back.
* (Not built in Phase 1: the two waits above. Walks are timed plans the sim chains deterministically, so a wait has to
  be planned by the sim, not improvised by actors; the cosmetic lateral steering keeps passing walkers apart. Left
  for the playtest to show whether head-on meetings read badly.)

---

## 7. Wishes

### 7.1 Lifecycle (town clock)

* 0 or 1 open wish per **resident**. `waiting` villagers hold none (the fix-up is their wish) and campers share the
  town-level camp wish (§3.6). At most **`MAX_OPEN_WISHES` = 3** open in the town (dreams included, the camp wish not).
  At most one new wish every **`WISH_TOWN_SPACING` = 40 s** town-wide.
* **First wish** 30 s after the first villager steps out (60 s for later villagers). **Next wish** a seeded 150–300 s
  after the previous one ends (granted or faded), or `REWISH_AFTER_MOVE` (60 s) after a binding change commits.
* **Dreams**: a wish created while its villager sleeps is a dream. It works the same way at half rate (the gap is
  doubled) and shows as a lavender 💭 bubble above the home's roof (*"Mabel dreams: an apple tree"*). Dreams keep a
  pinned night interesting.
* **Paused**: no new wishes while guided (§4.1; existing bubbles dim to 40 %). Nothing ages while villagers are off,
  the page is hidden or the town is not yet `ready`.
* **Lifetime** `WISH_LIFE`: 900 s (S and M), 1500 s (L). Then it fades: the bubble shrinks with a 🙂, the card line
  becomes *"Never mind, maybe another time!"*, and nothing else happens. **No countdown is ever shown.** The template
  is on a 1200 s cooldown for that villager.
* **Binding change**: when a villager's home changes (moving day, waiting, camping, back home), their open wish is
  dropped silently: no fade line, no cooldown, not counted (§3.5).
* **Granted** on the first recompute after the rule becomes true (≤ 0.3 s after the placing tap). **Undo never takes
  a granted wish or its reward back**, and the wish is consumed, so it can't be farmed.

### 7.2 Template shape

Each template is a data row in `wishes.js`:

```
{ id, icon, text, label, size: 'S'|'M'|'L', job?: JobId, where, band: [min, max], layer,
  parts: [{ piece, alt?: [], n?: number | (ctx, v, wish) => number, where?, band?, near?: partIndex }],
  offer(ctx, v) → bool, done(ctx, v, wish) → bool, have(ctx, v, wish) → number[] (per part),
  base?(ctx, v) → number, freeze?(ctx, v) → object }
```

* `where` ∈ `door | door1 | foot | inside | route | pond | hive | work | seat | friend | lot | edges | boundary`, the
  default anchor of every part; a part may override `where` / `band`, or anchor on an earlier part with `near` (the
  chairs of `w_supper_table` stand within 1 of its table: the placed one if it exists, else the planned one).
* `parts` are the pieces Show me hands over, in order, with how many are needed (`n` may depend on what's already
  there: `w_door_flowers` needs `2 − blooms by the door`). `alt` lists pieces that count as well. The bubble icon is the
  first part's `def.icon`.
* `have` says how many of each part are already satisfied (the checklist, §7.6).
* `layer` ∈ `I | D | F | W`; `base` records a count at creation for "increased by" rules; `freeze` stores data in the
  wish at creation (`w_route_lamp` freezes its ROUTE cells).
* `label` is the request in the third person with no pronouns, for aria labels and cards (*"a bench by the door"*,
  *"a path over to {friend}'s door"*). Every rule only reads the world; any placement that satisfies `done` grants the
  wish, not only the suggested one.

### 7.3 Catalogue (43 templates: 32 general + 11 job; plus the town-level camp wish of §3.6)

General (any resident):

| # | id | Bubble · request | Show me parts (checklist order) | Size | Offered only if | Completes when |
|---|---|---|---|---|---|---|
| 1 | `w_door_flowers` | 🌷 "Some flowers by my door would be lovely." | `flowers` × (2 − BLOOM by the door); any BLOOM counts | M | < 2 BLOOM within 2 of DOOR | ≥ 2 BLOOM (counting the cart as 2) with d(·, DOOR) ≤ 2 |
| 2 | `w_door_bench` | 🪑 "A bench by my door, for morning tea." | `bench` (alt `rocking_chair`, `gift_tea_table`), facing away from the wall | S | none of `bench` / `rocking_chair` / `gift_tea_table` within 2 of DOOR | one of them with d ≤ 2 of DOOR |
| 3 | `w_door_lamp` | 🏮 "A lamp by my door for coming home late." | `lamp_post` | S | no LAMP within 2 of DOOR | a LAMP with d ≤ 2 of DOOR |
| 4 | `w_route_lamp` | 🏮 "A lamp along my way home." | `lamp_post` on a cell beside the frozen route | S | ROUTE ≥ 5 cells and no LAMP within 1 of ROUTE; the ROUTE cells are frozen into the wish | a LAMP with d(·, frozen ROUTE) ≤ 1 and d(·, DOOR) ≥ 3 |
| 5 | `w_door_path` | 🪨 "A proper path up to my door." | `path` × (3 − chain), a chain out from DOOR1 | M | the PATHY chain at DOOR1 has < 3 cells | a 4-connected chain of ≥ 3 PATHY cells (level 0) containing a DOOR cell |
| 6 | `w_path_friend` | 🪨 "A path over to {friend}'s door." | `path` × the missing cells of the chain to the friend's door | L | ≥ 2 homes; friend = the nearest other home with DOOR1 ≤ 12 cells away; not yet connected | a 4-connected PATHY chain joins a cell within 1 of DOOR1(v) to a cell within 1 of DOOR1(friend) |
| 7 | `w_mailbox` | 📬 "A mailbox of my own!" | `mailbox` | S | no mailbox within 2 of DOOR | a `mailbox` with d ≤ 2 of DOOR and not nearer another home's DOOR |
| 8 | `w_shade_tree` | 🌳 "A shady tree near the house." | `tree_oak` (any TREE) | S | no TREE within 3 of FOOT | a TREE with 1 ≤ d(·, FOOT) ≤ 3 |
| 9 | `w_apple_tree` | 🍎 "An apple tree. Imagine the pies!" | `tree_apple` | S | no `tree_apple` within 5 of FOOT | a `tree_apple` with d ≤ 5 of FOOT |
| 10 | `w_birds` | 🐦 "Something for the birds to visit." | `birdhouse` (alt `birdbath`) | S | no `birdhouse` / `birdbath` within 3 of FOOT | one with d ≤ 3 of FOOT |
| 11 | `w_window_boxes` | 🌷 "Window boxes full of flowers!" | `wall_window_shutters`, swapped into a wall or window of the home | S | the home's lowest-level boundary has a `wall` or a non-shutter window | count of `wall_window_shutters` on the home's boundary edges ≥ base + 1 |
| 12 | `w_reading_nook` | 📚 "A cosy reading nook." | `armchair` (only if the home has no SEAT_IN) · `bookshelf` (alt `floor_lamp`) within 1 of the seat | M | not already true | INSIDE, same level: a SEAT_IN with `bookshelf` or `floor_lamp` within d ≤ 1 |
| 13 | `w_hearth` | 🔥 "A warm fire for chilly evenings." | `fireplace` (alt `wood_stove`) | S | no `fireplace` / `wood_stove` INSIDE | one INSIDE |
| 14 | `w_kitchen` | 🍲 "A proper kitchen." | `kitchen_range` · `kitchen_counter` (alt `kitchen`) within 1 of it (each only if missing) | M | not already true | INSIDE, same level: `kitchen_range` within d ≤ 1 of `kitchen` or `kitchen_counter` |
| 15 | `w_supper_table` | 🍽️ "A table for supper with friends." | `table` · `chair` × 2 within 1 of it | M | not already true | INSIDE: a `table` with ≥ 2 `chair` within d ≤ 1 on its level |
| 16 | `w_soft_rug` | 🟥 "Something soft underfoot." | `rug` (alt `rug_round`) | S | no `rug` / `rug_round` INSIDE | one INSIDE |
| 17 | `w_pet` | 🐈 "A little friend to come home to." | `cat` (alt `dog_bed`; `doghouse` outside) | S | no `cat` / `dog_bed` INSIDE and no `doghouse` within 3 of FOOT | any of those |
| 18 | `w_bath` | 🛁 "A hot bath after a long day." | `bathtub` (alt `washstand`) | S | no `bathtub` / `washstand` INSIDE | one INSIDE |
| 19 | `w_porch` | 🟧 "A porch to sit out on." | `deck` × 2, out from a DOOR cell | M | not already true | ≥ 2 four-connected `deck` cells (level 0), one of them a DOOR cell |
| 20 | `w_garden_fence` | 🏡 "A fence round my garden." | `fence_picket` × (4 − have) (any FENCE) | M | < 2 FENCE edges qualify now | ≥ 4 FENCE edges at level 0, not on FOOT's boundary, with min(d(side A), d(side B)) ≤ 3 of FOOT |
| 21 | `w_pond` | 🦆 "A little pond to hear the frogs." | `pond` | S | no `pond` within 6 of FOOT | a `pond` with d ≤ 4 of FOOT |
| 22 | `w_water_bench` | 🦆 "A bench by the water." | `bench` (alt `boulders`), facing the pond | S | a `pond` within 8 of FOOT with no `bench` / `boulders` within 1 of it | a `bench` or `boulders` with d ≤ 1 of a pond within 8 of FOOT |
| 23 | `w_fire_circle` | 🔥 "Somewhere to gather in the evening." | `fire_pit` · `bench` × 2 within 2 of it (any SEAT_OUT counts) | M | not already true | a `fire_pit` with d ≤ 8 of FOOT and ≥ 2 SEAT_OUT within d ≤ 2 of it |
| 24 | `w_picnic_shade` | 🧺 "A picnic table under a tree." | `picnic_table` · `tree_oak` (any TREE) within 1 of it; just the table when a tree already has room beside it | M | not already true | a `picnic_table` with d ≤ 6 of FOOT and a TREE within d ≤ 1 of it |
| 25 | `w_lamp_seat` | 🏮 "A lamp by the bench so we can chat after dark." | `lamp_post` within 1 of the seat | S | a `bench` / `picnic_table` / `fire_pit` / `gift_tea_table` within 8 of FOOT has no LAMP within 1 | a LAMP with d ≤ 1 of such a seat within 8 of FOOT |
| 26 | `w_well` | 🪣 "A wishing well for everyone." | `well` | S | the lot has no `well` | a `well` with d ≤ 8 of FOOT |
| 27 | `w_washing_line` | 👕 "A washing line in the sunshine." | `clothesline` | S | none within 4 of FOOT | a `clothesline` with d ≤ 4 of FOOT |
| 28 | `w_veg_patch` | 🥕 "A little vegetable patch." | `veggie_bed` (alt `pumpkins`) | S | no `veggie_bed` / `pumpkins` within 4 of FOOT | one with d ≤ 4 of FOOT |
| 29 | `w_chickens` | 🐔 "Chickens! Fresh eggs every morning." | `chickens` | S | none within 5 of FOOT | `chickens` with d ≤ 5 of FOOT |
| 30 | `w_hive` | 🐝 "A beehive near the flowers." | `beehive` | S | no `beehive` within 4 of FOOT | a `beehive` with d ≤ 4 of FOOT |
| 31 | `w_bloom_riot` | 🌸 "A riot of flowers!" | `flowers` · `lavender` · `sunflowers` (one each; any three BLOOM or `bush` count) | M | always (Flower lover only) | within d ≤ 3 of FOOT: count(BLOOM ∪ `bush`) ≥ base + 3 |
| 32 | `w_neighbour` | 🏡 "A neighbour! It's a bit quiet." | `foundation` on a free 6 × 6 area (card adds *"or try a blueprint"*) | L | population < 20, nobody camping, no free bed anywhere, no traveller due | a Home with a free bed exists |

Job wishes (only that job; job affinity ×3):

| # | id | Job | Bubble · request | Show me parts | Size | Completes when |
|---|---|---|---|---|---|---|
| J1 | `J_garden` | gardener | 🌷 "More flowers to tend, please!" | `flowers` × 2 (any BLOOM) | M | BLOOM within 4 of FOOT ≥ base + 2 |
| J2 | `J_farm_crow` | farmer | 🧑‍🌾 "A scarecrow to mind the veggies." | `scarecrow` | S | a `scarecrow` within 2 of a `veggie_bed` / `pumpkins` within 5 of FOOT (offered if such a bed exists and none has one) |
| J3 | `J_farm_more` | farmer | 🥕 "Another vegetable bed. The beans are spreading!" | `veggie_bed` (alt `pumpkins`) | S | `veggie_bed` + `pumpkins` within 5 of FOOT ≥ base + 1 |
| J4 | `J_wood_sapling` | woodcutter | 🌲 "Plant a tree for every log I split." | `tree_pine` (any TREE) | S | TREE within 6 of FOOT ≥ base + 1 |
| J5 | `J_wood_pile` | woodcutter | 🪵 "Another woodpile for winter." | `woodpile` × (2 − have) (1 when it is the odd-job wish) | S | ≥ 2 `woodpile` within 3 of FOOT (≥ 1 when it is the odd-job wish) |
| J6 | `J_fish_perch` | fisher | 🪨 "Boulders to perch on by the pond." | `boulders` beside the WORK pond, facing it | S | `boulders` within 1 of the WORK pond |
| J7 | `J_fish_dock` | fisher | 🟧 "A little dock to fish from." | `deck` × 2 beside the WORK pond | M | ≥ 2 `deck` cells (level 0) within d ≤ 1 of the WORK pond |
| J8 | `J_bee_blooms` | beekeeper | 💜 "More flowers for my bees!" | `lavender` × 2 (any BLOOM) | M | BLOOM within 2 of the WORK hive ≥ base + 2 |
| J9 | `J_bake_table` | baker | 🧺 "A table to set out my bread." | `picnic_table` | S | a `picnic_table` with d ≤ 3 of DOOR (offered if none) |
| J10 | `J_lamp_more` | lamplighter | 🏮 "Another lamp for my evening round." | `lamp_post` | S | LAMP count on the lot ≥ base + 1 |
| J11 | `J_post_paths` | postie | 🪨 "Paths between the houses, for my round." | `path` × the missing cells of the chains between DOOR1s | L | every Home's DOOR1 is joined to every other by PATHY chains (offered with ≥ 2 homes not all joined) |

**Size and reward:** S → Warmth +6, M → +8, L → +12, each tapered near the top (§9.1).

**Favoured by:**
* Jobs: Gardener `w_door_flowers`, `w_window_boxes`; Farmer `w_garden_fence`, `w_veg_patch`, `w_chickens`, `w_bath`;
  Woodcutter `w_shade_tree`, `w_bath`; Fisher `w_water_bench`, `w_pond`; Beekeeper `w_hive`; Baker `w_kitchen`,
  `w_apple_tree`, `J_bake_table`, `w_hive`; Lamplighter `w_door_lamp`, `w_lamp_seat`; Postie `w_mailbox`,
  `w_door_path`, `w_path_friend`.
* Traits: as in §2.4.

### 7.4 Choosing a wish (deterministic)

* A template is **eligible** for villager v when:
  * it is currently false and its `offer` holds;
  * its job gate passes;
  * it is not on cooldown and not among v's last 3 wishes;
  * it is **possible here**: the spot finder (§7.5) returns a complete plan (every missing part has enough spots).
* `weight = base (S 1.0, M 0.8, L 0.5) × job affinity (×3 job-only, ×2 favoured, ×4 odd-job wish) × trait (×2/×3) ×
  lotFit (min(1, spots of the first part / 3)) × 0.5 if another villager holds the same template`.
* Sample with v's seeded RNG at that tick.
* **A villager's first wish is small** (M2 feel check, the §1.4 "3 taps"): while v has no grants and no past wishes (and
  is not the first friend, whose odd-job wish wins), only one-piece S templates whose part is outdoors and whose planned
  spot is within `FIRST_WISH_NEAR` (4) cells of a doorstep are sampled, when there are any.
* Phase 3 hook: `× season(template)`, which is 1 in Phase 1.

### 7.5 Spot finder (shared by feasibility and Show me): plans

`findSpots(tpl, ctx, wish?)` returns a **plan**: `{ parts: [{ piece, n, have }], recs: [{ part, rec, x, y, z, r,
cell, edge? }], complete }`. For each part in order it adds `n − have` recs; a `near` part is anchored on the earlier
part's existing piece when there is one, else on its first planned rec. The recs list is ordered part by part, so
placing them in order always completes the wish.

* **Cell pieces** (`I`, `D`, `F`): candidate cells in the band around the anchor, ordered by distance to the anchor,
  then cell index. Outdoor candidates are on level 0; INSIDE candidates are home cells on any level. A candidate must:
  * have its slot free (`world.get(world.keyOf(rec))` undefined), and not be planned for an earlier rec;
  * pass `world.validate(rec).ok`;
  * not be a doorstep (solid pieces);
  * not be a floor cell of a covered room (outdoor pieces);
  * (ordering, R1 T1.9) a solid piece that is not itself a path takes `path` / `steps` cells only after every other
    candidate of the band (a stable re-sort), so a mailbox goes beside the front path, not on it; decks stay fine for
    seats;
  * not cut any doorstep off from `mainRegion` (regions over walk + hop edges, §6.1): block the cell on a copy of the
    region map and re-flood; checked for the first 3 candidates only.
* **Rotation**: a seat near a DOOR faces away from the nearest wall edge, toward open space (never at the house wall);
  a seat by a pond faces the pond; a seat at a fire pit or table faces it; other pieces face DOOR1. Seats anchored on a
  fire pit or table (`face: 'anchor'`, e.g. `w_fire_circle`'s benches) take the anchor's straight-on neighbour cells
  first, on different sides (behind it, facing the default camera, then its sides, then in front), before any diagonal
  cell, so they read as a circle round it (M2 feel check).
* **Frozen route** (`w_route_lamp`): candidates are cells at d = 1 from the frozen ROUTE cells (never on them) with
  d(·, DOOR) ≥ 3, so A* re-routing round the new lamp can't undo the wish.
* **Edge pieces**:
  * `w_window_boxes`: the home's lowest-level boundary edges holding `wall` or a non-shutter window, the one facing
    DOOR1 first;
  * `w_garden_fence`: free edges on the ring at distance 2–3 around FOOT, up to 4 (the next 4 in a line).
* **Chains** (`w_door_path`, `w_path_friend`, `J_post_paths`, `w_porch`, `J_fish_dock`): the free cells along the nav
  route outward from DOOR1 (toward the friend's door, else the lane mouth), in route order, up to 24.
* **Hint plans** (`hintSpots`, §3.7) have the same shape, with one part.
* Returns at most 24 recs. **Any** placement that satisfies the rule grants the wish, not only the suggested one.

### 7.6 Show me (index.js orchestrates, §12.7)

1. **View first**, so the builder's own floor logic finds nothing to change and sends no toasts:
   `state.set({ level: rec.level, seeAll: inside ? false : state.seeAll })` (a SpotPlan rec's `y` is world metres, its
   `level` the piece level; outdoor spots are level 0; roof hints set
   `seeAll: true`).
2. **Piece**: `builder.selectPiece(part.piece)`; for four-way pieces `state.set({ rot: rec.r })`; hint plans also set
   `mats` / `colors` / `accent` from the ghost record (§3.7). In guided mode (§4.1) Show me only frames the spot: no
   piece change and no highlight, so guided taps keep snapping to the guides.
3. **Camera**: turn to face the spot as `blueprints.selectNext` does (angle from the home's centre; if |Δθ| > 1.2 rad,
   `rig.goal.theta += Δθ`), look down into a cutaway for INSIDE spots (`rig.goal.phi = min(rig.goal.phi, 0.9)`), then
   `rig.focus(spot.x, spot.y + 0.5, spot.z, clamp(current radius, 14, 26))`. **Unhidden** (R1 T1.3): an INSIDE spot more
   than 1.5 m from the home's middle is seen from the *far* side (the angle points from the spot toward the middle, so
   the wall nearest the spot is not between the camera and it); then occlusion rays (`world.pick` with a
   `THREE.Raycaster` from each candidate camera position, honouring the cutaway) go to the ghost's middle and four
   points of its ring, over the angles (the current one when within 1.2 rad of the preferred one, the preferred one,
   ± 90°, 180°) × phi (the usual one, then 0.6, then 0.38): the first view that sees all five points wins, else the one
   that sees most (ties keep that order); the search stops after 60 ms on a slow phone.
4. **Highlight**: `actors.highlight({ cells, edges, ghost })`: a pulsing golden ring on every rec of the current part
   (the later parts' cells faint) and a glowing ghost of the first missing rec (`world.buildPlaced(rec)` with
   `materials.blueprintMat(true)`, the guided-build look, baked into one mesh so any piece costs one draw call, R2
   T2.4). Every plan rec carries a rotation `r` (index.js's `fullRec` defaults a missing one to 0): a rec without one
   built a ghost with a NaN matrix, never drawn, whose NaN hit box claimed every tap on the meadow (R2 T2.1).
5. Event `town-showme` → the hud shows the hint toast (*"🌷 Tap a glowing spot to plant a Flower Patch for Mabel"*)
   and, for a plan of more than one piece, a **checklist chip** with no timer: *"🍽️ Table ✓ · Chairs 1/2"*, with ✕.
6. **Re-target**: after every recompute while it is up, the plan is recomputed. When a part completes, the piece in
   hand is swapped to the next missing part (only if the player still holds the piece Show me handed them), the rings
   and ghost move, and the checklist updates (`town-showme` with `update: true`).
7. **Taps on the highlight build exactly there** (§12.7).
8. **Lifetime**: no timer. The highlight stays until the wish is granted (or the hint resolved), the wish fades or is
   dropped, the player picks another piece or tool themselves (a `pieceId` / `tool` change the town didn't make), the
   checklist's ✕ or Esc, villagers off, photo mode, or a guide starting. A hint is **resolved** (R1 T1.2; checked at
   every re-target, then `town-showme-end` with `granted: true`), because the spot finder always finds another free
   cell or wall and so the plan alone never runs out: the town card's "one more bed" row (a Home) once the home has
   more beds than when Show me started; an almost / fix-up hint once that kind is no longer in the building's
   `missing`, or it became a Home; the camp wish once nobody camps or the Homes' total capacity rose by the number of
   campers at the start.

Edge wishes glow the edge; `w_neighbour` and the camp wish frame a free 6 × 6 area with a Stone Foundation in hand.

### 7.7 The granting moment

1. If the villager is awake, outdoors and within 20 m, they drop what they're doing, walk (×1.3) to beside the spot,
   hop, send up hearts and `admire` 3 s. Otherwise hearts rise above their roof, and next time they pass within 6 cells
   they stop and admire it.
2. The bubble turns into a 💛 that floats up. `wish-granted` sfx.
3. Toast *"💛 Mabel: "{granted line}" · Cozy +{n}"* (n = the Warmth actually gained, §9.1); the `+n` floats from the
   hearth.
4. Warmth rises; the hearth flares for 1.2 s and settles brighter.
5. A gift, if this grant is on the schedule (§8.1): the gift card slides up 1.5 s later.
6. Afterwards they **use** it within `GRANT_USE` (2 min), whatever the phase (§5.3): Mabel takes her tea on the bench
   she asked for, even at the pinned morning hour.

---

## 8. Rewards and thank-you gifts

### 8.1 What a granted wish gives

* **Warmth**: S +6, M +8, L +12 (§9).
* **A gift on schedule**: when the town's granted count reaches one of `GIFT_AT` = 2, 4, 7, 10, 14, 18, 23, 28, 34, 40,
  one gift unlocks. It is chosen in this order:
  1. the granter's job gift, if locked;
  2. else the first locked job gift (in `JOB_ORDER`) for a job present in town;
  3. else `gift_gnome`, then `gift_tea_table`;
  4. else any locked gift.

  If none is left, nothing happens. Deterministic, so the first gift always comes with the 2nd granted wish. Only
  villagers' own wishes count toward `GIFT_AT`; the camp's thank-you (§3.6) doesn't.
* Phase 2 hook: the reward is an object `{ cozy, gift, resources? }`. Phase 1 fills `cozy` and `gift`.

### 8.2 The ten gift pieces (`js/pieces/gifts.js`)

All gifts are `cat: 'garden'`, `slot: 'cell'`, `layer: 'I'`, with `hidden: true` and `gift: { job }` (job id, or
`null` for the universal two). Their ids, names, job, BLOOM / FARM / LAMP counts, seat anchors and `walk` come from
`js/town/data.js` `GIFTS` (§12.4), which gifts.js imports (data.js is pure and has no imports), so there is one source
of truth; gifts.js builds the geometry round those seat anchors. Each one:
* has ≤ 1.5k triangles;
* uses only existing `mat()` ids, and for every fixed (non-paintable) colour a (material, colour) pair some piece
  module already uses, so it adds no material and no batch render unit: ceramic in decor.js's own colours
  (`COL.terracotta` `#c0643f` for pots and the bread oven's clay, `COL.cream`, `COL.wax`, `COL.paper`, `COL.apple`,
  `COL.teal`), `fabric` in decor.js's fabric colours (`COL.mustard` `#e9c46a` for the honey-jar lids and labels on
  `COL.wax` jars); paintable defaults are `PALETTE` colours. L7 checks that building all ten adds no material;
* builds deterministically;
* has `sound`, `icon`, `desc` and `walk: 'solid' | 'soft'` (nav);
* uses the same standing-surface rule as decor.js: `contextual: true`, `contextKey` = the surface code, `SURF_Y`. Copy
  the ~10-line `surface()` rule from decor.js, which exports nothing, so gifts stand on grass, path, deck, upstairs
  floors and flat roofs.

| id | Name | From | Look | Materials | Levels | Also… |
|---|---|---|---|---|---|---|
| `gift_flower_cart` | Flower Cart | Gardener | little wooden handcart on two spoked wheels, heaped with terracotta pots of pink, yellow and white blooms | `wood`, `timber`, `ceramic` (`COL.terracotta`), `petalPink`, `petalYellow`, `petalWhite`, `leaves` | 0–4 | counts as **2 BLOOM**; solid |
| `gift_hen_house` | Hen House | Farmer | small A-frame coop on four stubby legs, a ramp with cleats, a nesting box, straw poking out | `paintedWood` (default `#b4473a`, paintable), `roofShingle`, `wood`, `hay` | 0 | counts as **FARM**; solid |
| `gift_carved_bear` | Carved Bear | Woodcutter | chunky bear carved from a log, one paw waving, sitting on a stump with rings on top | `wood`, `bark` | 0–4 | Animal lovers stop to admire it; solid |
| `gift_rowboat` | Little Rowboat | Fisher | duck-egg rowboat (white inside) resting on the grass, crossed oars, a coil of rope | `paintedWood` (default `#7fa7a3`, the PALETTE duck egg the blueprint doors use, paintable; `#8fb8c9` would have added a material), `wood`, `fabric` | 0 | **1 seat**; the Fisher's favourite perch beside a pond; solid |
| `gift_honey_stand` | Honey Stand | Beekeeper | slatted crate stand with a gingham cloth, rows of honey jars with mustard cloth lids and labels, and a little painted sign | `wood`, `fabric` (`COL.mustard`, `COL.red`), `ceramic` (`COL.wax`), `paintedWood` | 0–4 | the Beekeeper's afternoon spot; solid |
| `gift_bread_oven` | Bread Oven | Baker | domed clay oven on a stone plinth, arched mouth glowing at night, a bread peel leaning | `ceramic` (`COL.terracotta`), `stoneBlock`, `ember`, `wood`; `emitter: 'smoke'`, `emitterOffset: [0, 1.3, -0.2]` | 0 | the Baker bakes **outdoors** here (visible); solid |
| `gift_festoon` | Festoon Lights | Lamplighter | two slim posts 1.7 m apart with a sagging string of seven warm bulbs | `timber`, `iron`, `lampGlow` | 0–4 | counts as a **LAMP** (bulbs glow with `setNight`); solid (its posts are poles, §6.1) |
| `gift_signpost` | Signpost | Postie | timber fingerpost with three painted arrow boards (cream, sage, barn red) and a tiny roof cap | `timber`, `paintedWood` | 0–4 | where the post round starts; solid (a pole) |
| `gift_gnome` | Garden Gnome | anyone | 40 cm gnome: red pointy hat, white beard, blue coat, holding a tiny lantern | `fabric` (hat, `paintAlways`), `ceramic`, `lampGlow` | 0–4 | Animal lovers crouch to say hello; soft |
| `gift_tea_table` | Tea Table | anyone | small round table with a lace cloth, a teapot, two cups and a cake stand, two little stools | `wood`, `fabric`, `ceramic` | 0–4 | **2 seats**; a favourite hangout (+0.5 hangout score); solid |

### 8.3 Unlocks in the build tray

* **Writing an unlock**: index.js first writes the id to the tiny device key `hearthwood.unlocks.v1` (a JSON array of
  gift ids), then saves the town (`hearthwood.town.v1`.unlocks), then calls `catalog.setHidden(id, false)` and emits
  `town-gift`; ui.js re-renders the cards.
* **Reading unlocks never depends on the town**: gifts.js, which main.js loads with the other piece modules whatever
  the village setting, reads both keys in try/catch when it registers the pieces (even reading `localStorage` itself
  is inside the try: with site data blocked the getter throws a SecurityError, and the gifts must still register,
  hidden; R1 T1.11) and registers every gift found in
  either with `hidden: false`. So an unlocked gift stays in the tray if the town module fails to import, with `town=0`,
  in a showcase, with villagers off, or when the town key can't be written (localStorage is shared with up to 2 MB of
  slot thumbnails). index.js only un-hides gifts unlocked during the session.
* A **🎁 New** corner ribbon stays on the card until the piece is first placed. The town listens to `placed` and adds
  the id to `seen`.
* The Garden tab shows a dot until the card has been seen.
* The ⓘ card says *"A thank-you from Mabel the Gardener"* (`town.giftInfo(id)`).
* Gift card toast: *"🎁 Mabel left you a Flower Cart. Find it in 🌷 Garden [Place it]"*.
* **Never taken away**: unlocks are permanent and device-wide (§12.9), survive villagers being switched off, and
  never re-lock.
* `world.validate` never looks at `hidden`, so saves, share codes and Pick always work with gift pieces: a friend's
  gnome loads, renders and can be copied with Pick. Only the tray card waits for the local unlock.
* `?showcase=all` (it uses `allDefs`) shows the gifts; `?showcase=garden` shows them once unlocked (or with
  `unlock=all`). With 106 pieces the contact sheet's last row sits just past the lot's front edge (z = 11);
  ARCHITECTURE.md says so (§12.6), and nothing else changes.
* An older game version opening a code with gift pieces skips the unknown ids and reports them in `dropped`.

---

## 9. Cozy

### 9.1 Formula

```
warmth  ∈ [0, WARMTH_MAX = 60]   persistent stock.
          Fresh town: WARMTH_START = 10.
          A reward r (move-in 4 per villager, first time only · wish S 6 / M 8 / L 12 · fixed-up home 3 · camp thank-you 12)
          adds  gain = max(1, round(r × (1 − warmth / WARMTH_MAX)))   (tapers near the top; the toast shows this gain).
          Drift: −max(1, warmth / 20) per COZY_DRIFT_EVERY = 120 s of town clock, never below 0
                 (≈ −5 per town day near the bottom, ≈ −15 near the top).
          Never while hidden, off, before `ready` or while guided.
charm   ∈ [0, CHARM_MAX = 40) = CHARM_MAX × (1 − e^(−S / CHARM_SCALE)),  CHARM_SCALE = 30,
          S = Σ over Homes with ≥ 1 resident of kinds_h.
          kinds_h = distinct DECOR_OUT ids within d ≤ 3 of FOOT (any level, outdoors)
                  + distinct COZY_IN ids INSIDE.
          Every gift counts as 2 kinds.
          DECOR_OUT = BLOOM ids, bush, TREE ids, bench, picnic_table, lamp_post, mailbox, birdhouse, birdbath, well,
                      pond, boulders, fire_pit, path, deck, rocking_chair, beehive, chickens, scarecrow, clothesline,
                      doghouse, wheelbarrow, hay_bale, woodpile, veggie_bed, pumpkins, fence_picket, fence_rail,
                      hedge, gifts.
          COZY_IN   = every 'interior'-category id except bed, plus chimney.
floor   = population > 0 ? 15 + 2 × min(population, 10) : 0          // 17..35
Cozy    = clamp(round(warmth + charm), floor, 100)
tier    = Quiet 0–24 · Content 25–49 · Cheerful 50–74 · Glowing 75–100
```

Charm has no per-home cap: every new kind of decor near any lived-in home adds a little (most when the town is
plain), a bare new home adds nothing and never lowers it, and it only approaches 40. Warmth gains shrink near the top
and drift grows there, so Cozy settles where the player's pace puts it instead of pinning at 100.

**Worked examples:**
* The stamped Cottage at move-in: warmth 10 + 3 = 13 (the move-in's 4, tapered); S = 23 (10 outdoor kinds incl. the
  hedge + 13 interior kinds incl. the chimney, counted on the real stamped cottage in M1), charm 21.4; Cozy **34**
  (Content). (The draft's S = 20 / Cozy 32 undercounted the real build; the formula is unchanged.)
* Three granted wishes (S, M, M) on it: gains +5, +6, +5 → warmth 29; with the kinds they add, Cozy **50** (Cheerful).
* A bare self-built home with only a bed: warmth 13, charm 0 → floor 17 (Quiet).
* A whole 10-minute session ignoring wishes costs about 5 points low down, about 14 near the top.
* A new bare home adds 0 charm and never lowers it.

**Expected Cozy over a session** (median of 20 seeded runs of `reviser/cozy-model2.py`, Appendix A; the playtest
checks these with `townhud=1`):

| Player | 10 min | 30 min | 60 min |
|---|---|---|---|
| Stamps a cottage at once, grants most wishes, a stamped home every ~12 min | 40 | 69 | 85 |
| Free builder: own homes with ~4 kinds each, grants half the wishes | 18 | 35 | 54 |
| Decorator: one home, ignores wishes, adds about a kind a minute | 22 | 28 | 36 |
| Power player: five stamped homes in 10 min, grants everything fast | 78 | 90 | 91 |

(With the earlier formula the first and last rows pinned at 97–99 within 30 minutes, and the decorator was stuck at
20.)

### 9.2 What Cozy does in Phase 1

| | Quiet | Content | Cheerful | Glowing |
|---|---|---|---|---|
| New-traveller delay (75 s × lerp(1.5, 0.6, Cozy/100)) | ≈ 112–96 s | ≈ 95–79 s | ≈ 78–62 s | ≈ 61–45 s |
| Walk bob / gait | ×0.9, calm | ×1.0 | ×1.15 | ×1.25 + an occasional skip |
| Humming (♪ cue + hum foley while walking), per villager | none | none | every 20–40 s | every 10–20 s |
| Wave when passing another villager | 20 % | 40 % | 60 % | 80 % |
| Evening hangout length | −20 % | — | +20 % | +40 % |
| Flavour lines | `quiet` pool eligible | — | — | `glowing` pool eligible |

(Built in M2: the gait bob ×0.9 / 1.0 / 1.15 / 1.25 and, at Glowing, a skip every 6–12 s about half the time, in
actors.js; a wave on passing another villager within 1.6 m, once per meeting, in actors.js (cosmetic, `Math.random`);
humming, a ♪ cue and the `hum` foley while walking, `HUM_CHEERFUL` / `HUM_GLOWING`, in the sim; the evening hangout
length and the line pools in the sim.)

Wishes and gifts never depend on Cozy: a quiet town is just quieter, never stuck. Phase 2 hook: `town.cozy01()`
becomes the production multiplier.

### 9.3 Display

* The hearth chip (§10.3) is driven by CSS variable `--cozy` (0..1):
  * flame scales 0.55 → 1.15;
  * glow `drop-shadow` 2 → 12 px of warm amber;
  * ember shimmer animation from 0.75.
* Every grant, move-in and fix-up makes the hearth **flare** for 1.2 s (flame +25 %, glow +6 px), whatever the level,
  so the hearth always answers, and the gain floats up from the chip (`+5`) with the existing `hw-bump`.
* The number appears only on the town card. Event `town-cozy` fires when the integer or the tier changes.

---

## 10. UI

All new DOM is built by `js/town/hud.js`, mounted by ui.js inside `.hw` (`#ui > .hw` is `pointer-events: none`; only
bubbles, cards, chips and the hearth opt in) and styled in `css/town.css` with the existing tokens (`--paper`, `--sh`,
`--sh-sm`, `--ease`, `--spring`, `--safe-*`). Every element carries `hw-hide-photo`. Every tap target is ≥ 44 px.
Strings never use pronouns (§2.4).

### 10.1 Bubbles

* 38 px cream circle with a 22 px emoji and a small tail; the hit area is 48 px (`::after`). A gentle 2.4 s bob, off
  with `prefers-reduced-motion`.
* Positioned every frame with `transform: translate3d()` only (no layout), from the anchor `town.bubbles()` gives,
  projected with the main camera:
  * **villager bubbles** (wish, traveller): head + 0.35 m, except when the villager is inside, hidden by the cutaway,
    or occluded (a `builder.pickPiece` ray at the anchor hits a piece nearer the camera; checked at 4 Hz, at most 2 rays
    a frame), when the bubble moves to their home's roof anchor;
  * **home bubbles** (dream, almost, fix-up, vacancy, sleep, nameplate): the **roof anchor**, 0.6 m above the
    building's highest roof panel or wall top over its DOOR1 side, never over the door itself, so they don't cover
    the spot where the player builds.
* Scale 1.0 at ≤ 20 m camera distance, down to 0.8 at 40 m. Hidden beyond 45 m, behind the camera, or inside
  `rig.insets`.
* At most **6** tappable bubbles shown, by priority: traveller > wish > camp > fix-up > almost > vacancy > dream,
  nearest first. Up to 3 sleep 💤 bubbles. Bubbles closer than 36 px merge into one "×2" (tapping it opens the first).
* **Wish and dream bubbles never vanish off an edge** (M2 feel check): off-screen (in front of the camera, within the
  45 m cull) they ride the free area's edge with an arrow, as a traveller's does; on screen they are kept at least
  24 px (× scale) inside its sides and 50 px below its top. The same keep-inside clamp holds for every other tappable
  bubble on screen (camp, fix-up, almost, vacancy, gift, an on-screen traveller; R1 T1.10), so none sits under the top
  bar or the hearth chip. While a toast is up, an on-screen tappable bubble whose box (38 × 46 px × scale, tail tip on
  the anchor) overlaps it sits just below the toast stack (R2 T2.2: the one-time camp tip used to cover the very camp
  bubble it was about) and goes back when the toast has gone. A 💤 that shares its roof anchor with a tappable bubble
  moves 34 px aside; the move-in nameplate drops below the toast stack when its anchor is in the toast band.
* Hidden in photo mode, while the menu sheet or a dialog is open, and with villagers off. Dimmed to 40 % while guided
  (§4.1).
* **Gestures pass through bubbles**: every bubble gets `pointer-events: none` while `rig.mode` is `aim` or `draw`. A
  pointer that goes down on a bubble and moves more than 10 px before it lifts is handed to the canvas: the hud
  dispatches a synthetic `pointerdown` (same `pointerId`, `pointerType` and button, at the start position) on
  `app.renderer.domElement`, and the bubble's click is suppressed. camera.js listens for moves and ups on `window`, so
  the drag orbits as if it had started on the meadow.
* Each has an aria-label built from the template `label`: *"Mabel's wish: a bench by the door"*.

| Kind | Look | Tap |
|---|---|---|
| wish | white, the first part's `def.icon` | villager card |
| dream | lavender, 💭 corner badge, at the roof anchor | villager card |
| traveller | 🎒; **clamps to the screen edge with an arrow** while off-screen | follow the traveller |
| passer-by | no bubble; only the **edge arrow** while off-screen | not tappable |
| camp | ⛺ with a small count, over the camp | camp card: *"A bed for the campers (n)"* + Show me (§3.6) |
| almost | grey, the missing thing's icon | hint card (§10.4) |
| fix-up | amber 🔨 | hint card |
| vacancy | soft green 🏡✨ | "Who could live here?" card |
| sleep | 24 px 💤, only within 25 m | not tappable |
| nameplate | text pill *"Mabel 🌷"* for 4 s at move-in | not tappable |
| gift | 🎁 for 4 s over the granter | gift card |

### 10.2 Villager card

Opened by tapping a villager (§12.7 hit test) or their bubble. Closed by ✕, Esc, a tap outside, or a swipe down on
touch.

```
[🌷 avatar: outfit-colour circle]  Mabel                                    ✕
                                  Gardener · 🌅 Early riser
🏡 Lives in the thatched cottage                                       [📍]
💭 "A bench by my door, for morning tea."     [🪑 Garden Bench]   [📍 Show me]
❝ Up before the sun again. The lavender smells like summer. ❞
💛 3 wishes granted                                                [👀 Follow]
```

* **Status line** variants:
  * *"⛺ Camping by the lane until there's a bed free"*;
  * *"🔨 Mabel's cottage needs fixing: a hole in the roof"* (with Show me);
  * *"🎒 On the way to the thatched cottage"* (traveller).
* **📍** frames the home (`rig.focus` on its door, radius 18).
* **Follow** keeps the camera target on the villager each frame (`rig.focus(x, y + 0.8, z)`). Orbit and zoom keep
  working round them. It ends when something else moves the target (`goal.target` differs by > 0.05 m from where
  follow put it last frame: a pan, a pinch's slide, a wheel zoom toward the cursor, a key), on a canvas tap, Esc,
  photo mode, or villagers off. When it ends, the target is clamped to `rig.bounds` (±36 m), since a traveller on the
  lane can be past it. Watching a day is the "life you can watch" pillar in one button. On a phone a pinch zooms and a
  twist turns round the followed villager (not round the point between the fingers), and a one-finger orbit keeps
  them as its pivot; only a two-finger **slide** (the finger midpoint moving 24 px more than half the pinch's own
  change) ends Follow (R1 T1.4; §12.7).
* A wish that just faded shows *"Never mind, maybe another time!"* for 60 s.
* **Layout**:
  * portrait: bottom card above the tray, max 420 px wide;
  * landscape phone: a 300 px side card on the left (the rail and tray are right and bottom);
  * desktop (fine pointer, ≥ 900 px wide): a floating card near the villager, kept inside the free area.
* Opening it plays `villager` (a babble in their voice) and sets `aria-live` text.

### 10.3 Hearth chip and town card

* **Hearth chip** `.hw-hearth`: a 36 px round button appended to `.hw-top-l` after `.hw-count`, holding an inline SVG
  stone hearth with a flame, driven by `--cozy`.
  * Shown from the first villager on; hidden with villagers off.
  * While any wish is open, a soft ember dot glows at its corner (no number: the count lives on the town card).
  * At ≤ 300 px wide the chip hides. The **🔥 Town** row in Menu (first row of `pageMain`) is there at every width
    while the town is enabled.
  * The ≤ 370 px rule that hides `.hw-count` stays as is; the chip is a separate element. The counter stays beside the
    hearth everywhere else: at 301–480 px (≤ 390 px a little more) town.css slims the top bar while the hearth shows
    (3 px gaps, 6 px side padding, a slimmer counter, floor arrows 38 / 34 px wide whose hit areas reach 44 px over
    the label, no floor stack bars), so menu, counter (four digits too), hearth, floor control and undo / redo fit in
    one row down to 371 px (R1 T1.8; it hid the counter up to 480 px before).
* Tap (or key **T**) → **town card** (popover in the same style as the piece info card):

```
🔥 Cozy 62 · Cheerful   [██████████░░░░░░]                               ✕
Warmth 38 from neighbours and wishes · Charm 24 from decor round homes
Different kinds of decor near a home count more than lots of one kind.
Residents   [🌷 Mabel] [🪓 Bram] [🐝 Posy]   ⛺ 1 camping              (chips → villager card)
💭 2 wishes open                                                      [Next ›]
Could move in
  🛏️ The thatched cottage: one more bed and Posy the Beekeeper would come     [Show me]
  🏡 The log cabin has a free bed: a 🎣 Fisher would come for a Lily Pond within 6 cells  [Show me]
Almost homes
  🏠 The little hut: a hole in the roof (1 cell)                          [Show me]
⏳ Let the day pass to see the whole day                                 [Turn on]   (only while timeFlow is off)
Day 4 of the town · 7 wishes granted
```

* `view().note` (the boot summary, §3.5) shows as a line under the residents until the card is closed once.
* With villagers off it shows only *"🧺 Villagers are resting. Turn them on in Settings."*
* At the cap: *"The meadow is full: 20 neighbours live here."*
* "Could move in" rows name every runner-up the same way: the name the next traveller of that job would have (the
  signature name, else the seeded pool name, or the saved traveller's), so a row never reads *"a gardener would
  come"* beside *"Posy the Beekeeper would come"* (M2).
* "Almost homes" lists every almost-eligible building and fix-up (a bedded building of any size included, R1 T1.1),
  and also the small bedless sheds (≥ 4 cells, not muted) that never get a bubble: that line is their only hint (§14.1
  item 2; `HomeView.listed`).
* "Could move in" (R1 T1.7): while anyone camps (or waits with no building), a full Home's row names that camper,
  since campers take free beds first (§4.2): *"The thatched cottage: one more bed and Posy could move in from the
  camp"* (`ROW_TEXT.bedCamp`). A Home that already has `BEDS_PER_HOME_MAX` beds gets no "one more bed" row (another
  bed would not raise its capacity).

### 10.4 Hint cards, checklist and the gift card

* **Hint card** (almost / fix-up / vacancy): the text from §3.7, a list of what's missing with counts, **Show me**
  (§7.6 with that hint's plan) and, on almost cards, **Just a shed 🙂** (`town.muteHint(homeId)`).
* **Checklist chip** (while a Show me with more than one piece is up, §7.6): a small pill under the toasts,
  *"🍽️ Table ✓ · Chairs 1/2"*, each part's icon and name with ✓ or have/n, and ✕ to end the highlight. No timer.
* **Gift card**: slides up 1.5 s after the grant, showing the gift's card thumbnail (`app.thumbnail(id)`), *"🎁 A
  thank-you from Mabel: Flower Cart"*, **Place it** (`builder.selectPiece`) and **Later**. It auto-closes after 8 s.
* **Intro card** (existing players, §1.3): *"🏡 New: villagers may move into your homes."* with **Lovely** and **Keep my
  meadow quiet** (`town.answerIntro(lovely)`), styled like the welcome card but smaller. Shown once (`tips.intro`).

### 10.5 Toasts

All toasts go through the existing `toast` event. New optional field: `action: { label, fn }`. ui.js renders it as a
button inside the toast, and the toast then gets `pointer-events: auto`. Status changes arrive as **one** `town-status`
event per commit (§3.5), and the hud sends **one** toast for it.

| When | Text | Kind / ms |
|---|---|---|
| traveller (first ever) | 🎒 Someone's coming up the lane to your new home… **[👀 Watch]** | info 5000 |
| traveller (later) | 🎒 Someone's coming up the lane… **[👀 Watch]** | info 4000 |
| traveller (migration) | 🎒 Word of your lovely home has spread. Someone's coming up the lane… **[👀 Watch]** | info 5000 |
| move-in | 🏡 {Name} the {Job} moved into {the home}! | success 3200 |
| granted | 💛 {Name}: "{line}" · Cozy +{gain} | success 3000 |
| gift | 🎁 {Name} left you a {Gift}. Find it in 🌷 Garden **[Place it]** | success 6000 |
| fixed up (only after the fix-up bubble showed) | 🔨 {Name}: "Thank you for fixing it up!" | success 2800 |
| status commit, one villager | 📦 {Name} is moving into {the home} · ⛺ {Name} is camping by the lane until there's a bed free · 🏡 {Name} is back home (only when the change carries `back`: a camper back in their own old bed, R1 T1.6) | info 2800 |
| status commit, several | 📦 {n} neighbours moved into the new houses · ⛺ {n} villagers are camping by the lane until there are beds (both parts when both happened, one toast) | info 3200 |
| camp thank-you | 💛 {Name}: "A real bed! Thank you!" · Cozy +{gain} | success 3000 |
| Show me hint | {icon} Tap a glowing spot to {verb} a {Piece} for {Name} (verb: plant / place / build / lay) | info 3600 |
| welcome back (`lastSeen` ≥ 30 min ago) | 🏡 {Name} and {n} neighbours are glad you're back | info 3200 |
| villagers off / on | 🧺 Villagers are resting. Everything is kept. / 👋 The villagers are back! | info 2400 |
| other tab | 🏡 Your village is open in another tab. **[Reload]** (§12.9) | warn 8000 |

The boot restore sends no toast (§3.5); the welcome back toast is the only one a reload can bring.

### 10.6 One-time tips (stored in the town save `tips`)

| id | When | Text |
|---|---|---|
| `passerby` | first passer-by appears | 🎒 A traveller passes by… build a home with a bed and someone might stay **[👀 Watch]** (follows them) |
| `hearth` | first move-in | 🔥 Your town has a hearth now. It glows brighter as the town gets cosier. |
| `wish` | first wish bubble on screen | 💭 Tap a bubble to see what someone would love |
| `flow` | 90 s after the first move-in, only if `timeFlow` is off | ⏳ Let the day pass to see {Name}'s whole day **[Let the day pass]** (sets `timeFlow: true`; 8000 ms) |
| `almost` | first almost bubble | 🏠 Almost a home! Tap the grey bubble to see what's missing |
| `vacancy` | first vacancy bubble, once it has stayed on screen 1 s (`almost` too; R1 T1.5) | 🏡✨ A free bed! Tap the green bubble to see who could live here |
| `camp` | first camper | ⛺ Villagers without a bed camp by the lane. Add a bed and they'll move right in. |
| `intro` | the intro card was answered (§1.3) | (no toast) |

### 10.7 Settings, help, keys

* **Settings → new section "Village"** (after "Sound & look"), using the existing `toggle()` rows:
  * 🧺 **Villagers & wishes** (`state.village`), with the note *"Off: a quiet build-only meadow. Nothing is lost."*;
  * 💬 **Villager chatter** (`state.chatter`).
  * `syncSettings` also syncs `village` and `chatter`.
  * With `?town=0` the rows show the saved value plus *"(off for this page)"*.
* **Turning villagers off**: villagers, bubbles, the hearth, light spill, the camp and chatter are hidden; the town
  clock stops; toast. **On**: everyone is re-seated (`placeFor`) with a 👋 wave cue; toast.
* The welcome card's villager line (§1.1) only shows while villagers are on.
* **How to play** gains a *Villagers* section:
  * 🏡 *Homes*: walls, a roof, a door and a bed;
  * 💭 *Wishes*: tap a bubble, then Show me;
  * 🔥 *Cozy*: the hearth glows as the town gets cosier;
  * 🧺 *Quiet meadow*: turn villagers off in Settings.
* **Keys** (ui.js handler; builder.js doesn't use them): **T** town card, **J** jump to the next open wish (camera +
  card). Both are listed in the keys table.

### 10.8 Photo mode and guided mode

* **Photo mode**: villagers stay in the shot (a town photo has its people); bubbles, cards, the hearth and the
  highlight hide; follow ends; taps do nothing (as today).
* **Guided mode** (a guide active **and unfinished**, §4.1): see §4 and §7.1. Show me only frames the spot. The town
  card still opens. A finished guide is not guided, whether or not its card is still open.

---

## 11. Sound (all synthesized in audio.js, in `KEY` = F4)

### 11.1 New sound effects

| name | Sound | GAP |
|---|---|---|
| `wish` | two soft rising sine blips (KEY + 12 → KEY + 19), very quiet; only when the bubble is on screen | 0.5 s |
| `wish-granted` | music-box arpeggio KEY + 12, + 16, + 19, + 24 over a soft bell, with a shimmer tail; a little brighter than `success` | 0.6 s |
| `move-in` | two wood knocks (`PLACE.wood`), then a warm 4-note jingle over a short pad swell | 1.0 s |
| `gift` | ribbon rustle (band-passed noise) + rising glissando chime | 1.0 s |
| `villager` | a 3-syllable babble at the villager's pitch (`opts.pitch`) | 0.2 s |
| `hop` | tiny "oop!" (pitched triangle blip); only within 25 m of the camera target | 0.15 s |

`events.on('sfx', d => play(d.name, d.flavor, d.opts))`: the optional `opts` (pitch, gain, pan) merge into the play
options. This is backward compatible.

### 11.2 Ambient chatter and work foley

* `computeEnv()` reads `app.town?.audible?.()` every 0.25 s and gets `{ talkers: [{ pitch, pan, gain, chatty }],
  foley: [{ kind, pan, gain }] }`.
  * talkers = awake outdoor villagers within 35 m of the camera target (≤ 8, nearest first);
  * gain = 1 at ≤ 12 m, falling to 0 at 35 m;
  * pan = screen x.
* Chatter runs as a new discrete-event voice in `Ambience.schedule`:
  * rate = `min(0.8, 0.06 × n) /s`, × 1.5 in the Evening phase, × 1.5 for chatty talkers, × (1 − 0.8 × night);
  * an utterance is 3–7 syllables (60–120 ms) of a triangle oscillator at 180–340 Hz × voice through a formant
    bandpass (700–1800 Hz, Q 4), 10 ms attack, 60 ms decay, gain 0.025 × talker gain;
  * it plays on the **amb** bus, so Sound effects covers it, and only when `state.chatter` is on.
* **Foley**: `chop` (axe "tok"), `splash`, `cluck`, `hum` (a hummed kalimba phrase at Cheerful+). Same distance rule
  (≤ 12 m), at most one every 1.5 s, drained from `foley`.
* Ambience gain is unchanged otherwise; music is untouched.

---

## 12. Technical design

### 12.1 Module map

| File | WP | Role | May import |
|---|---|---|---|
| `js/town/data.js` | 1 | `TUNE`, `KEYS`, `JOB_ORDER`, `JOBS`, `TRAITS`, `NAMES`, `LINES`, `SETS`, `SPOT_DEFS`, `GIFTS` (metadata + seat anchors, the single source for gifts.js), `CAMP_CELLS`, `LANE_FALLBACK` | nothing |
| `js/town/rng.js` | 1 | seeded RNG + hashing | nothing |
| `js/town/homes.js` | 1 | world index, buildings/homes (§3), names, footprints | `../config.js`, `./data.js` |
| `js/town/nav.js` | 1 | nav grid, A*, string pulling, regions (§6) | `../config.js`, `./data.js`, `./rng.js` |
| `js/town/recipes.js` | 1 | recipe fit, missing items, charm, hangout spots | `./data.js`, `./homes.js` |
| `js/town/wishes.js` | 1 | templates (§7.3), eligibility, completion, spot finder | `./data.js`, `./homes.js`, `./nav.js` |
| `js/town/model.js` | 1 | `buildWorldModel()`: index → buildings → nav → spots in one call | `./homes.js`, `./nav.js`, `./recipes.js` |
| `js/town/sim.js` | 1 | deterministic town model: roster, status, schedule, plans, arrivals, wishes, Cozy, gifts | all of the above |
| `js/town/store.js` | 1 | `hearthwood.town.v1`: fresh, sanitize, load, save | `./data.js` |
| `js/town/look.js` | 2 | procedural villager, tent, lantern geometry; the patched shared material; glyph atlas | `three`, `../materials.js` |
| `js/town/render.js` | 2 | instanced meshes, blobs, spill, FX points, camp, highlight, debug overlay (internal to WP2) | `three`, `../materials.js`, `./look.js` |
| `js/town/actors.js` | 2 | presentation: interpolates plans, poses, steering, cues, hit test (the only WP2 API index.js uses) | `three`, `./look.js`, `./render.js` |
| `js/pieces/gifts.js` | 2 | the 10 gift pieces; un-hides unlocked ones at registration (§8.3) | `three`, `../catalog.js`, `../materials.js`, `../geom.js`, `../config.js`, `../town/data.js` |
| `js/town/hud.js` | 3 | bubbles, villager card, town card, hint and gift cards, hearth chip (DOM) | nothing (DOM; reads `app.town`) |
| `css/town.css` | 3 | all town styling | — |
| `js/town/index.js` | 4 | `init(app)` → `app.town`: wiring, clocks, recompute, persistence, input, Show me, params, debug | every `js/town/*` except hud.js |

That is **14 modules** in `js/town/` plus `js/pieces/gifts.js` and `css/town.css`.

**WP1 modules are pure**: no `three`, no DOM, no `window`, and **the sim never reads camera data** (the camera target
is presentation only: bubbles, 💤, sfx range). `store.js` may touch `localStorage`, guarded by
`typeof localStorage !== 'undefined'` and try/catch. Each must import in Node:
`node -e "import('./js/town/sim.js').then(m => console.log(typeof m.createSim))"` prints `function`.

### 12.2 Coordinates and ids

* World metres; cells as in ARCHITECTURE.md (`CELL` = 2). Nav cells `cx, cz ∈ −11..10`; a cell centre is
  `((cx + 0.5) × 2, surfaceY, (cz + 0.5) × 2)`.
* Yaw: radians about +Y, 0 = facing +Z (the pieces' convention).
* Building id: `'b:' + key` of its lowest cell (lowest y, then z, then x), formatted `x|y|z`. This is a runtime handle;
  persistent identity is the villager's stored footprints (§3.5).
* Villager id `'v' + n`, from the save's `nextId`, never reused.
* Time: `clock` (town seconds) everywhere in the sim and in plans. `TICK` = 0.25 s.

### 12.3 Data contracts (shared by every WP; changes go through the spec owner, §13.5)

```js
/** A world record, as in ARCHITECTURE.md: { t, x, y, z, a?, r?, h?, s?, m?, c?, k? } */

/** @typedef Index — built by homes.indexWorld() from world.entries
 *  version:number · defOf:(id)=>def
 *  F: Map<'x|y|z', Rec> · I: Map<'x|y|z', Rec> · D: Map<'x|y|z', Rec> · P: Set<'x|y|z'>
 *  W: Map<'W|a|x|y|z', Rec>                     (the world's own slot keys)
 *  R: Map<'x|z', Array<{ hs, r, kind, rise, t }>>  roof panels per column, hs = 2y + h
 *  byType: Map<pieceId, Rec[]>                  every record, by type
 *  edgeKey(x, y, z, dx, dz) → 'W|a|x|y|z'        the edge between (x,y,z) and (x+dx,y,z+dz) */

/** @typedef Building (homes.detectBuildings)
 *  id · cells:Set<'x|y|z'> · lo · levels:number[] · foot:[x,z][] (lowest level, sorted z then x)
 *  doors: [{ key, step:[x,z], out:[dx,dz], y, main:boolean, doorway:boolean, cell:[x,z] }]   exterior doors on `lo`
 *                                                                    (doorway: an open gap used as the way in, §3.1)
 *  windows: [{ key, t, x, z, out:[dx,dz] }]                          lowest-level windows (light spill)
 *  gaps:string[] (W keys) · gapEdges:[{ ek, d }] · unroofed:string[] ('x|y|z') · flaws:number · rooms:number
 *  beds:string[] (I keys, sorted) · capacity:number · home:boolean
 *  reasons: Array<'bed'|'door'|'gaps'|'roof'> · name:string · shell:boolean (uncovered candidate, §3.7) · partOf? (shells)
 *  roofHint: 'x|y|z'[] | null  ("the bedroom upstairs needs a roof": the cells to roof, §3.2 *)
 *  ground:number (how many of its cells are ground floors, §3.1 step 1) · roofedFrac:number (0..1, §3.7)
 *  detectBuildings(index) also returns roomOf, rooms, bOf (cell → building index, −1 none) and floor (M1). */

/** @typedef Veranda (homes.detectBuildings): { y, cells:[x,z][], doors:string[] (W keys of doors onto it) } */

/** @typedef Nav (nav.buildNav)
 *  N:22 · O:11 · cost:Float32Array(484) (Infinity = blocked) · surface:Float32Array(484) · blocked · doorstep · steps
 *  edge:Uint8Array(484*4)   per cell & dir (0 +Z, 1 +X, 2 −Z, 3 −X): 0 open (incl. gates), 1 hop, 2 wall
 *  region:Int16Array(484) (−1 blocked; flooded over open AND hop edges) · mainRegion:number · laneCell:[−11,−1]
 *  path(from:[x,z], to:[x,z], seed?) → { pts:Float32Array (x,y,z…), len, hops:number[], slips:number[], cells:number[], ok:true }
 *        (seed: the ±0.3 m lane offset of §6.2; cells: the A* cell indices, used to re-plan a walk whose route got built over)
 *  nearestFree(cx, cz, maxCells, sameRegion = true) → [cx,cz] | null · inMain(cx, cz) · reachWithout(cells) (cut-off check)
 *  isFree(cx, cz) · cellOf(x, z) → [cx,cz] · centre(cx, cz) → [x,y,z] · surfaceAt(x, z) → y · baseCost · stats
 *  nav.js also exports asciiMap(nav, tents) (debug.nav()). */

/** @typedef Spot (recipes.findHangouts / sim)
 *  id ('<slotKey>#<n>') · kind:'seat'|'stand'|'work'|'porch'|'plaza'|'door'|'tent'|'inside'
 *  piece · cell:[cx,cz] · at:[x,y,z] · face:yaw · pose:PoseId · approach:[cx,cz] · hangout:string|null · level */

/** @typedef WorldModel (model.buildWorldModel)
 *  version · index · det · buildings:Building[] · homes:Building[] · shells:Building[] · verandas:Veranda[] · nav
 *  spots:Spot[] · hangouts:[{ id, spots:Spot[], lamps, fire, blooms }] · tents:[cx,cz][] · ms (build time)
 *  lane:[x,y,z][] (LANE[2] → LANE[0] resampled every 1 m, y from heightAt, then the lane cell; index.js passes env's
 *        whole LANE polyline and the model uses LANE[0..2])
 *  passerby:{ route:[x,y,z][], view:[cx,cz] } (§4.7)
 *  validate(rec) → {ok, reason} · isFree(rec) → bool   (injected; index.js normalizes the raw spot-finder recs first:
 *        validate: rec => world.validate(world.normalize(rec) || rec), isFree: the normalized rec's slot is empty) */

/** @typedef VillagerModel (sim → actors / index; READ-ONLY outside sim.js)
 *  id · name · job · trait · voice · seed
 *  look: { outfit:0..2, skin:0..5, hair:0..5, build:0..2 }
 *  status:'traveller'|'resident'|'waiting'|'camping'|'passerby' · leaving:boolean (a traveller turning back)
 *  homeId:string|null · bed:string|null · feet:string[] (≤ 3 packed footprints) · arrived:number · grants:number
 *  plan:Plan · planId:number (bumps on every new plan) · wish:Wish|null
 *  flags:{ pack, tool, basket, book, lantern } (set explicitly by the sim; a missing flags object shows the tool) · mood:0..3 (Cozy tier)
 *  Fields starting with `_` are the sim's private bookkeeping (index.js reads _loc 'in'|'out'|'lane'|'gone', _cell,
 *  _pos, _inHome, _target and _act for views and debug only). Passers-by have ids 'p1'…, travellers their future 'v' id. */

/** Lying (M2): every lying pose ('sleep' inside, 'lie' outdoors) puts the head toward `face`; actors.js had it toward −face.
 *  @typedef Plan — times are town-clock seconds; actors interpolate at the render clock (town clock + the part of a
 *  tick not yet run). Plans chain in time: a step's t0 is the previous plan's t1.
 *  { kind:'walk',   pts:Float32Array, len, t0, t1, hops:number[], slips:number[], hurry:boolean }
 *  { kind:'pose',   at:[x,y,z], face, pose:PoseId, t0, t1 (Infinity = until replaced), level:0, ground?:[x,y,z], piece? }
 *                   `at` is the feet for standing poses and the seat top for seated ones; a pose whose `at` is
 *                   ≥ 0.28 m above its floor is drawn seated (read / chat / warm on a bench or log sit); `ground` is the
 *                   standing point when `at` is a seat
 *  { kind:'inside', homeId, level, at:[x,y,z], face, pose:'sleep'|'sit'|'stand', t0, t1 }
 *                   'sleep' lies in the bed at its local (0, 0.62, −0.1), `face` = the direction the head points (the
 *                   bed's local −Z), blanket on, hat off
 *  { kind:'door',   at:[x,y,z], face, dir:'in'|'out', t0, t1 }          0.4 s dither through a door, always along
 *                   `face`: 'in' from at to at + 0.4 m fading out, 'out' from at − 0.4 m to at fading in
 *  { kind:'hop',    from:[x,y,z], to:[x,y,z], t0, t1 }                  unstick hop (0.35 s arc)
 *  { kind:'slip',   from:[x,y,z], to:[x,y,z], t0, t1 }                  fade out → puff → fade in (0.5 s)
 *  { kind:'gone' }                                                       not drawn
 *  Plans may carry private fields (_cues, _cells, _to, _seat) that actors ignore. */

/** PoseId: 'stand','sit','kneel','water','hoe','scatter','pat','fork','chop','knock','fish','catch','smoke','knead',
 *  'polish','post','sort','read','chat','wave','admire','cheer','stretch','sweep','lie','rock','lookup','warm' */

/** @typedef Cue (sim → actors / index): { t, kind, id?, at?:[x,y,z], n?, home? }
 *  kind: 'hearts'|'note'|'sparkle'|'drops'|'chips'|'seeds'|'puff'|'z'|'letter'|'bread'|'fish'|'bees'|'hop'|'wave'
 *        |'pulse' (move-in glow: spill + openings at max(night, 0.7) for 2.5 s; `home`)
 *        | foley kinds 'chop'|'splash'|'cluck'|'hum'.  'puff' with n = 8 at the chimney is the move-in puff ring.
 *  'hop' / 'wave' need `id`; FX cues spawn at `at`, else at the villager's head or hand. index.js plays `hop` (within
 *  25 m of the camera target) and, for the traveller's knock, `move-in` on 'hop' cues, and queues foley for audible(). */

/** @typedef Wish: { tpl, born, size, dream:boolean, base:number|null, friend:string|null, homeId,
 *  frozen:object|null (e.g. { route:[cx,cz][] }), piece, icon, text, label }
 *  (piece = the first part's piece; icon/text/label resolved from the template, {friend} filled in) */

/** @typedef SpotPlan (wishes.findSpots / hintSpots / termSpots, §7.5)
 *  { parts:[{ piece, n, have }], recs:[{ part, rec, x, y, z, r, cell:[cx,cz], level, edge?:{ a, x, z, y } }], complete,
 *    spots0 (candidate count of the first part, for the §7.4 lot fit) }
 *  x, y, z are world metres (y = the spot's surface), `level` the piece level, `rec` the full record to place (roof
 *  recs from hintSpots carry h: null, index.js fills it with builder.autoRoofHeight). */

/** @typedef SimEvent: { type, ...detail }; types and details as the bus events in §12.5 without the 'town-' prefix,
 *  but carrying villager ids (villager: 'v1'); index.js turns them into VillagerViews for the bus. Extra sim events:
 *  camp { tents } (the tents changed: index.js recomputes with tents: sim.tents(), since they block nav), passerby { id },
 *  work { villager, job, produces } (the Phase 2 hook of §16, never put on the bus). `fixed` adds `gain`; status
 *  changes add `from` (the previous home id). */
```

### 12.4 Module APIs (signatures each WP implements exactly)

**data.js** (WP1)

```js
export const TUNE        // every constant of §15, by name
export const JOB_ORDER   // ['gardener','farmer','woodcutter','fisher','beekeeper','baker','lamplighter','postie']
export const JOBS        // { [job]: { id, label, icon, color, signature, terms:[{ set|id, where, R, need, of? }], oddWish } }
export const TRAITS      // { [trait]: { id, label, icon, shift:{ wake, home, sleep }, favours:{ [tpl]: 2|3 }, prefs } }
export const NAMES, LINES, SETS, SPOT_DEFS, CAMP_CELLS, LANE_FALLBACK
export const KEYS = { town: 'hearthwood.town.v1', unlocks: 'hearthwood.unlocks.v1' }
// GIFTS — exact, the single source gifts.js imports. seats: local [x, y, z, yaw] seat anchors (yaw about +Y, 0 = +Z)
export const GIFTS = {
  gift_flower_cart: { job: 'gardener',    name: 'Flower Cart',    counts: { BLOOM: 2 }, seats: [], walk: 'solid' },
  gift_hen_house:   { job: 'farmer',      name: 'Hen House',      counts: { FARM: 1 },  seats: [], walk: 'solid' },
  gift_carved_bear: { job: 'woodcutter',  name: 'Carved Bear',    counts: {},           seats: [], walk: 'solid' },
  gift_rowboat:     { job: 'fisher',      name: 'Little Rowboat', counts: {},           seats: [[0, 0.32, -0.15, 0]], walk: 'solid' },
  gift_honey_stand: { job: 'beekeeper',   name: 'Honey Stand',    counts: {},           seats: [], walk: 'solid' },
  gift_bread_oven:  { job: 'baker',       name: 'Bread Oven',     counts: {},           seats: [], walk: 'solid' },
  gift_festoon:     { job: 'lamplighter', name: 'Festoon Lights', counts: { LAMP: 1 },  seats: [], walk: 'solid' },
  gift_signpost:    { job: 'postie',      name: 'Signpost',       counts: {},           seats: [], walk: 'solid' },
  gift_gnome:       { job: null,          name: 'Garden Gnome',   counts: {},           seats: [], walk: 'soft' },
  gift_tea_table:   { job: null,          name: 'Tea Table',      counts: {},           seats: [[-0.55, 0.40, 0, Math.PI / 2], [0.55, 0.40, 0, -Math.PI / 2]], walk: 'solid' },
}
```

The seat anchors are local to the piece (cell centre at its floor, before its `r`); gifts.js builds the rowboat's
thwart and the tea table's stools at exactly those points, and the sim seats villagers there.

**rng.js** (WP1): `rng(seed) → () => [0,1)` (mulberry32) · `hash32(...parts) → uint32` · `range(r, a, b)` ·
`pick(r, arr)` · `weighted(r, [[item, w], …])`.

**homes.js** (WP1)

```js
export function indexWorld(entries /* world.entries */, defOf, version) → Index
export function detectBuildings(index) → { buildings: Building[], shells: Building[], verandas: Veranda[] }
export function regions(building, index, nav?) → { FOOT, DOOR, DOOR1, INSIDE, WIN }
export function packFoot(foot) → string            // 'x,z;x,z;…'
export function unpackFoot(str) → [x,z][]
export function footOverlap(a, b) → number          // |a ∩ b| / min(|a|, |b|)
export function nameOf(building, index) → string    // §3.4, without the article
```

**nav.js** (WP1): `export function buildNav(index, det /* detectBuildings' result */, { tents = [] } = {}) → Nav`;
`export function asciiMap(nav, tents) → string` (debug.nav()).

**recipes.js** (WP1)

```js
export function evalRecipes(index, home, town /* { homes:number, inside:Set (every building cell) } */)
  → { fit:{[job]:number}, met:JobId[], found, missing:{[job]: [{ what, have, need, text, piece, where, R, term }]} }
     // items inside any building never count as outdoor
export function chooseJob(evals, jobCounts, first /* roster empty */) → { job, runnersUp: JobId[] }   // first friend: fewest unmet terms (§4.3)
export function closestJobs(evals, units?) → JobId[]                  // the vacancy card's "closest jobs"
export function charmOf(index, home, inside?) → number                // kinds_h, an unbounded count (§9.1)
export const charmFromKinds = (S) => CHARM_MAX × (1 − e^(−S / CHARM_SCALE))    // the town charm
export function insideSet(buildings) → Set<'x|y|z'> · localToWorld(x, z, r, lx, lz) · doorStandPoint(door, nav) · unitsIn(set, t)
export function findHangouts(index, nav, det) → { spots: Spot[], hangouts: Hangout[] }
```

**wishes.js** (WP1)

```js
export const TEMPLATES                    // array of §7.2 rows, in §7.3 order
export function wishCtx(world: WorldModel, town: { villagers, homes }, v: VillagerModel) → Ctx
export function eligible(tpl, ctx) → boolean
export function isDone(tpl, ctx, wish) → boolean
export function baseline(tpl, ctx) → number | null
export function findSpots(tpl, ctx, wish = null) → SpotPlan          // §7.5; ≤ 24 recs
export function hintSpots(kind /* 'bed'|'door'|'gaps'|'roof' */, building, world) → SpotPlan   // one part; roof recs carry h: null (index.js fills it)
// M1 extras: TEMPLATE (by id) · createWish(tpl, ctx, clock, { dream }) · weightOf(tpl, ctx, { odd, sameHeld, lotSpots })
//   textOf(id, ctx, friendId) → { icon, text, label } · termSpots(term, building, world, town) (Show me { home, job })
//   freeArea(ctx) · areaLayout(area) · routeOf(ctx). w_neighbour, the camp fallback and the Postie's "another home"
//   plan a full SMALL_HOME layout (17 recs in 5 parts: foundation ×4, wall ×7, wall_door, roof_flat ×4, bed) on a
//   frozen free 6 × 6 area, so placing the plan really grants the wish.
```

**model.js** (WP1)

```js
export function buildWorldModel({ entries, defOf, version, lane /* [x,z][] */, heightAt, tents, validate, isFree }) → WorldModel
```

**sim.js** (WP1)

```js
export const TICK = 0.25
export function createSim({ save /* sanitized TownSave */, readOnly = false }) → Sim
// Sim:
//   time                                   town clock of the last tick
//   villagers: VillagerModel[]             residents, waiting and camping (stable order: arrival)
//   traveller: VillagerModel|null · passerby: VillagerModel|null
//   world: WorldModel|null · cozy: { value, tier, warmth, charm, floor, frac }
//   setWorld(model, { restore = false } = {})   re-binding with settling (§3.5), wish checks, nav-blocked
//                                          hops/slips; restore = the silent boot binding; never throws. Settling is
//                                          measured by the sim itself from its last setWorld, so it is deterministic
//   tick(dt = TICK, ctx: { sky, flowing, guided, night })   no camera data, ever
//   reseat()                               placeFor() everyone now (slider jump, villagers back on, load)
//   planFor(target: { villager } | { home, hint } | { home, job } | { camp }) → { plan:SpotPlan, inside, level, text }
//   couldMoveIn() → [{ homeId, homeName, kind:'bed'|'free', job, name?, camper?, missing:[…] }]   (camper: the id of
//                   the camper a "one more bed" would bring, named instead of a newcomer, R1 T1.7)
//   muteHint(homeId) · answerIntro(lovely:boolean) · note:string|null (boot summary for the town card)
//   drainEvents() → SimEvent[] · drainCues() → Cue[]
//   serialize() → TownSave
//   debug: { spawn(job, opts), traveller(job), passerby(), wish(id, tpl), grant(id), expire(id), setCozy(n),
//            unlock(id), unlockAll(), advance(seconds, ctx), stuck() → id[], outdoorsShare() → 0..1,
//            resetOutdoors(), stats() → { tickMs, ticks, slips, plans }, resetStats(), phaseOf(id), inner(id) }
// M1 extras (read-only views index.js uses): homeViews() → per building { id, name, theName ("the thatched cottage",
//   or "Mabel's thatched cottage" when two share a name), home, shell, status 'home'|'full'|'vacancy'|'almost'|'fix',
//   bubble 'almost'|'fix'|'vacancy'|null, missing:[{ kind, icon, text, n }], roofAnchor:[x,y,z], door, doorCell, beds,
//   capacity, residents, free, light (spill level 1 / SPILL_ASLEEP / 0), asleep, lit, windows, doors, lo, foot (packed),
//   fit, best, runnersUp, almost, cells, reasons } · tents() → [cx,cz][] · campWish() → { n, icon, text, label } | null ·
//   line(id) (the flavour line, §2.6; a granted line wins over the move-in line) · fadedWish(id) · a settable `intro`
//   (true while the intro card is open: no traveller is scheduled) · a settable `holdPasserby` (M2: true while a card
//   covers the meadow; the first passer-by comes PASSERBY_FIRST after it clears, §4.7) · homeViews() rows also carry
//   `listed` (on the town card's "Almost homes": almost-eligible, or a small bedless shed, not muted; M2) · live save fields unlocks, seen, tips, muted, stats ·
//   day, population, seed, lastSeen, readOnly · lastError (the sim catches its own exceptions there; index.js turns the
//   first one into a town failure, §13.5).
```

**store.js** (WP1)

```js
export const KEY = KEYS.town, VERSION = 1
export function freshTown(seed) → TownSave
export function sanitizeTown(obj) → TownSave        // never throws; §12.9 rules
export function loadTown() → { save: TownSave, readOnly: boolean, fresh: boolean }
export function saveTown(save, onFail /* () => void, called once */) → boolean
export function saveUnlock(id) → boolean            // adds id to KEYS.unlocks first (tiny key), before the town save
// store.js imports only data.js (template ids and sizes are checked against data.js WISH_TEXT / WISH_SIZE);
// sanitizeTown always outputs v: 1, loadTown judges readOnly from the raw v; a non-JSON save salvages unlocks / seen.
```

**actors.js** (WP2), the only WP2 API index.js uses

```js
export function createActors(app, { render = true } = {}) → Actors   // render:false (townrender=0): the group is never
                                                                     // added to the scene; hitTest / highlightHit find nothing
// Actors:
//   sync(models: VillagerModel[])          add/remove/re-skin instances by id; cheap when nothing changed
//   update(dt, clock, frame: { night, viewLevel, seeAll, photo, camTarget:[x,y,z], scrub? })
//                                          clock = the render clock; scrub: true fades everyone out while the time
//                                          slider moves (§5.4), they fade back in where their next plans put them
//   cue(c: Cue)                            FX, hop arcs, waves, move-in glow
//   positionOf(id) → { x, y, z, headY, visible } | null   headY = the top of the job hat (bare head 1.25 m, toque and
//                                          stovepipe ≈ 1.57 m), so "head + 0.35 m" bubbles clear tall hats
//   hitTest(sx, sy, padPx = 24) → { id, dist } | null   CSS px of the canvas; the projected body (a capsule from
//                                          feet to head, radius 0.3 m) grown by padPx; index.js passes 12 with the
//                                          Build tool and 24 otherwise
//   setSpill(lights: [{ kind:'ground'|'opening', x, y, z, nx, nz, w, h, homeId }], levelOf: (homeId) => 0..1)
//                                          (x, y, z) = the quad centre. index.js: a ground quad 0.75 m out from the
//                                          door / window edge midpoint, y = nav surface + 0.03, 1.6 × 1.2; an opening
//                                          quad 0.11 m outside the wall line at the opening's middle (door 1.0 × 1.95,
//                                          window 1.0 × 1.0); levelOf from the residents inside (1 / 0.15 / 0)
//   setCamp(tents: [{ x, z }])             world-metre tent centres, door toward +X, y = 0
//   highlight(h: { cells:[{x,y,z}], faint?:[{x,y,z}], edges?:[{x,z,y,a}], ghost?:Rec } | null)
//                                          cells in world metres (y = the spot surface, as SpotPlan recs carry); edges
//                                          = SpotPlan rec.edge (grid edge, y = level); faint rings at 35 %, not hittable
//   highlightHit(sx, sy) → number          index into [...h.cells, ...h.edges] (cells first) whose ring (radius 0.9 m
//                                          at the spot's surface) or the ghost's world box the screen ray passes
//                                          through (a ghost hit → the ring nearest the ghost's slot; only a finite,
//                                          non-empty box counts, R2 T2.1), else −1
//   compile(camera) → Promise              one hidden instance of every town mesh, renderer.compileAsync (§12.8)
//   debugNav(nav | WorldModel | null) · setVisible(b) · stats() → { calls, tris, instances, updateMs }
//                                          (a WorldModel also draws home outlines, shells, doorsteps and spots)
//   not in the contract, for tests: group, render, frame, actor(id)
```

**gifts.js** (WP2): registers the 10 defs of §8.2 with `registerPiece`, taking ids, names, `gift: { job }`, `walk` and
seat anchors from `data.js GIFTS`; extra def field `hidden: true`, except for ids found in `KEYS.unlocks` or in
`KEYS.town`.unlocks (read in try/catch at registration, §8.3), which register with `hidden: false`. Also on the defs:
`seats` (a copy of the GIFTS seats), `counts`; the rowboat `thumb: { r: 1 }`; hen house and rowboat `mats:
['paintedWood'], paint: true`; the gnome `paintAlways` (hat); the bread oven `emitterOffset` [0, 1.3, −0.2] and a
per-surface `root.userData.emitterOffset`. Exports `unlockedGifts()`. main.js loads it with the other piece modules
(M1), so gift pieces always register, villagers on or off.

**hud.js** (WP3)

```js
export function createHud(app, { root, topLeft, toast, ask }) → Hud
// Hud: update(dt) · openTown() · openVillager(id) · nextWish() · close() · isOpen() → boolean · destroy() · debug
// Reads app.town (TownAPI) afresh on every call and listens to the bus events of §12.5. Never imports other town modules.
// It mounts after first paint (ui.js), i.e. after `ready`: it runs its ready logic at mount and polls view().intro.
// Bubbles are ranked by kind (traveller > gift > wish > camp > fix > almost > vacancy > dream, edge-clamped travellers
// count toward the 6), not by BubbleView.priority. Bubbles hide under the sheet, a dialog and the first-visit welcome
// card. UI timers (the gift card's delay, the flow tip) run on real time. Tapping a traveller's bubble follows them and
// shows an info toast instead of a card.
```

**index.js** (WP4): `export async function init(app) → TownAPI`, published by main.js as `app.town`:

```js
// TownAPI
ready: boolean                         // true after the first (restore) recompute on `ready`, §3.8
enabled() → boolean                    // state.village && not ?town=0 && not showcase && healthy
clock() → number · day() → number
cozy() → { value, tier:'quiet'|'content'|'cheerful'|'glowing', warmth, charm, floor, frac /*0..1*/ }
view() → TownView                      // cached, rebuilt at most 4×/s
villager(id) → VillagerView | null
bubbles() → BubbleView[]               // per frame; world anchors, the hud projects them
giftInfo(pieceId) → { from:string, isNew:boolean } | null
tipOnce(id) → boolean                  // true the first time (records it in the save's `tips`), false after
audible() → { talkers:[{ pitch, pan, gain, chatty }], foley:[{ kind, pan, gain }] }   // foley is drained
hitTest(sx, sy, padPx = 24) → villagerId | null
showMe(target: { villager } | { home, hint } | { home, job } | { camp }) → boolean
showing() → { label, parts:[{ piece, icon, name, n, have }], done } | null     // the checklist, §10.4
endShowMe()
muteHint(homeId) · answerIntro(lovely: boolean)
follow(id | null) · focusHome(homeId)
update(dt)
debug: { … §12.13 }

// TownView      { day, cozy, villagers:VillagerView[] (residents, waiting, campers; not the traveller), homes:HomeView[]
//                 (every building and shell, with its status), couldMoveIn:Row[], almost:HomeView[] (almost-eligible
//                 buildings and fix-ups), campers:number, openWishes:number, granted:number, full:boolean,
//                 timeFlow:boolean, enabled:boolean, note:string|null, intro:boolean (show the intro card, §1.3; stays
//                 true until answerIntro, since the hud mounts after `ready`), away:number|null (s since the last
//                 visit, measured at boot: the welcome-back toast) }
// VillagerView  { id, name, job, jobLabel, jobIcon, color, trait, traitLabel, traitIcon, status, statusText,
//                 homeId, homeName, wish:{ tpl, text, label, icon, piece, pieceName, size, dream } | null,
//                 fadedWish:boolean, line, grants, voice (0.85–1.25, the card's babble pitch) }
//                 villager(id) also answers for the traveller (status 'traveller')
// HomeView      { id, name ("the thatched cottage", the article included), door:[x,y,z], beds, capacity,
//                 residents:id[], free, status:'home'|'almost'|'fix'|'vacancy'|'full', missing:[{ kind, text, icon, n }],
//                 plus sim.homeViews()'s extras (roofAnchor, bubble, theName, …) }
// BubbleView    { key, kind:'wish'|'dream'|'traveller'|'passerby'|'camp'|'almost'|'fix'|'vacancy'|'sleep'|'nameplate'|'gift',
//                 icon, text?, label, at:[x,y,z], roof?:[x,y,z], villager?, home?, tappable, priority, arrow:boolean
//                 (edge-clamp with an arrow when off-screen: traveller and passer-by), dim:boolean (guided) }
//                 `at` is the head + 0.35 m outdoors and the home's roof anchor while the villager is inside or hidden
//                 (and for dreams); `roof` (wishes outdoors) lets the hud switch to the roof anchor when a piece
//                 occludes the head. `text` carries the camp count (camp) and the pill text (nameplate, "Mabel 🌷").
//                 `label` may be the bare template label: the hud builds "Mabel's wish: …" / "Mabel dreams: …".
//                 kind 'gift' (M2): a 🎁 at the granter's head (else their roof) for 4 s after a thank-you gift; a tap
//                 opens the gift card.
// Row           { homeId, homeName, text, icon, target:{ home, job } | { home, hint:'bed' } (a 'bed' row: "one more
//                 bed and Posy the Beekeeper would come"), job }; the row texts are data.js ROW_TEXT
```

### 12.5 Events on the bus (`state.js` `events`)

| Event | Detail | Emitted by | Heard by |
|---|---|---|---|
| `town-ready` | `{ away }` (after the restore recompute; `away` = s since the last visit or null) | index | hud |
| `town-homes` | `{ homes: HomeView[] }` (after a recompute that changed homes) | index | hud |
| `town-traveller` | `{ villager: VillagerView, homeId, first, migration }` | index | hud (toast + pin) |
| `town-movein` | `{ villager, homeId, homeName, first }` | index | hud (toast, nameplate, hearth) |
| `town-wish` | `{ villager, wish }` | index | hud |
| `town-granted` | `{ villager, wish, reward: { cozy, gift: giftId or null }, gain, cozy: { before, after }, camp: boolean }` (camp: the camp thank-you, §3.6; the toast's line is `villager.line`, a granted line) | index | hud |
| `town-expired` | `{ villager, wish }` | index | hud |
| `town-gift` | `{ id, name, from: villagerId, fromName }` | index | ui (cards), hud (gift card) |
| `town-cozy` | `{ value, tier, prevTier }` | index | hud |
| `town-status` | `{ changes: [{ villager, status, prev, homeName?, from, back }] }`: one event per settled commit (§3.5); never at the boot restore. `back` (R1 T1.6): a camper returning to the bed they left (`_lastBed`, kept in the save as `home.bed`) in a home matching their most recent foot, so "back home" never names a home they never lived in | index | hud (one summary toast) |
| `town-fixed` | `{ villager, homeId, gain }` | index | hud |
| `town-passerby` | `{ id }` (a passer-by set off; the tip fires when its arrow / route first shows) | index | hud |
| `town-readonly` | `{}` (another tab wrote the town: this tab never writes it again, §12.9) | index | hud (warn toast + Reload) |
| `town-savefail` | `{}` (the first failed town write) | index | hud (warn toast, once) |
| `town-day` | `{ day }` | index | (Phase 2/3 hook) |
| `town-showme` | `{ villager?, home?, camp?, piece, pieceName, icon, verb (data.js SHOWME_VERB, else 'place'), inside, parts:[{ piece, icon, name, n, have }], update:boolean }` | index | hud (hint toast on the first; checklist chip) |
| `town-showme-end` | `{ granted:boolean }` | index | hud (removes the checklist) |
| `town-intro` | `{}` (an existing build met a fresh town, §1.3) | index | hud (intro card) |
| `town-select` | `{ id }` (a villager was tapped in the world) | index | hud (opens the card) |
| `town-enabled` | `{ on }` | index | hud, ui |

SFX from index.js: `wish` (when the new bubble's anchor projects into the canvas), `wish-granted`, `move-in` (on the
traveller's knock, the 0 s beat of §4.6), `gift`, `hop` (within 25 m of the camera target); `opts` may carry `pan` and
`gain`. hud.js emits `villager` with `opts.pitch` on card open. Every `town-*` event's `villager` is a VillagerView (the
hud also accepts an id). Every town event is also logged with `townlog=1`. index.js also emits `toast` once for the §0.4
flow-default switch (its text is data.js `STATUS_TEXT.flowDefault`).

### 12.6 Exact edits to existing files

| File | WP | Change |
|---|---|---|
| `js/main.js` | 4 | (1) `app` gains `town: null`. (2) piece loop `['floors', 'walls', 'roof', 'decor', 'gifts']`, so gift pieces always register, villagers on or off. (3) after blueprints: `setLoading('Waking the village…', 0.8); app.town = await loadModule('town', './town/index.js');` (before ui). (4) in `frame()`, after the blueprints line: `try { app.town?.update?.(dt); } catch (e) { reportError('town.update', e); app.town.update = null; }` (index.js's `update` does nothing until its restore recompute on `ready`, §3.8). (5) autosave hook: `let savedView = restored && !(dropped > 0) ? JSON.stringify(rig.getView()) : null;`, so a restore that dropped unknown pieces (gifts met by an older cached version) is never overwritten by a camera-only flush; edits still save. `dropped = (saved.dropped || 0) + (saved.pieces.length − app.loadBuild(saved))`, computed where the autosave is restored: `storage.sanitize` keeps records of unknown ids and only `world.load` skips them, so `saved.dropped` alone never counts them (M0). Nothing else. |
| `js/state.js` | 4 | `defaults` gains `village: true` and `chatter: true`; both go in `PERSIST` (booleans are already validated by `cleanSetting`). |
| `js/env.js` | 4 | `const LANE` → `export const LANE`; `const DAY_SECONDS` → `export const DAY_SECONDS` (index.js reads them through `app.modules.env`, falling back to `LANE_FALLBACK` / 600). M2 (feel check): the lingering dusk of §5.1 (`sunTime(t)`, used for the sun and moon only), and a smoke emitter's alpha × `def.smokeAlpha` (default 1). |
| `js/pieces/decor.js` | 4 (M2) | `fire_pit`: `emitterOffset` [0, 1.0, 0] (was 0.35) and `smokeAlpha: 0.45`, a thin wisp that starts above head height so whoever sits round the fire stays in view. |
| `js/blueprints.js` | 4 (M2) | With villagers on and drawn (`app.town?.enabled()` and the `'town'` group in the scene, so not with `townrender=0`), a stamp ("Place it instantly") is followed, once the cascade is done, by the finishing glide (any touch of the camera cancels it), which then frames the garden too (trees aside), pulling back at most ×1.15 (`finishView(bp, cap)`), so the bench and the hive where the routine plays out are in the portrait shot. Villagers off: unchanged. |
| `js/catalog.js` | 4 | add `export function setHidden(id, hidden) { const d = registry.get(id); if (d) d.hidden = !!hidden; return !!d; }`, and document `gift` / `walk` in the `registerPiece` comment. |
| `sw.js` | 4 | add `./css/town.css`, `./js/pieces/gifts.js` and all 14 `./js/town/*.js` (§12.1) to `CORE`; `VERSION` 4 → 5. (Done in M1, as soon as main.js loaded gifts.js and the town at boot, so offline play never misses a module.) |
| `tools/batch-regress.mjs` | 4 | (1) M0: `startServer`, `launch`, `openGame`, `saveDataURL` and the injected helper strings move, unchanged, to the new `tools/harness.mjs` (§13.1); batch-regress imports them and still re-exports `ROOT` / `openGame` for old callers. Its module body (the suite, `process.exit`) stays here, so importing harness.mjs never runs it. (2) Every query it opens gets `&town=0` appended, or `&town=fresh&townrender=0` with `HW_TOWN=1` (the town's logic, rig wrapping and recomputes run but nothing is drawn, so the draw-call ratio checks are unchanged). Nothing else. |
| `docs/ARCHITECTURE.md` | 4 | file list; a "Town (`js/town/`, `app.town`)" section (contract of §12.3–12.5, the scene group rule, the storage key, params); the state keys `village` and `chatter`; the new sfx names; the toast `action` option; `catalog.setHidden`; the gift def fields; a pointer to `docs/LIVING.md`; `tools/harness.mjs` in the file and tools lists; under *Dev tools*, that `?showcase=all` lays out 10 pieces per row and with more than 100 pieces its last row sits just past the lot's front edge. |
| `README.md` | 4 | a *Villagers* chapter (homes, wishes, Cozy, gifts, quiet meadow), a Settings row, keys T/J, URL params, piece count "96 + 10 thank-you gifts", the tools list. |
| `index.html` | 3 | `<link rel="stylesheet" href="css/town.css">` after `ui.css`. |
| `js/ui.js` | 3 | (1) `toast(text, kind, ms, action)`: with `action: { label, fn }` renders a `.hw-toast-act` button and adds class `has-act`; the `toast` event passes `d.action`. (2) Settings: a "Village" section (two `toggle()` rows, note, "(off for this page)"); `syncSettings` keys add `village`, `chatter`. (3) `pageMain`: a "🔥 Town" row (Cozy number) whenever `app.town?.enabled()`, at every screen width, opening `hud.openTown()`. (4) Help: Villagers section; keys T and J. (5) keydown: `t` → `hud?.openTown()`, `j` → `hud?.nextWish()`; Esc closes an open hud card first. (6) Cards: re-render on `town-gift`; a `.hw-card-gift` ribbon when `def.gift && app.town?.giftInfo(def.id)?.isNew`; a Garden tab dot until the tab is opened after an unlock; `showInfo` adds "A thank-you from {from}". (7) Welcome card: one line *"Build a home with a bed and someone may move in."*, only while `app.town?.enabled()`. (8) Mount: after first paint, `import('./town/hud.js')` (try/catch, `console.error` on failure) → `hud = createHud(app, { root, topLeft, toast, ask })`, only if `app.town`; `update()` calls `hud?.update(dt)`; the returned ui API gains a read-only `hud` getter (WP3 named its variable `townHud`: ui.js already had a `hud`). |
| `js/audio.js` | 3 | (1) `SFX` + `GAP` entries of §11.1. (2) `events.on('sfx', d => play(d.name, d.flavor, d.opts))`; `play` merges `extra` into `o` (already supported); `opts` also takes `gain` (0..2) and `pan` (−1..1). (3) `computeEnv`: `const a = app.town?.audible?.()`; `E.talkers = state.chatter && a ? a.talkers : []`; foley queue (≤ 3); an `evening` flag. (4) `Ambience.schedule`: a chatter voice and foley (§11.2). (5) `stats().amb.chatter` and `.foley` counters for tests. (Also fixed: a pre-existing click in the `place` leaf flavour, burst spacing 0.026 → 0.031 s.) |

**Not edited:** `world.js`, `batcher.js`, `builder.js`, `storage.js`, `effects.js`, `camera.js`,
`thumbs.js`, `materials.js`, `geom.js`, `config.js`, `js/pieces/{floors,walls,roof}.js`, `tools/shot.mjs`,
`css/style.css`, `css/ui.css`, `manifest.webmanifest`. If a WP believes one of these needs a change, it raises it with
the spec owner (§13.5) instead of editing.

### 12.7 Input, camera and Show me wiring (index.js)

* **Taps.** After init (the builder has already set its callbacks), index.js wraps three rig callbacks; builder.js
  is untouched:
  ```js
  const tap = rig.onTap, press = rig.onPress, aimEnd = rig.onAimEnd;
  const live = () => !state.photoMode && town.enabled() && town.ready;
  const pad = () => (state.tool === 'build' ? 12 : 24);
  rig.onTap = (x, y, e) => {
    if (live()) {
      if (snapToHighlight(x, y)) return;                       // a Show me spot: build exactly there
      const id = town.hitTest(x, y, pad());
      if (id) { events.emit('town-select', { id }); return; }
    }
    town.follow(null);
    tap?.(x, y, e);
  };
  rig.onPress = (x, y, t) => {
    if (live() && actors.highlightHit(x, y) < 0 && town.hitTest(x, y, pad())) return;
    press?.(x, y, t);
  };
  rig.onAimEnd = (x, y, cancelled, e) => {
    if (!cancelled && live() && snapToHighlight(x, y)) { app.builder.hideGhost(); return; }
    aimEnd?.(x, y, cancelled, e);
  };
  ```
  * `snapToHighlight(x, y)` works only while a Show me is up, `state.tool === 'build'` and `state.pieceId` is the
    current part's piece (or one of its `alt`). With `i = actors.highlightHit(x, y)` ≥ 0 and that rec still free and
    valid (`world.validate`), it calls `builder.place({ ...rec, m, c, k })` with `m = builder.materialFor(def)`,
    `c = builder.colorFor(def, m)` and `k = def.accent ? state.accent : undefined`, exactly what a normal placement
    uses (one undo step, the usual pop-in, sfx and `placed` event), and swallows the tap. Otherwise it returns false
    and the tap goes on as usual. A tap on the top of a ghost bench that would hit the house wall behind it still
    lands on the bench's spot.
  * Press-and-hold still builds: an aim that ends anywhere but on a highlight goes to the builder's `aimEnd`
    unchanged, and draw strokes are never touched.
* **hitTest(sx, sy, pad)** = `actors.hitTest(sx, sy, pad)` → `{ id, dist }`, then **occlusion**: when
  `app.builder.pickPiece(sx, sy)` hits a piece whose `point` is nearer the camera than `dist − 0.3`, the result is
  `null`. Indoor villagers are tappable only when visible. With the Build tool the pad is 12 px and a Show me spot
  always wins, so building at a door where a villager stands places the piece; Erase, Paint and Pick keep 24 px.
* **Follow** (§10.2): each frame, if `goal.target` is more than 0.05 m from where follow put it last frame, follow ends
  and the target is clamped to `rig.bounds`; else `rig.focus(x, y + 0.8, z)`. Orbit and zoom keep it. camera.js anchors
  a pinch and a twist on the point between the fingers and re-anchors a one-finger orbit on what is under the view
  centre, which moves `goal.target`; so `wrapRig()` also gives the rig **instance** thin wrappers, active only while
  following (camera.js itself stays unedited, R1 T1.4): `_zoomAbout` / `_turnAbout` get no pivot in `multi` mode (the
  zoom changes the radius only, the twist turns about the target), `_reanchor` does nothing, and `_grab` (the
  two-finger slide) holds back until the midpoint has slid `24 px + ½ Σ|Δ finger distance|` since `_initMulti`, then
  applies the whole drift at once, which ends Follow as a pan does. A wheel zoom toward the cursor still ends it.
* **Show me** (§7.6): a `pieceId` / `tool` change that index.js didn't make itself ends the highlight; index.js records
  the piece it hands over before calling `selectPiece`.
* **Guided** (§4.1) is computed every tick from `active()` and `progress()`.
* **Slider scrubbing** (§5.4): a sky jump fades villagers out and (re)arms a `RESEAT_DELAY` (0.4 s) timer; `sim.reseat()`
  runs when it fires.

### 12.8 Rendering (WP2)

* All town objects live under one `THREE.Group` named `'town'`, added to `app.scene`. Never in `world.root`, layer 0
  only, `castShadow = false`, `frustumCulled = false` on instanced meshes. No `effects` tweens, no `effects.puff`.
* **Villager bodies**: one `InstancedMesh` per job present (capacity 24: 20 villagers + traveller + passer-by +
  headroom), `visible = count > 0`.
  * They share one `MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })` patched with `onBeforeCompile`
    (`customProgramCacheKey` `'town-villager-1'`).
  * Per-vertex attribute: `aPart` (float) packs part + 16 × tint + 128 × round(shade × 32), so one tint carries trims
    and checks. Part enum (WP2, internal): 0 fixed, 1 blanket, 2 bun, 3 beard, 4/5 legs, 6/7 arms, 8 head, 9 tool, 10
    pack, 11 hat, 12 basket, 13 book, 14 walking stick.
  * Per-instance attributes: `iOutfit`, `iSkin`, `iHair` (vec3); `iAnim` (vec4: leg swing, left arm, right arm, head
    yaw); `iAnim2` (vec4: sit 0..1, tool raise, bob, head pitch); `iFlags` (vec4: fade 0..1, tool, pack, extra bitmask:
    1 basket, 2 book, 4 hat off, 8 lie, 16 beard, 32 bun).
  * The vertex shader recolours tagged parts, rotates legs and arms about the hip (y 0.42) and shoulder (y 0.82)
    pivots (normals too), turns the head about the neck (y 0.92), bends the legs 80° forward when sitting, and
    collapses hidden accessories to their pivot.
  * The fragment shader fades with a 4 × 4 Bayer **dither discard** (no transparency sorting).
  * Lying is done with the instance matrix (body rotated onto the bed).
  * **Fallback**: if the patch fails (or `window.__townNoPatch`), use the plain vertex-colour material, without limb
    swing.
* **Glow**: one `InstancedMesh` (`mat('lampGlow')`, 32) for lanterns, the Lamplighter's pole tips and camp lanterns,
  so they glow with `setNight`.
* **Blob shadows**: one `InstancedMesh` of flat 0.9 m quads, radial canvas texture, `transparent`,
  `depthWrite: false`, opacity 0.35 × (1 − 0.5 × night), 1 cm above the surface.
* **Light spill and opening glow**: one `InstancedMesh` (128) of quads with a warm radial texture,
  `AdditiveBlending`, `depthWrite: false`, brightness per instance via `instanceColor`. Ground spill quads (1.6 × 1.2
  m) lie flat at the nav surface + 0.03 m (on grass, path or deck, never under a deck or z-fighting a path); opening
  quads stand in a door or window opening, 2 cm outside the wall, sized to the opening (only lit by the move-in glow,
  §5.6). Hidden when nothing is lit.
* **FX**: one `THREE.Points` (256-particle ring buffer, GPU-animated from birth time, gravity and drift per kind) with
  a 4 × 4 glyph atlas drawn at boot with canvas paths: heart, note, sparkle, drop, chip, seed, puff, z, letter, bread,
  fish, bee.
* **Camp**: one `InstancedMesh` (10) of vertex-coloured canvas tents, only while someone camps.
* **Highlight**: one `InstancedMesh` (24) of pulsing golden flat rings (`AdditiveBlending`; the later parts' rings at
  35 % brightness), plus the ghost:
  `world.buildPlaced(rec)` baked into **one** mesh (R2 T2.4: every visible part's geometry, position and normal only,
  in the piece's own frame, merged with `mergeGeometries`) drawn with `materials.blueprintMat(true)` at the piece's
  placement and added to the town group; on replace only that baked geometry is disposed (the template geometry stays
  shared). A piece with nothing drawable or a non-finite placement shows no ghost and no ghost hit box (the rings alone
  mark the spot), so a broken ghost can never claim the whole screen (R2 T2.1).
* **Debug overlay** (`townnav=1`): one 44 × 44 m plane with a canvas texture (22 × 22 cells × 10 px).
* **No first-use stutter**: `actors.compile(camera)` runs during `init`, behind the loading screen: one hidden
  instance of every town mesh (a body of every job, glow, blob, spill, FX points, tent, ring), then
  `renderer.compileAsync(townGroup, camera, scene)` when `KHR_parallel_shader_compile` is there (as blueprints.js
  does for its pictures), else one render of the town group into a 1 × 1 scissor. The first traveller then compiles
  no program (`renderer.info.programs.length` unchanged, L9).
* **`townrender=0`** (§12.12): the town group is never added to the scene and `hitTest` / `highlightHit` return
  nothing; the sim, recomputes and rig wrapping run as usual.
* **Draw calls**:

  | Item | Calls |
  |---|---|
  | bodies | ≤ 8 (one per job present) |
  | glow | 1 |
  | blobs | 1 |
  | spill | 1 |
  | FX | 1 |
  | camp | 0–1 |
  | **total, worst** | **≤ 13** |
  | highlight | + 1 ring + 1 ghost (one baked mesh whatever the piece; the birdhouse has 10 parts) |

  Main pass only; nothing in the shadow pass. Measured in the drafts: +11 calls for 20 villagers + blob + spill + FX
  (cottage 94 → 105, farmhouse 126 → 137).
* **Triangles**: ≤ 900 per villager (≤ 18k for 20); ≤ 300 per tent (148 now); a lantern 24 (a square one, R1 T1.13:
  up to 30 burn at night, 20 villagers and 10 tents). With 20 villagers the town stays ≤ 20k triangles day and night,
  campers included (R11's night case).

### 12.9 Persistence

**Key** `hearthwood.town.v1` (`KEYS.town`), one per browser profile, separate from builds, plus the tiny mirror
`hearthwood.unlocks.v1` (`KEYS.unlocks`, a JSON array of unlocked gift ids, §8.3). The autosave
(`hearthwood.autosave.v1`), slots and share codes are unchanged.

```js
{ v: 1,
  seed: 2862933555,                        // uint32, town RNG
  clock: 5321.5,                           // town seconds (≥ 0)
  lastSeen: 1764000000000,                 // wall-clock ms at the last save (welcome back; Phase 2 idle hook)
  warmth: 31.5,                            // [0, 60]
  stats: { granted: 7, arrivals: 4, gifts: 2 },
  nextId: 5,
  unlocks: { gift_flower_cart: { at: 2810, from: 'Mabel', job: 'gardener' } },   // device-level, permanent
  seen: ['gift_flower_cart'],              // tray ribbons cleared
  tips: { hearth: 1, wish: 1, flow: 1, intro: 1 },
  muted: ['3,4;4,4;3,5;4,5'],              // "Just a shed" footprints (≤ 30)
  campGrants: ['v3|I|2|0|-2'],             // camp thank-yous given, villager|bed (≤ 60)
  villagers: [{
    id: 'v1', name: 'Mabel', job: 'gardener', trait: 'early',
    look: [1, 2, 4, 0],                    // outfit 0..2, skin 0..5, hair 0..5, build 0..2
    voice: 0.96, seed: 912733,
    status: 'resident',                    // 'resident' | 'waiting' | 'camping'
    home: { feet: ['-2,-2;-1,-2;…', '…'], bed: 'I|2|0|-2' } | null,   // ≤ 3 footprints, most recent first
    since: 812.0, arrived: 812.0, grants: 3,
    wish: { tpl: 'w_door_flowers', born: 5200.0, size: 'M', dream: false, base: null, friend: null, frozen: null } | null,
    nextWishAt: 5480.0, recent: ['w_door_bench'], cool: { w_door_bench: 6400.0 } }],
  traveller: { job, name, trait, look, voice, seed, foot, due } | null           // restarts from the lane on load
}
```

* **`sanitizeTown`** (never throws; the same style as `storage.sanitize`):
  * known fields only; finite numbers, clamped;
  * ≤ 20 villagers, unique ids `^v\d{1,4}$`, names ≤ 24 characters;
  * `job` / `trait` / `tpl` / gift ids from the known sets, as **own** keys of those tables (`Object.hasOwn`-style), so
    `toString`, `constructor` or `__proto__` are never "known" (R1 T1.12);
  * `bed` matches `^I\|-?\d{1,2}\|[0-4]\|-?\d{1,2}$`; ≤ 3 feet, each ≤ 400 cells in −11..10; `muted` ≤ 30 feet;
    `campGrants` ≤ 60 strings `^v\d{1,4}\|I\|…$`; `frozen.route` ≤ 64 cells;
  * `recent` ≤ 5, `cool` ≤ 10 entries.
  * A bad villager is dropped; a bad field gets its default; unknown gift ids are dropped. Non-JSON, or not an object,
    gives a fresh town, but `unlocks` and `seen` are salvaged when they parse.
  * A save from before the `w_` prefix never existed in the wild (Phase 1 ships with it), so there is no id migration.
* **Write cadence**: 2 s after a town change (arrival, status commit, wish, grant, unlock, Cozy integer), every 30 s of
  town clock, and on `pagehide` / `visibilitychange → hidden`. An unlock writes `KEYS.unlocks` first, at once.
  **Never** with `nosave=1`, a showcase, `town=0`, `town=fresh`, or a read-only save. A failed write warns once with a
  toast *"⚠️ Can't save your village. This browser's storage is full or blocked."*, then stays quiet.
* **Two tabs**: index.js listens to `storage` events. When another tab writes `KEYS.town`, this tab becomes read-only
  for the rest of the session (it keeps running, never writes the town key again) and shows *"🏡 Your village is open
  in another tab. [Reload]"* once. So the last writer can't silently undo the other tab's new villager.
* **Versioning**: `v: 1`. `store.js` keeps a `migrate(obj)` chain (`v1 → v2 …`) for later phases. A save with
  `v > VERSION` (an older cached game meeting a newer save) loads what it understands but is **never written**, so
  newer data is never clobbered.
* **Migration**: builds need none (no build format change). The first run with this feature has no key → a fresh town
  (random seed, warmth 10). If an autosave with pieces exists, the intro card asks first (§1.3); then existing homes
  are detected and the first traveller comes. Old settings files lack `village` / `chatter`, so the defaults (on)
  apply.
* **Nothing lost while away**: positions, poses and bubbles are not saved. On load the restore recompute (§3.5)
  re-binds and re-seats everyone from the schedule, silently, and the clock resumes exactly where it stopped.
  `lastSeen ≥ 30 min` ago → the welcome-back toast.
* Size: ≤ 8 KB for 20 villagers.

### 12.10 How the town meets everything that exists

| Action | What the town does |
|---|---|
| Place / remove / paint / draw stroke | Debounced recompute (§3.8). Wishes re-checked. Villagers on newly blocked cells hop. |
| Undo / redo | A world change like any other: re-binding (§3.5). **Granted wishes, Warmth, gifts and unlocks are never taken back.** |
| Blueprint stamp (Place it instantly) | One recompute after the burst; normal pacing (first villager 5 s). |
| Clear & start / New build | The clear empties every home: after 3 s of quiet the residents commit to camping, with **one** summary toast. The stamp's home then takes campers first (3 s), with one *"moved into the new houses"* toast. Undo within the settle time changes nothing; later, it restores homes, and residents re-bind by stored footprint. |
| Load slot / share code (`world.load`, `record: true`) | Recompute; residents re-bind to any of their last 3 footprints, else move into the loaded build's free beds, else camp: one summary toast. Undo, or loading the other slot again, moves them back. |
| Share codes | Pieces only, format unchanged: a friend gets your houses, not your villagers. Gift pieces load for everyone. |
| Autosave restore at boot | The first recompute runs on `ready`, after the restore (§3.8), as a silent restore: no events, toasts or walks; the same build gives the same bindings; a missing home puts its residents straight at the camp with one line on the town card. |
| Photo mode | Villagers drawn; bubbles, cards, highlight and follow off; taps do nothing. |
| Guided mode (active and unfinished) | Homes computed; arrivals and new wishes paused; bubbles dimmed; Show me only frames; at the finish campers return first, else a traveller after 4 s, whether or not the finished guide card is still open. |
| Static batching | Untouched: town objects never enter `world.root`, never use layers 1/2, never tween pieces. Gift pieces are ordinary batched pieces that add no material. `batch-regress` passes unchanged with `town=0`, and with `HW_TOWN=1` (`town=fresh&townrender=0`). |
| Picking | `world.pick` never sees villagers (not in `world.root`). The town wraps `rig.onTap` / `onPress` / `onAimEnd` only (§12.7). |
| Cutaway (`setView`) | Indoor villagers on hidden levels are hidden; outdoor ones always show. |
| Time of day / Let the day pass | Sky time picks the phase; pinned loops (§5.4); villagers fade out while the slider moves and re-seat 0.4 s after it stops; the game never changes `timeFlow` except through the player's own tap on the tip or the card. |
| Season / weather | No effect in Phase 1 (hooks, §16). |
| Villagers off | Nothing drawn, ticked, chattered or written; data kept; gifts stay unlocked. |
| Tab hidden / app closed | Clock frozen; one save on hide. |
| `?nosave=1` | The town is read but never written. |
| `?showcase=…` | The town is off for that load (gift unlocks still show, read by gifts.js, §8.3). |
| `?ui=0` | The town runs (villagers visible), with no hud. |
| Offline PWA | All new files are in `CORE`; `VERSION` 5 (§12.6). |
| Two tabs | The second writer turns the other tab read-only with a Reload offer (§12.9). |
| An older cached version | Skips unknown gift pieces when loading (`dropped`) and, with the main.js guard (§12.6), never overwrites that autosave with a camera-only flush; an edit there still saves (§17). |

### 12.11 Performance budgets (measured by `town.debug.stats()` and the regress)

| Item | Budget (desktop headless; ×3–5 on a mid-range phone) |
|---|---|
| Extra draw calls, 20 villagers of 8 jobs + campers, no highlight | ≤ 14 (target ~11) |
| … with a Show me highlight | ≤ 20 (the highlight adds exactly 2: the rings and the one-mesh ghost, R2 T2.4) |
| Extra triangles, 20 villagers | ≤ 20k (no highlight) |
| … with a Show me highlight | ≤ 20k + the ghost piece's own triangles, i.e. ≤ 22.6k: the ghost is one copy of the piece the player is about to place (the largest wish piece is the apple tree, 2,570) |
| `actors.update` + bubbles, per frame (EMA) | ≤ 0.3 ms |
| `sim.tick` (4 Hz), 20 villagers | ≤ 0.1 ms average |
| Recompute (`buildWorldModel` + re-binding + wish checks) | ≤ 1.5 ms on a blueprint lot, ≤ 4 ms on a 1,000-piece lot; at most 2 Hz. Typed arrays over the 22 × 22 grid (the string-keyed prototype of this rule took 1.0–1.65 ms for detect + nav on the farmhouse) |
| A* plans | ≤ 0.1 ms each, ≤ 4 per frame |
| Bubbles | ≤ 10 `transform` writes per frame, ≤ 6 shown, skipped when the camera and anchors haven't moved; occlusion rays ≤ 2 per frame at 4 Hz per bubble |
| First traveller / first villager drawn | 0 new shader programs (compiled behind the loading screen, §12.8); worst frame ≤ 50 ms headless while it appears. Headless SwiftShader frames take 90–200 ms whatever the town does, so R3 checks the frame's main-thread work (render submit + town + hud) ≤ 50 ms and reports the raw frame times (M1: ≈ 20 ms in the traveller's first frame: town 3.6, hud 7.8, render submit 8.2) |
| Shadow pass | 0 extra calls; the town never sets `shadowMap.needsUpdate` |
| Geometry memory | < 1 MB |
| Save size | ≤ 8 KB |
| Phone (owner's mid-range device) | `app.fps` median ≥ 45 on the `PERF_TOWN` lot (§13.4 R11) with 20 villagers, ≥ the same scene with `town=0` minus 5 fps; no visible hitch when the first traveller appears (profiled once, noted in the playtest build's notes) |

*Measured (M3), headless Chromium + SwiftShader on an iPhone 13 viewport (390 × 664, UI on), on a loaded 4-core
machine (fps there is the rasteriser's ≈ 10, meaningless):*

| Scene | Town draw calls | Town triangles | Per-frame main-thread work (median / p95) | Town EMAs |
|---|---|---|---|---|
| Farmhouse, `spawn=20` (1 resident, 19 campers at the lane camp) | 12 (137 vs 125 with the group hidden); 14 with a Show me highlight, any of the 18 wishes feasible there (R2: 21–23 for 7 of them before the ghost was baked into one mesh) | 19,574 (19,054 since R1; 19,452–21,080 with a highlight) | whole frame 3.8 / 9.8 ms (`town=0`: 3.3 / 7.5); render submit 3.1 / 8.0 (`town=0`: 3.1 / 7.4); town update 0.3 / 0.9; hud 0.1 / 0.5 | update 0.24 ms, actors 0.12 ms; recompute median 1.2 ms (0.9–4.2) |
| `PERF_TOWN`, 20 residents | 10 (44 in total) | 17,334 | — | update 0.33 ms, actors 0.13 ms |
| R1 (square lanterns): farmhouse `spawn=20` at 0.42 / 0.75 / 0.9 (10 tents; 20 lanterns at dusk and night) | 12 / 12 / 12 | 19,054 / 19,534 / 19,708 (21,268 at night before) | — | — |
| R1: `PERF_TOWN` cleared, 20 campers, 0.9 (R11's night case) | 13 | 19,654 | — | — |

`sim.tick` with 20 villagers: 0.10–0.11 ms per tick in a tight `advance` loop and 0.17–0.30 ms per tick measured
live between frames (Chromium's coarsened `performance.now`, cold caches, the loaded machine), i.e. ≤ 0.08 ms per
frame at 60 fps for the 4 Hz tick; B9's own measure (desktop, 20 residents) is 0.049 ms. The owner's phone row above
is still to be profiled on the device.

### 12.12 Dev URL parameters (validated like main.js's; malformed values are ignored)

| Param | Effect |
|---|---|
| `town=0` | Villagers off for this load (the setting is not changed). The module loads; `enabled()` is false; nothing drawn, ticked or saved. index.js then imports no other town module, leaves the rig unwrapped and runs no recompute (`ready` stays false); the same holds for a showcase. `unlock` still applies. |
| `town=1` | On for this load even if the setting is off. The player's own **Villagers & wishes** switch still wins during the session: the first `village` change drops the override (M2, R16). |
| `town=fresh` | On for this load, with a fresh in-memory town (the saved one is untouched and never written); the switch wins the same way. |
| `townrender=0` | The town runs (sim, recomputes, rig wrapping, events) but draws nothing and hit-tests nothing (§12.8); `batch-regress` uses it with `HW_TOWN=1`. |
| `townseed=n` | Seed for a fresh town (integer 0..4294967295): with `town=fresh`, or when the profile has no town key yet. |
| `townspeed=n` | Town clock × n (number 1..120). With `timeFlow` on, the sky flows ×n too (index.js advances `state.time` itself). |
| `spawn=gardener,baker` / `spawn=n` | After the first recompute, move these jobs (or n villagers, cycling `JOB_ORDER`) straight into free beds, else camp; no walk (then one more recompute, since camp tents block nav). |
| `wish=<tpl>` | The first villager gets this wish (console.warn with the reason if impossible): at once after `spawn`, else at the first move-in. |
| `cozy=n` | Set Warmth so Cozy ≈ n (0..100). |
| `unlock=all` / `unlock=id,id` | Unlock gifts for this load (not saved); applied even when the town is off for the load (`town=0`, showcases). |
| `townnav=1` | Overlay: nav costs (green → red), hop/wall edges, home outlines (green Home, amber almost + reason), doorsteps, spots. |
| `townhud=1` | Dev HUD (top-left text): villagers (+ traveller / passer-by), open wishes, the hearth number (Cozy, tier, warmth + charm, floor), clock, day, speed, sky time and phase, % of town time with ≥ 1 villager outdoors, slips, recompute ms (model ms), tick ms, actor ms, update ms, town draw calls and triangles, homes, and each villager's status / activity. |
| `townlog=1` | `console.log` every town event. |

Example: `node tools/shot.mjs --mobile --query "bp=cottage&nosave=1&town=fresh&spawn=gardener,baker&time=0.74&townnav=1" --out /tmp/evening.png`

### 12.13 In-page debug API (`window.__hw.town.debug`; `who` = id or name)

```
state()                     → JSON snapshot: roster (id, name, job, trait, status, homeId, bed, feet, grants, cell, loc,
                              plan, pose, act, wish), traveller, passerby, homes, wishes, cozy, clock, day, unlocks,
                              stats, tents, note, readOnly, params (deterministic: R12 compares it between two pages)
homes()                     → [{ id, name, cells, ground, levels, rooms, beds, capacity, residents, home, reasons, flaws,
                              doors, doorway, gaps, unroofed (counts), doorsteps ([x,z] pairs), fit, best }]
recipes()                   → per home { id, name, met, fit, missing, best, runnersUp }
spawn(job?, { name, trait, travel })  → id      (travel: walk in from the lane)
traveller(job?) · passerby()
wish(who, tpl)              → { ok, reason, plan }
plan(who)                   → the open wish's current SpotPlan (re-targets like Show me)
grant(who, { build: true }) → places the plan's recs in order with world.add(…, { record: true }), recomputing after
                              each (the real path), until done → { granted, placed }
edit(fn)                    → runs fn(world) at the next tick boundary, then recomputes and calls setWorld
                              synchronously (no debounce, no frame timing); returns a Promise of the new world.version
                              (it runs at once while the town isn't ticking: hidden, off, before `ready`)
expire(who) · cozy(n) · speed(k) · unlock(id) · unlockAll()
advance(seconds)            → deterministic ticks with the current context → the town clock. While time flows the sky
                              moves with the town clock during the advance (TICK / DAY_SECONDS per tick) and
                              state.time is set at the end (not a slider jump); the actors catch up by themselves
step(n)                     → n ticks of 0.25 s (the same way)
phase('morning'|'day'|'evening'|'home'|'night')  → sets state.time to mid-phase
nav()                       → ASCII map (# blocked, ~ hop edge, | wall edge, . free, D doorstep, T tent, L lane cell)
path([x,z], [x,z])          → { len, hops, slips }
stuck()                     → [] (the invariant of §6.3)
outdoors()                  → share of town time since load with ≥ 1 villager outdoors (0..1)
select(who)                 → emits town-select and follows
stats()                     → { calls, tris, instances, updateMs, tickMs, recomputeMs, plansPerSec, slips, maxFrameMs,
                              recomputes, ticks, modelMs, setWorldMs, afterMs, actorMs }; maxFrameMs is the longest
                              frame since the previous stats() call (each call starts a new window), so a test reads it
                              once before and once after. updateMs = the EMA of the whole town update (ticks + actors),
                              actorMs = actors.update's own EMA, tickMs = the sim's mean tick. calls / tris count only
                              what is really drawn: 0 / 0 while the town group is hidden (villagers off) or not in the
                              scene (`townrender=0`) (R1 T1.14)
snapshot()                  → the sanitized save object
reset({ keepUnlocks: true })
parts()                     → { name: { ok, missing:[exports], error } } for the brain / body modules index.js imports
                              (data, store, model, nav, recipes, wishes, sim, actors; M1: all imported at boot, and a
                              missing or incomplete one turns the town off for the session with one console.error)
loadParts(names?)           → imports modules not loaded yet (since M1 everything is wired at boot; kept for tests)
following()                 → the id the camera follows, or null (M1, for R17)
sim · actors · model        → getters for tests and the dev HUD (M1; not a contract)
crash(where = 'update')     → test hook: throws inside the town at its next update ('api': at once in a guarded call),
                              so tests can check that a failure turns the town off for the session and building goes on
```

index.js also exports two pure helpers for Node tests: `parseParams(URLSearchParams)` (§12.12, malformed values
ignored) and `phaseAt(skyTime)` (the steady schedule's phase, §5.2).

---

## 13. Build plan (four parallel work packages)

### 13.1 Ownership (disjoint: a WP edits only its own files)

| WP | Name | Creates | Edits |
|---|---|---|---|
| **WP1** | Town brain (pure logic) | `js/town/data.js`, `rng.js`, `homes.js`, `nav.js`, `recipes.js`, `wishes.js`, `model.js`, `sim.js`, `store.js`; `tools/town-brain.js` | — |
| **WP2** | Town body (3D) | `js/town/look.js`, `render.js`, `actors.js`; `js/pieces/gifts.js`; `tools/town-look.js` | — |
| **WP3** | Town face (DOM + sound) | `js/town/hud.js`, `css/town.css`; `tools/town-hud.js` | `js/ui.js`, `js/audio.js`, `index.html` |
| **WP4** | Town spine (integration) | `js/town/index.js`; `tools/harness.mjs`; `tools/town-regress.mjs` | `js/main.js`, `js/state.js`, `js/env.js`, `js/catalog.js`, `sw.js`, `tools/batch-regress.mjs`, `docs/ARCHITECTURE.md`, `README.md`; commits `docs/LIVING.md` (this file) |

Tests: `tools/town-brain.js`, `tools/town-look.js` and `tools/town-hud.js` are `shot.mjs --script` bodies (they run in
the page and `return` a report). `tools/town-regress.mjs` is a Node runner on **`tools/harness.mjs`** (`import {
startServer, launch, openGame, saveDataURL, helpers } from './harness.mjs'`; it also exports `ROOT`, the second helper
script `helpers2` and `injectHelpers(page)`, which adds both), the side-effect-free module M0 carves out of
batch-regress.mjs (§12.6): importing it starts nothing and never exits. All exit or report non-zero on failure. None
of them are in `CORE`.

### 13.2 Shared interfaces each WP codes against (and how it stubs the others)

| WP | Provides | Consumes | Stubs while the others aren't there |
|---|---|---|---|
| WP1 | §12.3 contracts; the data.js, rng, homes, nav, recipes, wishes, model, sim and store APIs (§12.4). **data.js lands first** (day 1), since gifts.js imports `GIFTS` / `KEYS` from it | `config.js`; the world through `buildWorldModel` inputs; catalog defs by injection (`defOf`) | none needed: tests import the modules by absolute path (`await import('/js/town/sim.js')`) inside a real page and use the real world and blueprints |
| WP2 | `createActors(app)` (§12.4); gift pieces | `VillagerModel`, `Plan`, `Cue`, `SpotPlan` (§12.3); `data.js` `GIFTS` / `KEYS` (§12.4, written out in full there, so WP2 can paste it into a local stub until WP1's file lands); `materials`, `geom`, `catalog`, `world.buildPlaced` | `tools/town-look.js` hand-writes 20 `VillagerModel`s with plans (walk loops, sitting, lying inside, working, fishing); the nav is not needed because plans carry y |
| WP3 | `createHud(app, mounts)`; the ui.js, audio.js and CSS changes | `TownAPI` (§12.4), bus events (§12.5) | `tools/town-hud.js` builds a fake `TownAPI` (canned `view()`, `bubbles()`, `cozy()`, `giftInfo()`, `showing()`, recording `showMe` / `follow` / `muteHint` / `answerIntro` / `endShowMe` calls), sets it as `app.town`, and calls `createHud` on a fresh mount; emits bus events by hand. Until WP4's `setHidden` lands, the test flips `def.hidden` directly. |
| WP4 | `TownAPI`; the core edits; the harness; the regress | everything | **M0 skeleton first** (below): index.js returning the full `TownAPI` shape with empty data, so WP3 can run on the real object early |

### 13.3 Order and milestones

1. **M0 (WP4, first)**:
   * the core edits (main.js loader + frame hook + autosave guard, state keys, env exports, `catalog.setHidden`);
   * `tools/harness.mjs` carved out of batch-regress.mjs, and batch-regress's `town=0` / `HW_TOWN=1` query rule;
   * an `index.js` skeleton: params parsing, the `TownAPI` shape with empty data, the rig wrapping, `enabled()`, the
     `ready`-event restore hook (an empty recompute).

   The game must still boot with zero errors and pass `batch-regress` in both modes. WP1, WP2 and WP3 don't wait for
   M0: they test standalone.
2. **WP1, WP2, WP3 in parallel**, each to its own acceptance (§13.4).
3. **M1, vertical slice (WP4 with WP1 + WP2)**: homes (all of §3.1), nav, the boot restore, the guided rule, the
   Gardener only, three wishes (`w_door_flowers`, `w_door_bench`, `w_shade_tree`) with Show me and tap snapping, Cozy
   and the hearth number in `townhud`. Arrivals, routines (with the granted-piece use), the passer-by, the lane, the
   camp. Run R1–R3, R6, R7, R11, R12, R17. **Feel check with the owner here** before filling in the other seven jobs
   and the rest of the catalogue: if watching Mabel isn't fun, fix that first.
   *M1 status:* index.js drives the real sim and actors with everything WP1 built enabled (all 8 jobs and all 43
   templates, gifts, hints, the camp); Show me and tap snapping work for `w_door_flowers`, `w_door_bench` and
   `w_shade_tree` (and any plan the sim returns). R1–R3, R6, R7, R11, R12 and R17 pass in `tools/town-regress.mjs`,
   with batch-regress in both modes.
4. **M2 (WP4 with WP3)**: the hud on the real API. All jobs, all templates and plans, gifts. Run R4, R5, R8–R10, R15,
   R16, R18–R21.
   *M2 status:* the hud runs on the real TownAPI; R4, R5, R8–R10, R15, R16, R18–R21 are in `tools/town-regress.mjs`
   and pass with everything from M1; the owner-feel-check fixes (night strolls, sleepers' heads, the first chore and
   first wish, fire-circle seats, the nameplate and hearth tip, fire-pit smoke, bubbles at the edges, the stamp's
   framing, the lingering dusk, the passer-by and the welcome card, the indoor glow, the ghost's bob, hud strings, 💤
   beside a shared anchor, walkers off flower beds) are in, plus the §9.2 Cozy effects (gait, skip, waves, humming),
   the 🎁 gift bubble and the shed's town-card line. A `feel` section checks sleepers' heads.
5. **M3**: docs, `sw.js`, the full `town-regress` + `batch-regress` (both modes), phone profiling, playtest build.
   *M3 status:* `sw.js` `CORE` holds all 47 files the game loads (the 14 town modules, `gifts.js` and `town.css`
   included), `VERSION` 5. Offline under a `/hearthwood/` subpath (a GitHub-Pages-like server, Playwright offline): the
   v5 worker stores the whole set; with the network down, a reload boots from it with 0 requests reaching the server,
   a cottage stamp brings a traveller who moves in and is drawn, `spawn=4` on the farmhouse draws 4 villagers, gifts
   register; a returning player on the v4 worker updates to v5 (the v4 cache deleted) and boots offline with
   villagers. README (a *Villagers* chapter: homes, jobs, days, wishes and Show me, Cozy, gifts, almost-homes, watching,
   never lost, the quiet meadow, the intro card, the day passing by default; Settings; keys; the tools; the URL params)
   and ARCHITECTURE.md (a *Town* section: the module table, boot and per-frame wiring, the TownAPI, input, the drawing
   rules, persistence, state keys, gift pieces, the core hooks, events, params, tests) describe the feature. These
   pass: the full `town-regress` (146 checks; R13 run separately), B1–B12, L1–L11 (desktop and phone), H1–H15 (phone,
   landscape, desktop), and `batch-regress` 48/48 with `town=0` and with `HW_TOWN=1`. 71 dev-URL loads on desktop,
   phone and landscape (every blueprint, showcase and core param, every town param, malformed values) show no console
   errors; the one console message is §12.12's intended warning for `wish=w_door_bench` on the cottage, whose door
   already has a bench. §14.1 item 2 was checked per blueprint (each with a bed gets a move-in; the shed shows no
   almost bubble over 200 s and is listed on the town card), and item 3 end to end with real touch (fresh profile, no
   dev params: welcome card → Follow a blueprint → Place it instantly → move-in 34.5 s later → first wish 35 s after
   that → granted with 3 taps, portrait and landscape). Phone-viewport profile: §12.11 *measured (M3)*.

### 13.4 Per-package acceptance (scriptable; the expected values are this spec's)

**Fixtures** (shared by B, R and the Appendix A prototype; `tools/town-brain.js` and `tools/town-regress.mjs` each
build them with `world.add(…, { record: false })` after `world.clear`):
* `SMALL_HOME(x0, z0)` = foundations at x0..x0+1 × z0..z0+1; walls round them, with a `wall_door` on the +Z edge at
  x0; `roof_flat` (y 1, h 0) on the 4 cells; a `bed` at (x0, 0, z0). It is the `home()` helper of the review scripts
  and of `reviser/home2-proto.js` (Appendix A).
* The §3.2 review fixtures V1–V5, A1, S1–S3, G1–G9, exactly as listed in Appendix A.
* Nav fixtures on `SMALL_HOME(0, 0)`: **N1** a `fence_picket` ring round cells (−2..3, −2..4) with no gap; **N2** a
  `hedge` round the whole lot edge; **N3** a `wall_half` ring round the same cells with a `wall_arch` at the front
  (x 0, z 5); **N4** N1 with `path` on (0, 2..5); **N5** a picket fence across the row in front of the door (x −1..1,
  z 3) and the rest of N1's ring without its front side.
* `HOME4(x0, z0)` = foundations x0..x0+3 × z0..z0+1, walls round them with a `wall_door` on the +Z edge at x0 + 1,
  `roof_flat` on the 8 cells, a `bed` on each of (x0..x0+3, z0). `PERF_TOWN` = `HOME4` at (−9, −9), (1, −9), (−9, −3),
  (1, −3) and (−4, 4): 5 homes × 4 beds.

**WP1, `tools/town-brain.js`** (`node tools/shot.mjs --query "clean=1&nosave=1&ui=0&town=0" --script tools/town-brain.js`; returns `{ fails: [], … }`)

| # | Check |
|---|---|
| B1 | Stamp each blueprint and build every §3.2 variant and review fixture; `detectBuildings` matches both §3.2 tables exactly (cells, ground cells, levels, rooms, beds, doors incl. `doorway`, gaps, unroofed, home, reasons, doorsteps) and the veranda counts (Log Cabin 4 cells, Farmhouse 5, V1–V4b 2, V5 two of 2, G7 one of 2), G10–G12 included (R1). |
| B2 | `evalRecipes` per blueprint home: Cottage `gardener 2.0, beekeeper 1.0, baker 1.0`; Farmhouse `gardener 1.33, farmer 1.5`; Log Cabin and A-Frame `woodcutter 1.0`. `chooseJob` with an empty roster → cottage `gardener`, farmhouse `farmer`, log cabin and A-frame `woodcutter`. Semis (no recipe) → first-friend `gardener`. |
| B3 | Nav on every blueprint lot, N1–N5 and V3: every doorstep in `mainRegion`; no free cell outside `mainRegion`; `path(laneCell, DOOR1)` has `ok` and 0 slips. Blueprint lots: 0 hops and 18 ≤ len ≤ 45 m (the cottage's hedge and the farmhouse's fence send it round to the gate). N1 and N2: exactly 1 hop; N3, N4, N5: 0 hops; V3: 1 hop (the half wall). Each of N1–N5 gives `w_door_bench` a complete plan whose first rec keeps every doorstep in `mainRegion`. A cottage with one roof panel removed leaves no free pocket cell. |
| B4 | Every template in §7.3: on a fixture lot where it is offered, `isDone` is false and `findSpots` returns a complete plan; placing the plan's recs in order with `world.add` and recomputing after each makes `isDone` true, and after each placement `have` counts up by one part item (the checklist). Fixtures:<br>• the cottage;<br>• cottage + a `pond` at (5, 4), for the water and fisher templates;<br>• cottage + `SMALL_HOME(6, −8)`, for `w_path_friend` and `J_post_paths`;<br>• a `SMALL_HOME` with nothing around it and a gardener spawned, for the odd-job wishes. |
| B5 | Determinism: two sims with seed 42 on the cottage, the same scripted edits applied with `setWorld` at fixed ticks (t = 100 remove the front roof row, t = 160 undo, t = 300 add a second bed; never through the debounce) and the same tick contexts (no camera data) give an identical `JSON.stringify(serialize())` after `advance(3600)`. |
| B6 | Never stuck: a villager walled in on 4 edges, a pond dropped on a villager, and a fence ring around a villager all give `stuck()` = `[]` after `setWorld` + 1 tick; the pond case uses a `hop` plan to a cell ≤ 2 away; the fence-ring villager and villagers living in N1 / N2 get **no** hop or slip plan (their cells are in `mainRegion`). |
| B7 | Store: 2,000 random mutations of a valid save (including `feet`, `muted`, `campGrants`, `frozen`) never make `sanitizeTown` throw and always yield a valid save; serialize → sanitize → `createSim` → serialize is identical; a `v: 2` save loads with `readOnly: true`. |
| B8 | Re-binding and settling: (a) cottage resident → `world.clear` → no change before 3 s of quiet, then one `status` event with the camper → undo → `resident` with the same bed key; (b) roof removed and put back within 2 s → 0 events; (c) roof removed 20 s → `waiting`, put back → resident, no `fixed` event, Warmth unchanged; (d) roof removed 70 s (bubble shown) → put back → resident + `fixed` + `COZY_FIX`; (e) an open wish is dropped on commit (no `expired` event, no cooldown) and the next wish comes 60 s after the commit; (f) load the farmhouse (`world.load`, record) → resident in the farmhouse bed, then load the cottage again → back in the cottage bed (feet); (g) two villagers and one bed: the later arrival camps; a new bed → one camp thank-you (+12, once), and moving the bed back and forth gives no second one for the same bed key; (h) a traveller whose target vanishes turns back, is not in `villagers`, and never camps. |
| B9 | Timing (desktop headless): `buildWorldModel` farmhouse average ≤ 1.5 ms over 20 runs; a 1,000-piece lot ≤ 4 ms; `tick` with 20 villagers ≤ 0.1 ms average. On a shared, loaded machine one batch can take twice the next (R1 T1.15), so the budgets are checked against the fastest of seven 20-run batches (farmhouse; five for the big lot and the recompute), with the median and a same-page calibration loop (`calibMs`) reported beside it; the owner's phone profiling keeps the absolute numbers. |
| B10 | Purity: `node -e "import('./js/town/sim.js').then(m => console.log(typeof m.createSim))"` prints `function` (no three, DOM or window at import). |
| B11 | Restore: a sim with 2 homes serialized and re-created on the same world → `setWorld(model, { restore: true })` gives 0 events and identical bindings; with one home erased → its residents are `camping` at once, 0 events, and `note` mentions them. |
| B12 | Cozy: the §9.1 worked examples come out exactly (Cozy 34 at the cottage's move-in, 50 after S, M, M grants; the floor of 17 for a bare home), and a 600 s `advance` with warmth 60 and no grants loses 13–16 points. |

**WP2, `tools/town-look.js`** (`--query "bp=cottage&nosave=1&ui=0&town=0"`; also run with `--mobile`)

| # | Check |
|---|---|
| L1 | `createActors(app)` + 20 hand-made models (all 8 jobs; 6 walking loops, 4 seated on bench / picnic seats, 1 lying in the cottage bed, 2 chopping, 2 fishing, 2 watering, 3 waving): render-call delta ≤ 13, triangle delta ≤ 20k, `stats().updateMs` EMA ≤ 0.3 ms or a tight `update` loop ≤ 0.3 ms, 0 console errors. As B9 (R2 T2.5): the tight loop runs as nine 100-update batches with a short pause between them and is checked against the fastest, with the median and a same-page calibration loop (`calibMs`) reported beside it (on a loaded machine one batch can take several times the next). |
| L2 | `hitTest` at each visible villager's projected chest → that id with pad 12 and 24; 20 px outside the body → `null` with pad 12, the id with pad 24; 60 px away → `null`. |
| L3 | A villager `inside` on level 1: hidden with `state.level = 0, seeAll = false`, shown with `seeAll = true`. |
| L4 | Batching untouched: `world.batcher.stats()` and `world.root.children.length` unchanged; no town object on layers 1/2; `effects.tweens.length` unchanged; `renderer.shadowMap.needsUpdate` never set by the town. |
| L5 | Screenshots (artifacts for review): a lineup of the 8 jobs at 6 m and 30 m (silhouettes must be told apart by hat and tool alone); a night shot (`time=0.9`) with lanterns glowing and spill on the ground and on a deck; a traveller with pack; lying in bed seen through the cutaway; the move-in glow at noon. |
| L6 | `window.__townNoPatch = true` → plain material, no errors, still ≤ 13 calls. |
| L7 | Gifts: the registered defs equal `GIFTS` (ids, names, `gift.job`, `walk`, seat anchors within 2 cm of the built seat surfaces); each gift placed on grass, path, deck, a Floor-2 floor and a flat roof: `world.add` succeeds; the lowest geometry point is within 2 cm of the surface; ≤ 1.5k triangles; same `world.signature` twice; after `batcher.flush()` + settle, `isBaked(entry)` is true; building all ten at their default look creates **no new material** (the `mat()` cache size is unchanged); `?showcase=all` shows all 10; the bread oven adds one smoke emitter (`env.env.emitters.length` + 1). With `KEYS.unlocks` preset to `["gift_gnome"]` before load, the gnome registers with `hidden: false`. |
| L8 | 256 FX particles spawned in one frame → still 1 draw call for FX. |
| L9 | No first-use compile: after `createActors` + `compile(camera)`, showing 20 villagers of all jobs, lanterns, blobs, spill, FX, a tent and highlight rings adds 0 to `renderer.info.programs.length`. |
| L10 | Move-in glow at `time=0.42`: `cue({ kind: 'pulse', home })` lights the opening and ground quads at brightness ≥ 0.7 for 2.5 s (pixel check in the door opening against the frame before). |
| L11 | `highlightHit`: the projected centre of a ring at ground level and the projected top of the ghost bench (spot y + 0.9 m) both return that rec's index, with the house wall behind it; a point 40 px off both → −1. |

**WP3, `tools/town-hud.js`** (run with `--mobile`, `--mobile --landscape` and desktop; `--query "bp=cottage&nosave=1&town=0"`)

| # | Check |
|---|---|
| H1 | 8 fake bubbles → ≤ 6 tappable shown, each within 2 px of its projected anchor; an anchor behind the camera is hidden; photo mode hides all; `enabled() = false` → none; `dim: true` → 40 % opacity. |
| H2 | DOM click on a wish bubble → villager card with name, job, trait, wish text and line, and no pronoun (*her / his / their*) in any town string; **Show me** → `fake.showMe({ villager })` called once and the card closes; Esc closes the card; a `town-select` event opens it. |
| H3 | Hearth: fake `cozy().frac` 0.2 vs 0.9 → the chip's `--cozy` matches; an open wish shows the ember dot and no number; a `town-granted` event makes it flare; tap → town card with resident chips, could-move-in rows and almost rows; **Turn on** sets `state.timeFlow = true`. |
| H4 | Layout at 280 × 560 and at 320 × 568, 360 × 740, 375 × 667, 390 × 844, 414 × 896, portrait and landscape: portrait card bottom ≤ tray top + 1 px; landscape card on the left, not overlapping the rail; the top bar (menu, counter, hearth, floor control, undo / redo) has no overlapping or wrapped controls from 320 px up; the hearth hides only at ≤ 300 px; the piece counter shows beside the hearth above 370 px and hides only at ≤ 370 (H4h, R1 T1.8); Menu has the 🔥 Town row at every width; all buttons ≥ 44 px. |
| H5 | Settings: the Village section has two switches; toggling sets `state.village` / `state.chatter`; after `state.save()` both are in `hearthwood.settings.v1`. |
| H6 | A toast with `action`: `elementFromPoint` at the button returns it, a click runs `fn`; a toast without action keeps `pointer-events: none`. |
| H7 | Keys: T opens the town card, J calls `fake.showMe` for the next wish, Esc closes. |
| H8 | `town-gift` + `giftInfo` → a `.hw-card-gift` ribbon on that card in the Garden tray, a Garden tab dot, and the ⓘ card says "A thank-you from Mabel". |
| H9 | Audio: `app.audio.render(name)` for the 6 new sfx → peak between −30 and −1 dBFS, not clipped, `voicesLeft` 0; `render('ambience', { env: { talkers: 4 × {…} } })` has active RMS ≥ 3 dB above `talkers: []`; with `state.chatter = false` they are equal. |
| H10 | With `app.town = null` (an import failure): no Village section, no hearth, no errors, and gifts listed in `KEYS.unlocks` are still in the Garden tray; existing UI tests unchanged. 0 console errors in all three viewports. |
| H11 | Bubbles and gestures: a pointer down on a bubble that moves 40 px and lifts changes `rig.goal.theta` and opens no card; a still tap opens it; while `rig.mode` is `aim` or `draw`, `elementFromPoint` over a bubble returns the canvas. |
| H12 | Checklist: fake `showing()` with two parts → the chip reads *"🍽️ Table ✓ · Chairs 1/2"*; ✕ calls `endShowMe` once; the chip is still there 120 s later. |
| H13 | Intro card on `town-intro`: **Keep my meadow quiet** → `answerIntro(false)`; **Lovely** → `answerIntro(true)`; a tap outside → `answerIntro(true)`; shown once. |
| H14 | The almost hint card has **Just a shed 🙂** → `muteHint(homeId)`; vacancy and fix-up cards don't. |
| H15 | One `town-status` event with 4 camping changes → exactly 1 toast, *"⛺ 4 villagers are camping by the lane until there are beds"*; with 1 moving change → the single-villager text. |

**WP4, `tools/town-regress.mjs`** (end-to-end, town on; prints PASS/FAIL per check, exit 1 on any failure)

| # | Check |
|---|---|
| R1 | Boot (`clean=1&nosave=1`): no errors, and `__hw.town.ready` becomes true after `ready` although no `world-change` happened; nothing town-drawn before it; with `town=0` the `'town'` group is invisible and there are no `.hw-bubble` elements. |
| R2 | Each blueprint: `debug.homes()` matches §3.2; `debug.recipes()` best job matches B2. |
| R3 | `town=fresh&bp=cottage`: traveller visible ≤ 6 s; `town-movein` ≤ 45 s; event order traveller → movein; move-in toast text; hearth chip visible; `stats().maxFrameMs` ≤ 50 while the traveller appears and `renderer.info.programs.length` unchanged from before the traveller. (Headless, the frame budget is checked on each frame's main-thread work, render submit + town + hud, since SwiftShader's own frames take 90–200 ms; §12.11.) (M2: the section runs in its own browser: SwiftShader's GPU process, shared by every section, carried state from the earlier ones and the traveller's first render submit took 45–70 ms after them vs ≈ 20–30 ms fresh.) |
| R4 | First wish ≤ 40 s after move-in. DOM-click the bubble → card → Show me → `state.pieceId` is the wish's first part piece, the highlight is in the scene, and exactly one `toast` event fired (the town's hint, none from the builder). `builder`-free taps: `rig.onTap` at the projected ring centre (ground) → `town-granted` ≤ 1 s with the rec exactly at the spot, Warmth + gain; a second wish (`debug.wish`) granted by tapping the projected top of its ghost. `builder.undo()` → still granted, Warmth unchanged. Variants: (a) the cottage rotated so its door faces away from the camera → after Show me the view direction is within 1.2 rad of the door's outward direction; (b) starting on Floor 3 (`level 2`) with an outdoor wish → `state.level` 0 and no `toast` from the builder; (c) `w_soft_rug` → `state.level` = the spot's level, `seeAll` false, `rig.goal.phi` ≤ 0.9; (d) `w_supper_table` → after the table is placed the piece in hand becomes `chair` and the rings move, and after two chairs the wish is granted. |
| R5 | Two granted wishes (`debug.grant(…, { build: true })`) → exactly one `town-gift`; the gift is in `catalog.piecesIn('garden')`. Reload (same profile, no `nosave`) → still unlocked. Villagers off → still in the tray. With Playwright routing `**/js/town/index.js` to a 500 (the town fails to import) → still in the tray, no errors outside the module report. |
| R6 | Never evict: remove the roof → `waiting` (after 3 s); after 60 s → a fix-up bubble; undo → resident + `town-fixed`. Remove a roof and put it back within 2 s → 0 `town-status` events. `newBuild()` with 3 residents → exactly 1 camping toast, camp mesh visible; undo → resident with the same bed. Load the farmhouse via `loadBuild(data, { record: true })` → moving day into it (1 toast); undo → back. |
| R7 | Never stuck: wall-box a villager's cell / drop a pond on them / fence them in → `debug.stuck()` empty within 2 s each. Villagers living in N1 and N2 for 10 town minutes (`advance`) → `stuck()` empty and `stats().slips` 0. |
| R8 | Guided: `startGuided('cottage')`, add every guide piece → no traveller while unfinished; at done === total → traveller ≤ 4 s + 0.5 s. **Without pressing Close**, keep running 3 minutes (`townspeed=10`): a move-in happens, a new wish appears, and every bubble has `dim: false`. Erase one guide piece → paused again. |
| R9 | Photo mode: villagers drawn; bubbles hidden; a canvas tap does nothing. |
| R10 | Persistence: reload → same ids, names, wishes, clock ± 1 s; 60 s (the regress uses 15 s: the freeze is all or nothing) with `visibilityState` forced to hidden → clock unchanged; `nosave=1` → the key is byte-identical after a session. Reload a lot with 2 homes → 0 `town-status` events, 0 town toasts, identical bindings. |
| R11 | Budget: `PERF_TOWN` with `spawn=20` (all 8 jobs) → render calls (town on) − (town hidden) ≤ 14; triangles ≤ 20k; town update EMA ≤ 0.6 ms; recompute ≤ 2 ms. Then the night worst case (R1 T1.13): the lot cleared, all 20 camping in 10 tents, time 0.9, every villager with a lantern → ≤ 14 calls and ≤ 20k triangles. A Show me highlight (R2 T2.4): every wish one resident can be given on `PERF_TOWN`, shown in turn → the ghost is one mesh, ≤ 20 calls, ≤ 22.6k triangles (measured: 28 wishes, worst 12 calls, 19,906 triangles with the apple tree). |
| R12 | Determinism: two pages `town=fresh&townseed=7&townspeed=60` with the same scripted edits applied through `debug.edit(fn)` → identical `debug.state()` after `advance(3600)`. (The pages run with `visibilityState` hidden from the first script, so only `edit` / `advance` move the town clock, and each advance starts from a set sky time.) |
| R13 | `node tools/batch-regress.mjs` passes (town off by default), and `HW_TOWN=1 node tools/batch-regress.mjs` (`town=fresh&townrender=0`) passes every check unchanged. |
| R14 | Offline: every file under `js/town/` (14), `js/pieces/gifts.js` and `css/town.css` is in `sw.js` `CORE` (compared against the disk); `VERSION` = 5. |
| R15 | A share code containing gift pieces imports with `dropped` 0; Pick on a placed gift copies it even while it is locked. |
| R16 | Village off → no bubbles, hearth or chatter, clock frozen; on → every villager is re-seated on a free `mainRegion` cell or indoors; no errors. |
| R17 | Passer-by (`--mobile`, fresh profile with the welcome lot): during a pass the passer-by's projected position is inside the free area (inside the canvas minus `rig.insets`) for ≥ 3 s in a row; while off-screen an arrow element is shown; the tip toast has a 👀 Watch button that starts follow. (The test first taps the meadow round the welcome card, as a player would: bubbles stay hidden under it.) |
| R18 | Taps near villagers: a villager on the cottage's doorstep, the Door piece in hand: a tap on the wall at y = 2.0 m above the doorstep, and a tap 20 px beside the villager's body, each place the door and open no card; the same tap on the villager's chest with the Erase tool opens the card. |
| R19 | Migration: a profile with an autosave and no town key → the intro card, no traveller while it is open; **Keep my meadow quiet** → `state.village` false. A second profile: **Lovely** → traveller ≤ `FIRST_ARRIVAL_DELAY` + 1 s later. |
| R20 | Two tabs on one profile: the second page saves the town → the first page shows the Reload toast and writes the key no more (byte-identical after 60 s of play there). |
| R1 (`repair1`) | Round-1 repairs (T1.x), real touch on an iPhone 13 profile: a full Home with a camper waiting names the camper on the "Could move in" row; Follow survives a pinch out / in, a one-finger-still pinch and a twist, and a two-finger slide ends it; the "one more bed" Show me ends once the ghost bed is tapped; undoing a clear says "back home", a camper into a new hut "moving into"; no vacancy bubble for a bed a camper is about to take (stepping the town clock tick by tick). |
| R2 (`repair2`) | Round-2 repairs (T2.x), real touch on an iPhone 13 profile: the camp bubble high on screen is never covered by its one-time tip toast and goes back under its anchor once the toast has gone; the camp Show me with no Home (and the `w_neighbour` one) draws its ghost foundation as one mesh with a finite box, `highlightHit` at the free area's four corners is −1, and with the foundation in hand a tap on grass far from the rings builds there while a tap on a ring builds on it; after a reload with the tray collapsed the handle reads "Show pieces" (`aria-expanded` false). |
| R21 | Life you can watch: `PERF_TOWN`, `spawn=20`, `timeFlow` on, `townspeed=60`, `advance(3600)` → `debug.outdoors()` ≥ 0.85; time pinned at 0.42 → ≥ 0.95. (M2 also checks that after the hour, at 10:00, nobody is asleep or on a night stroll.) |

### 13.5 Rules for working in parallel

* The **spec owner** (the WP4 lead) owns §12 contracts. A change to a contract is a one-line spec edit announced to
  all WPs, never a silent change in code.
* No WP edits another WP's files or an unlisted existing file (§12.6 "Not edited").
* Every user-visible string lives in `data.js` (`LINES`, template text, job and trait labels) or `hud.js` (toasts,
  card labels). Nothing is hard-coded in sim, actors or index except logs.
* Every random choice in the sim goes through `rng.js` with a seed derived from the town seed and the villager seed;
  `Math.random` is allowed only in cosmetics (actors' bob phases, audio).
* `try/catch` at the module boundary: a town failure must never stop building. index.js disables the town for the
  session and reports with `console.error` once (as main.js does for other modules).

---

## 14. Phase-1 acceptance criteria and the owner's playtest

### 14.1 Acceptance criteria (all must hold to ship Phase 1)

1. All of B1–B12, L1–L11, H1–H15 and R1–R21 pass. `tools/batch-regress.mjs` passes unchanged with `town=0` and with
   `HW_TOWN=1`.
   `tools/shot.mjs` runs of every existing dev URL show no new console errors.
2. Every blueprint with a bed attracts a villager; the Tiny Garden Shed (4 cells, no bed) never nags: no almost
   bubble, and its town-card line is the only hint. Every §3.2 review fixture with a bed is a home.
3. From a fresh profile, stamping the cottage gives a move-in in ≤ 45 s, a first wish ≤ 40 s later, and that wish can
   be granted in 3 taps on a phone (portrait and landscape).
4. Nobody is ever stuck (`stuck()` empty in every regress scenario) and nobody slips on an ordinary route
   (`stats().slips` 0). No action of the player removes a villager. No undo takes back a reward or a gift.
5. Draw-call and CPU budgets of §12.11 are met; on the owner's mid-range phone the farmhouse lot with 20 villagers
   holds a median `app.fps` ≥ 45.
6. Villagers off gives today's game exactly: no town draw calls, no chatter, no hearth, the clock stopped. Gifts
   already unlocked stay in the tray, even if the town module fails to load.
7. Saves, slots, share codes, photo mode, guided mode, undo/redo and offline install behave as before, apart from the
   villagers on screen. A reload, a slot load or a clear brings at most one status toast; a finished guide never
   leaves the town paused.
8. README and ARCHITECTURE.md describe the feature; `docs/LIVING.md` is this spec, with any changes made during the
   build folded in.

*Status at M3 (headless):* items 1–4, 6–8 hold (the suites, real-touch runs and offline test of §13.3 M3). Item 5:
every §12.11 budget passes its own headless test (R3, R11, B9, L1, L9; §12.11 *measured*), though `sim.tick`
measured live between frames on a loaded machine is 0.17–0.30 ms, above the 0.1 ms tight-loop budget; the phone
median `app.fps` ≥ 45 needs the owner's device.

### 14.2 Playtest checklist for the owner

Play on your phone, fresh profile (or Menu → Settings → **Villagers & wishes** off and on to compare).

1. **First visit.** Did you notice the passer-by waving from the stepping stones? Is the welcome line clear?
2. **First home.** Stamp the cottage. How long until Mabel arrives? Did you watch her walk in (👀 Watch)? Did the
   move-in moment (knock, chimney puffs, lights on in the door and windows, hearts, jingle) feel like a payoff at
   midday?
3. **First wish.** Did you understand the bubble without help? Did **Show me** make it obvious where to tap, and did
   your tap land on the glowing spot? For a two-piece wish, did the checklist make the second piece obvious? Did Mabel
   visibly enjoy and then use what you placed?
4. **Free build.** Build a small house yourself (try walls straight on the grass, a covered porch, an open doorway).
   Did it count as a home when you expected? Do the grey "almost a home" bubbles help or nag? Did you use **Just a
   shed**? Is one forgiven gap the right amount?
5. **Life you can watch.** Leave the game alone for 2 minutes at the default time. Does the town feel alive while
   pinned? Now take the "Let the day pass" offer: are morning, work, evening and night readable, and is someone
   still out with a lantern at night? Peek inside at night with the cutaway: are they asleep in their beds?
   (`townhud=1` shows the share of time with someone outdoors.)
6. **Pull, not pressure.** After 15 minutes: did the wishes feel like invitations or a to-do list? Was 3 open wishes
   too many? Did any wish feel impossible or confusing?
7. **Cozy.** Did you notice the hearth getting brighter? Did the town card explain what warms the town?
8. **Gifts.** When the first thank-you gift arrived, did you place it? Do the gifts look like Hearthwood pieces?
9. **Editing.** Knock the roof off an occupied house, undo, clear the meadow, load a slot and load it back. Did
   anything feel like a loss, or bring a pile of toasts? Was the tent camp charming or sad?
10. **Sound.** Is the chatter cozy or annoying at 6+ villagers? Are the chimes too loud next to the music?
11. **Phone feel.** Any stutter with many villagers? Did tapping a villager ever steal a build tap you meant?
12. **The big one (GDD).** Is watching villagers fun enough to build Phase 2 on? What would make you build one more
    house tonight?

Questions to answer for the next phase: the time default (pinned + offer, or flowing once a villager exists?), one
global town vs per-save towns, the one-flaw slack, `MAX_OPEN_WISHES`, whether the Postie's two-home requirement felt
like a goal or a wall, and the job change at the cap (§17).

---

## 15. Tuning table (all in `js/town/data.js` `TUNE`; "first" = what to tune first in the playtest)

| Constant | Default | First? |
|---|---|---|
| `FIRST_ARRIVAL_DELAY` | 5 s | **1** (time to first delight) |
| `TRAVELLER_SPEED` | 1.6 m/s (walk-in ≈ 26 s to a central home) | **1** |
| `LANE_START` | `LANE[2]` (17.7 m of lane) | **1** |
| `FIRST_WISH_DELAY` | 30 s (first villager), 60 s (later ones) after stepping out | **2** |
| `WISH_GAP` | 150–300 s per villager (×2 for dreams) | **2** |
| `MAX_OPEN_WISHES` | 3 (the camp wish is outside it) | **2** (pull vs pressure) |
| `WISH_TOWN_SPACING` | 40 s | 2 |
| `WISH_LIFE` | 900 s (S, M), 1500 s (L) | 8 |
| `WISH_COOLDOWN` | 1200 s per template per villager | 8 |
| `REWISH_AFTER_MOVE` | 60 s after a binding change commits | 8 |
| `WALK_SPEED` | 1.25 m/s; hurry ×1.6; grant rush ×1.3 | **3** (liveliness) |
| Activity durations | work 60–120 (pinned 50–90), break 20–40 (pinned 25–45), chore 15–30, hangout 60–120, pop home 20–40, chat 10–20 s | **3** |
| `GRANT_USE` | 120 s: the granter uses the granted piece, whatever the phase | **3** |
| `NIGHT_STROLL_EVERY`, `NIGHT_STROLL_LEN` | 90 s, 30 s (flowing and pinned) | 3 |
| Schedule | wake 05:30, morning to 08:30, day to 17:00, home 21:30, sleep 23:00; trait shifts §5.2; jitter ±0.4 h | 3 |
| `COZY_WISH` S / M / L | +6 / +8 / +12, tapered by (1 − warmth / 60), at least +1 | **4** (does the hearth visibly move?) |
| `COZY_MOVEIN`, `COZY_FIX` | +4, +3 (tapered the same way) | 4 |
| `WARMTH_START`, `WARMTH_MAX` | 10, 60 | 4 |
| `COZY_DRIFT_EVERY` | −max(1, warmth / 20) per 120 s of town clock | 4 |
| `CHARM_MAX`, `CHARM_SCALE` | 40 × (1 − e^(−S / 30)), S = Σ kinds over lived-in homes | 4 |
| `COZY_FLOOR` | 15 + 2 × min(population, 10) | 4 |
| Tier bounds | 25 / 50 / 75 | 4 |
| `GIFT_AT` | 2, 4, 7, 10, 14, 18, 23, 28, 34, 40 | **5** |
| `BUBBLE_MAX`, size, cull | 6, 38 px (48 px hit), 45 m | **6** |
| `ALMOST_DELAY`, `ALMOST_SHOW`, `SHED_CELLS` | 8 s, 60 s once per building, no bubble for bedless ≤ 6 cells | **6** (help or nag?) |
| `VACANCY_SHOW` | 90 s, back on a tier change or a nearby recipe piece | 6 |
| `FIXUP_DELAY` | 60 s | 6 |
| `SETTLE` | 3 s of quiet before a status change commits | 6 |
| Show me | no timer; radius 14–26 m; turn when \|Δθ\| > 1.2 rad; INSIDE φ ≤ 0.9 | 6 |
| `MOVEIN_GLOW` | 0.7 for 2.5 s | 6 |
| Recipe thresholds | §2.2 (3 blooms within 4; 2 farm within 5; woodpile within 3 + 2 trees within 6; pond within 6; hive within 4 + 2 blooms within 2; kitchen + bench within 4; 2 lamps within 6; mailbox within 3 + 2 homes) | **7** |
| `ARRIVAL_BASE` × Cozy curve | 75 s × lerp(1.5, 0.6, Cozy/100) × U(0.85, 1.15) | 7 |
| `RETURN_DELAY`, `GUIDED_ARRIVAL_DELAY`, `TURN_BACK_WAIT` | 3 s, 4 s, 20 s | 7 |
| `HOME_SLACK` | 1 flaw (gap or unroofed cell) | 7 |
| `POCKET_MAX` | 64 cells (ground floors, §3.1) | 9 |
| `HOME_MATCH`, `FEET_KEPT` | 0.3 footprint overlap, 3 footprints per villager | 9 |
| `PASSERBY` | first at 12 s after `ready` (held while a card covers the meadow), every 180 s, ≤ 3 per session; 1.6 m/s; viewing spot §4.7, `PASSERBY_VIEW_BACK` 2 cells up the path | 8 |
| `FIRST_CHORE`, `FIRST_WISH_NEAR` | 20–30 s by the door after moving in; a first wish within 4 cells of a door (one piece, outdoors, S) | **2** |
| `NIGHT_STROLL_WAKE_GAP` | 2.5 h before the villager's wake hour (time flowing) | 3 |
| `HUM_CHEERFUL`, `HUM_GLOWING` | 20–40 s, 10–20 s between hums while walking (§9.2) | 4 |
| `COST_NEAR_BLOOM` | +0.3 on cells beside a bloom | 9 |
| `MAX_VILLAGERS`, `BEDS_PER_HOME_MAX` | 20, 4 | 9 |
| Nav costs | path 0.55, deck/steps 0.8, grass 1.0, ring 1.5, blooms +6, soft items §6.1; `HOP_COST` +25 (fences, hedges, half walls, railings; gates open); wall/blocked +200 | 9 |
| `PATHS_PER_FRAME` | 4 | 9 |
| `SPILL_GAIN`, asleep level | 0.55, 0.15 | 9 |
| `RESEAT_DELAY` | 0.4 s after the last slider jump | 9 |
| Chatter | rate min(0.8, 0.06 n)/s, ×1.5 evening, ×1.5 chatty; gain 0.025; range 12–35 m | 9 |
| `DAY_SECONDS`, `SEASON_DAYS` | 600 s (env.js), 3 (reserved for Phase 3) | — |

**Expected Cozy** after 10, 30 and 60 minutes of play is in §9.1 (40 / 69 / 85 for a player who stamps homes and
grants most wishes; 18 / 35 / 54 for a free builder; never pinned at 100).

In the playtest, watch:
* the time from first home to first wish (target ≤ 75 s);
* whether players tap **Show me** or ignore bubbles, and whether their taps land on the glowing spot;
* whether 3 open wishes feels like a list (if so, drop to 2);
* whether players notice villagers using what they asked for;
* the share of town time with ≥ 1 villager outdoors (`townhud`; target ≥ 85 % flowing, ≥ 95 % pinned);
* how often the almost bubble or **Just a shed** is used;
* whether anyone turns villagers off, or answers the intro card with "Keep my meadow quiet".

---

## 16. Hooks left for later phases (designed in, not built)

| Later phase | Hook in Phase 1 |
|---|---|
| Resources & production (P2) | `JOBS[j].work` has a `produces` slot (gardener → flowers, farmer → veg, woodcutter → logs, fisher → fish, beekeeper → honey, baker → bread, lamplighter → light, postie → letters); the sim emits `work` sim events per finished bout (not on the bus yet); the wish reward is `{ cozy, gift, resources? }` |
| Idle production (P2) | `lastSeen` (wall clock) in the save; `sim.debug.advance(s)` is deterministic, so idle catch-up = `advance(min(away, cap))` with a generous cap (Phase 1 never calls it on load) |
| Adjacency (P2) | `homes.regions()` + the wish predicate kit (`near`, `inside`, `chain`) are the adjacency engine; `charmOf` is already a per-home neighbourhood scan |
| Cozy as multiplier (P2) | `town.cozy().frac` |
| Season cycle (P3) | `town-day` event; `SEASON_DAYS` = 3; templates and lines take an optional `seasons` filter (×1 now); the look has a seasonal accessory slot (`PART` 12/13 pattern) |
| Weather events (P3) | activity tables are data: add `rain` modifiers (porches, umbrellas); nav can mark sheltered cells (roof cover is already known) |
| Milestones (P4) | `stats` counters in the save; every bus event |
| Biomes (P4) | lot entry points are data (`lane` in `buildWorldModel`); recipes are data keyed by piece ids |
| Festivals (P5) | a warmth bump + an "everyone to the plaza" activity on the hangout system |
| Visitors & traders (P5) | the traveller / passer-by machinery: a non-resident actor that arrives and leaves by the lane (`status: 'passerby'` generalises to `'visitor'`) |

---

## 17. Risks and open owner questions

| Risk | Mitigation |
|---|---|
| Taps on villagers steal build taps | with the Build tool only a tap on the body (12 px) selects, a Show me spot always builds, occlusion by pieces, press-and-hold and draw strokes always build, bubbles sit above roofs and pass drags through (§10.1, §12.7, R18) |
| Pinned time makes routines feel static | rotating activities within the pinned phase, granted pieces used at once, day hangouts, lantern strolls, the one-time Let the day pass offer and the town card row (§5.3, §5.4, §10.6, R21) |
| Loose free-build houses fail the home rule | ground floors, verandas, doorway gaps and bedless annexes follow what players build **[verified]**; one forgiven flaw; almost bubbles that name and light the first missing thing in the house's own look (§3.1, §3.7) |
| A bedless covered room is judged a veranda when the player meant a room (a big open-plan living room with 2 gaps and no door of its own) | it only happens while the room is open-sided; walls or a door make it a room again; the B1 fixtures pin the behaviour; the playtest asks |
| Villagers in fenced gardens hop the fence every trip | gates (fences on paths or by a doorstep) are open; hop cost 25 makes any gap preferred; the "oop!" hop is meant to be charming (owner question 3) |
| Hint and almost bubbles nag | shown once per building for 60 s, never for small bedless sheds, **Just a shed** mutes, ordered door → gaps → roof → bed (§3.7) |
| Status toasts flood on clear / load / remodel | changes commit after 3 s of quiet; one summary toast per commit; nothing at the boot restore (§3.5) |
| The custom instanced shader breaks on a three.js update | one small `onBeforeCompile` patch with a cache key and a plain-material fallback (L6) |
| A stutter when the first villager appears | every town program is compiled behind the loading screen (§12.8, L9, R3) |
| DOM bubble cost on low-end phones | transforms only, ≤ 6 shown, culled, skipped when nothing moved, ≤ 2 occlusion rays a frame (§12.11) |
| The synthetic `pointerdown` that hands a bubble drag to the canvas misbehaves on some browser | it is sent only after 10 px of movement, with the real `pointerId`; if `setPointerCapture` throws, camera.js already guards it (`?.`), and the worst case is that a drag starting on a bubble doesn't orbit (H11 runs on the mobile and desktop profiles) |
| World-change floods (strokes, stamps) | one recompute per burst (0.3 s quiet, ≤ 2 Hz); ≤ 1.5 ms on a blueprint lot |
| Wishes feel like a to-do list | 3 open at most, 40 s spacing, quiet fading with no countdown, dreams at half rate, no number on the hearth, checklists without timers (§7.1, §10.3) |
| A device-level town surprises players who expect villagers per slot | each villager remembers 3 footprints, so switching slots puts everyone back; one summary toast explains moves; owner question 2 |
| Two tabs on one profile | the second writer turns the first tab read-only with a Reload offer (§12.9, R20) |
| An older cached game version (stale service worker, offline) meets an autosave with gift pieces: it drops them on load and an edit there autosaves the build without them | rare (the v5 install replaces the v4 cache on its first online load); main.js's guard (§12.6 (5)) stops camera-only flushes overwriting such an autosave; a full fix (never autosave after a lossy load until the player confirms) would change core autosave behaviour, so it is left to the owner (question 7) |
| Slips through walls look like magic in dense builds | only for a villager whose cell was built over or walled in (cost +200), with a puff; ordinary routes never slip, measured by `stats().slips` |
| Scope is large | the M1 vertical slice with the owner's feel check before the full catalogue (§13.3) |

**Owner questions** (decided here for Phase 1; please confirm or change after the playtest):
1. **Time default**: stays pinned, with a one-time offer to let the day pass and granted pieces used at once (D23).
2. **One town per device**, not per save (D22), with 3 remembered footprints per villager.
3. **Fences, hedges, half walls and railings are hopped**, so fenced gardens are home ground and never traps; gates
   by paths and doors are open; full walls are never hopped (D12).
4. **One forgiven flaw** in the home rule, and an open doorway counts as a door (D5).
5. **20 villagers** at most; **the Postie needs two homes**.
6. **At the cap**, should a resident whose home meets a recipe for a job nobody has take that job up (*"Mabel has
   taken up fishing!"*, nothing lost), so that new recipes still matter? Phase 1 says no; the hook is a one-line rule
   in the arrival check.
7. **Lossy loads by an older cached version**: keep the camera-only guard, or also hold edits' autosaves until the
   player confirms (a core change to main.js)?
8. **Existing players** get the intro card (§1.3) with villagers defaulting to on: right default?

---

## Appendix A. Evidence (prototypes run in the real game; scratch, not shipped)

Run any of them with `node tools/shot.mjs --query "clean=1&nosave=1&ui=0" --script <path>` from `hearthwood/`.

* **The home rule and nav as specified here**: `scratchpad/living/reviser/home2-proto.js`, output in
  `reviser/home2-proto.out`. It implements §3.1 (ground floors, verandas, rule 8b with beds, doorway gaps), §6.1
  (regions over walk + hop edges, gates, half walls as hops, pole items blocked) and the §7.5 cut-off check for
  `w_door_bench`, and runs every blueprint, every original edge case and every review fixture. Results are both §3.2
  tables: the blueprint rows are unchanged from the earlier rule; every doorstep is reachable without slips; N1 and
  N2 reach the doorstep with 1 hop and keep ≥ 3 bench spots; detect 0.8–1.2 ms + nav 0.2–0.45 ms on the farmhouse
  (string-keyed). A readable summary is in `reviser/home2-proto.summary.txt`.
* **Review fixtures** (all with `world.add(…, { record: false })` after `world.clear`; `SMALL_HOME(0, 0)` as in §13.4):
  * V1: `SMALL_HOME(0, 0)` + `foundation` (0, 0, 2), (1, 0, 2) + `roof_flat` (y 1, h 0) on (0, 2), (1, 2). V2: the
    same with `deck`. V3: V1 + `wall_half` on edges x (0, 3), x (1, 3), z (0, 2), z (2, 2).
  * V4: `SMALL_HOME(0, 0)` without its roof + `foundation` (0, 2), (1, 2) + `post` (0, 0, 3), (2, 0, 3) + `floor` on
    (0..1, 1, 0..2) + level-1 walls round those 6 cells + `roof_flat` (y 2) on them. V4b: V4 without the two porch
    foundations.
  * V5: `SMALL_HOME(0, 0)` without its roof + `floor` (0..1, 1, 0..1) + level-1 walls round them with a `wall_door` at
    x (0, 1, 2) + `post` (0, 0, 3), (2, 0, 3) + `floor` (0, 1, 2), (1, 1, 2) + `railing` on x (0, 1, 3), x (1, 1, 3),
    z (0, 1, 2), z (2, 1, 2) + `roof_flat` (y 2) on (0..1, 0..2).
  * A1: `SMALL_HOME(0, 0)` + `foundation` and `roof_flat` on (0..1, −2..−1) + walls z (0, −2), z (0, −1), z (2, −2),
    z (2, −1) + `wall_door` x (0, 0, −2) + `wall` x (1, 0, −2) + `kitchen_range` (1, 0, −1). The shared wall at z = 0
    stays a wall.
  * S1 / S2: the semis of `final-proto.js` (4 × 2 foundations, doors at x 1 and 2 on the +Z edge, a wall at x = 2,
    flat roof, beds at (0, 0) and (3, 0)); S2 without the right bed. S3: the same plan on two floors (foundations,
    `floor` at level 1, `roof_flat` at y 2, walls round both floors and on x = 2 on both, doors only downstairs, beds
    at (0, 1, 0) and (3, 1, 0)).
  * G1: `SMALL_HOME(0, 0)` without foundations. G2: G1 without wall x (0, 0, 0). G3: G1 without the `roof_flat` at
    (1, 1). G4: `SMALL_HOME(0, 0)` with its door edge x (0, 0, 2) left empty. G5: G1 with the door edge empty. G6:
    `SMALL_HOME(0, 0)` with a `wall` in the door edge.
  * G7: walls x (0, 0, 0), x (1, 0, 0), z (0, 0, 0), z (2, 0, 0) + `roof_flat` on (0, 0), (1, 0); no bed. G8: `post`
    at (0, 0), (2, 0), (0, 2), (2, 2) + `roof_flat` on (0..1, 0..1) + a `bench` at (0, 0). G9: `SMALL_HOME(0, 0)` +
    walls round (3..5, 0..2) with a `wall_door` at x (4, 0, 3).
  * N1–N5 as in §13.4.
* **Passer-by on a phone**: `reviser/passerby.js` (`--mobile --query "nosave=1"`) projects the route on the welcome
  lot's view: the free area (390 × 664 canvas, insets top 54, bottom 230, right 68) shows the front row from x ≈ −2 m
  to the stepping stones (2, 9) at screen (135, 412); the lane mouth and the west edge are off-screen.
* **Cozy over a session**: `reviser/cozy-model2.py`, a 1 s step model of arrivals, wish pacing, grant rates and decor
  for four player profiles, 20 seeds each; its medians are the §9.1 table (`reviser/cozy-model.py` is the earlier
  formula, for comparison).
* **The review's own checks**: `scratchpad/living/reviewer/edge.js`, `fence.js` and `nofound.js` ran the earlier rule
  on the covered porch, the annex, fenced yards, walls on grass and the open doorway; every case they flagged is a
  review fixture above and now passes.
* **The earlier rule**: `scratchpad/living/final/final-proto.js` (output `final/final-proto.out`): detection 0.1–0.6 ms,
  farmhouse average 0.36 ms over 20 runs; Show me spots for flowers or a bench by the door (6–24 cells) and a tree
  near the house (72–81) on every blueprint home.
* Experience draft prototypes (`scratchpad/living/experience/`):
  * `calls-proto.js`: +11 draw calls for 8 instanced job meshes holding 20 villagers + blobs + spill + FX (cottage
    94 → 105, farmhouse 126 → 137), and 0.007 ms of instance updates per frame;
  * `scale-mock.js`: 1.25 m villager scale on a phone.
* Systems draft prototypes (`scratchpad/living/systems/`):
  * `villager-proto.js`: an `onBeforeCompile` limb-swing patch on one `InstancedMesh`, 20 villagers = +1 call,
    0.005 ms per frame;
  * `proto.js`: nav grid + A*, 0.2–0.9 ms naive.
* Engine facts this spec relies on, read from the source:
  * `main.js`: modules load in order (pieces, env, audio, blueprints, then the town, then ui); the starting content
    (showcase, `?bp=` stamp, autosave restore or welcome lot) comes after every module, and `ready` is emitted last,
    after the dev params and the autosave hook; `frame()` runs from before `boot()`, so a module's `update` can run
    before the starting content exists. The autosave hook registers after the restore, so the restore's own `load`
    event is never autosaved; a camera-only flush writes only when `savedView` is set.
  * `blueprints.js`: `active()` returns the guide's id until `stop()` (Stop / Close, another guide or a stamp), also
    after completion; `progress()` gives `{ done, total }`; `selectNext` turns the camera when |Δθ| > 1.2.
  * `ui.js`: the finished guide card hides itself (and its Close button) after 6 s, leaving `state.blueprint` set;
    the toast stack keeps 3; the welcome card shows only without an autosave and without dev params.
  * `builder.js`: sets `rig.onTap` / `onPress` / `onAimEnd` / `onGestureStart` in its constructor, and `aimEnd`
    calls `this.tap` directly; `resolve` snaps only to blueprint guides; `selectPiece` can send a floor toast
    (`_toItsFloor`) and `_autoView` a cutaway or roofing toast; `place(rec)` records an undo step, pops in, plays the
    sfx and emits `placed`; `materialFor` / `colorFor` give a normal placement's look.
  * `camera.js`: `pointerdown` on the canvas, `pointermove` / `pointerup` on `window`; `focus` keeps θ and doesn't
    clamp to `bounds` (36); wheel zoom and mouse pans never call `onGestureStart`.
  * `env.js`: `LANE` and `DAY_SECONDS` are module constants; `LANE` points are up to 10 m apart; `KEEP` = 22.5;
    `heightAt` = 0 within 26 m.
  * `effects.puff`: one `Sprite` (one draw call) per particle.
  * `world.pick`: returns `{ entry, point }`; `world.add` records an undo step unless `record: false`; `world.load`
    doesn't check the lot bounds.
  * `catalog.piecesIn`: filters `hidden`, and `world.validate` ignores it.
  * `decor.js`: exports nothing; `SURF_Y` gives grass 0, path 0.025, deck/foundation 0.25 (world, level 0); its
    ceramic and fabric colours are the `COL` table.
  * `.hw-toasts`: no pointer events today.
  * `.hw-count`: hidden at ≤ 370 px.
  * `tools/batch-regress.mjs`: exports `openGame`, but its module body runs the whole suite (top-level `await`) and
    calls `process.exit`, so it can't be imported as a library; hence `tools/harness.mjs`.
  * `sw.js`: `VERSION` 4.

---

## 18. Decisions (where the review or the drafts disagreed, or offered a choice)

1. **Regions include hops** (review): only full walls and blocked cells separate regions, so fenced gardens and a
   hedged lot are home ground; gates are open; half walls and railings became hops too (beyond the review), because a
   half-wall porch otherwise shut its own door off **[verified]**.
2. **Verandas and ground floors** (review, extended): the veranda rule is the review's; for walls on grass I chose
   ground floors (pockets plus roofed groups that lean on a wall) over a "lay a foundation" hint, so a grass house is
   simply a home, with one forgiven gap or roof hole like any other. All blueprint results are unchanged.
3. **Doorways count as doors** (review's first option), rather than a door hint that points at a gap.
4. **Annexes**: rule 8b keeps rooms apart only when both have their own door **and** a bed (review). I judge it on
   towers of stacked rooms (rule c first): judged room by room, the doorless upstairs bedrooms of two-storey semis
   merged across their party wall and made one building **[verified]**.
5. **Guided = active and unfinished** (review); a finished guide's lingering card never pauses the town.
6. **Boot restore on `ready`**, silent, always, even with `clean=1` (review).
7. **Harness**: `tools/harness.mjs` (review's first option); for `HW_TOWN=1` I chose a `townrender=0` URL parameter
   over an in-page `debug.hide`, so batch-regress changes only its query strings.
8. **Show me**: multi-part plans with a timer-less checklist, re-targeting, taps snapping to rings and ghosts, view
   set before the piece (review). INSIDE spots use φ ≤ 0.9: the review wrote "φ ≥ 0.95", but in camera.js a smaller φ
   is the steeper view it asked for.
9. **Pinned default kept** (owner's D23), but granted pieces are used at once and benches / fire pits are day
   hangouts; the flowing night is shorter and never empty (review).
10. **Move-in glow ignores night** (review), drawn in the spill mesh at no extra draw call.
11. **Passer-by** routed along the front ring to the stepping stones (review), checked on a phone projection.
12. **Settling and summaries** (review): 3 s of quiet before a status change, one toast per commit, the fix-up reward
    only after the bubble showed.
13. **Camp wish** is one town-level bubble outside the cap (review); its thank-you gives Warmth but no gift step, so
    moving a bed around can't farm gifts.
14. **Travellers turn back** instead of camping (review); the same traveller returns with the next vacancy.
15. **Open wishes are dropped silently** on a binding change (review).
16. **Gift unlocks** are read by gifts.js from a tiny mirror key and the town key (review); `GIFTS` lives in data.js and
    gifts.js imports it.
17. **Villager taps**: 12 px with the Build tool, 24 px otherwise; home bubbles above the roof; drags on bubbles pass
    to the canvas (review).
18. **Cozy**: a soft charm curve over the sum of kinds plus tapered warmth gains and proportional drift, modelled for
    four player types (§9.1). The review's first option still capped each home at 12 kinds (a one-home decorator
    topped out at charm 16), so I used the sum of kinds on one curve instead.
19. **Two tabs**: read-only with a Reload offer (review). **Stale versions**: only the camera-only guard in main.js;
    holding edits' autosaves is left to the owner (question 7).
20. **Job change at the cap** is an owner question, not built (review offered both).
21. **Nice-to-haves taken**: footprints ×3, follow that survives orbit and ends on target moves, bubble anchors off
    the walls, an ember dot instead of a number, pole items blocked, seats facing away from walls, no pronouns,
    `w_` / `J_` template ids and the `florist` trait, existing ceramic colours for gifts, the showcase note, scrub
    debounce, spill on the nav surface, a 1 m lane, camp cells off doorsteps, "a Lily Pond", non-overlapping plaza
    blocks, the `PERF_TOWN` fixture, five phone widths in H4, and one rule for the Town row (always).
