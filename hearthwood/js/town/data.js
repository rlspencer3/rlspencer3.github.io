// Hearthwood — Living Town data (docs/LIVING.md §2, §5, §7.3, §8.2, §12.4, §15).
// Pure data: no imports, no DOM, no three. Every tuning number lives in TUNE (§15) and every user-visible string
// of the town brain lives here (LINES, job / trait labels, wish texts, hint texts), so hud.js and index.js can read
// them without importing the sim. gifts.js imports GIFTS / KEYS from this file (the single source of truth).

export const KEYS = { town: 'hearthwood.town.v1', unlocks: 'hearthwood.unlocks.v1' };

// ====================================================================== tuning (§15)
export const TUNE = {
  TICK: 0.25,                       // sim tick (town seconds)
  DAY_SECONDS: 600,                 // env.js fallback (one sky day when time flows)
  SEASON_DAYS: 3,                   // reserved for Phase 3
  // arrivals
  FIRST_ARRIVAL_DELAY: 5,
  GUIDED_ARRIVAL_DELAY: 4,
  RETURN_DELAY: 3,
  TURN_BACK_WAIT: 20,
  ARRIVAL_BASE: 75,
  ARRIVAL_COZY: [1.5, 0.6],         // lerp(a, b, Cozy / 100)
  ARRIVAL_JITTER: [0.85, 1.15],
  TRAVELLER_SPEED: 1.6,
  LANE_START: 2,                    // LANE index the traveller spawns at
  LANE_STEP: 1,                     // lane resampling (m)
  MAX_VILLAGERS: 20,
  BEDS_PER_HOME_MAX: 4,
  MOVEIN_KNOCK: 0.35,               // §4.6 beats (s after reaching the doorstep)
  MOVEIN_ENTER: 0.6,
  MOVEIN_LIGHTS: 1.0,
  MOVEIN_TOAST: 1.2,
  MOVEIN_OUT: 6.0,
  MOVEIN_GLOW: 0.7,
  MOVEIN_GLOW_LEN: 2.5,
  // passer-by (§4.7)
  PASSERBY_FIRST: 12,
  PASSERBY_EVERY: 180,
  PASSERBY_MAX: 3,
  PASSERBY_WAVE: 2,
  PASSERBY_LOOK: 2,
  PASSERBY_VIEW_BACK: 2,            // cells: the viewing spot goes this far up the front path from the lot's front row
  // homes (§3)
  HOME_SLACK: 1,
  POCKET_MAX: 64,
  HOME_MATCH: 0.3,
  FEET_KEPT: 3,
  SETTLE: 3,
  FIXUP_DELAY: 60,
  ALMOST_DELAY: 8,
  ALMOST_SHOW: 60,
  ALMOST_MAX: 3,
  SHED_CELLS: 6,
  VACANCY_SHOW: 90,
  MUTED_MAX: 30,
  // wishes (§7)
  FIRST_WISH_DELAY: 30,
  LATER_WISH_DELAY: 60,
  WISH_GAP: [150, 300],
  DREAM_GAP_MULT: 2,
  MAX_OPEN_WISHES: 3,
  WISH_TOWN_SPACING: 40,
  WISH_LIFE: { S: 900, M: 900, L: 1500 },
  WISH_COOLDOWN: 1200,
  REWISH_AFTER_MOVE: 60,
  WISH_RECENT: 3,
  WISH_BASE: { S: 1.0, M: 0.8, L: 0.5 },
  WISH_JOB_ONLY: 3,
  WISH_FAVOURED: 2,
  WISH_ODD_JOB: 4,
  WISH_SAME_TPL: 0.5,
  WISH_MAX_RECS: 24,
  GRANT_NEAR: 20,                   // m: an awake outdoor granter within this rushes over (§7.7)
  GRANT_USE: 120,
  // movement & routine (§5, §6)
  WALK_SPEED: 1.25,
  HURRY: 1.6,
  HURRY_WINDOW: 3,
  GRANT_RUSH: 1.3,
  SLIP_HOME_AFTER: 20,              // s of walk: a villager farther than this walks 6 s then slips home
  SLIP_HOME_WALK: 6,
  SCHEDULE: { wake: 5.5, morningEnd: 8.5, dayEnd: 17, home: 21.5, sleep: 23, jitter: 0.4, lunch: [12, 13] },
  DUR: {
    work: [60, 120], workPinned: [50, 90], break: [20, 40], breakPinned: [25, 45], chore: [15, 30],
    hangout: [60, 120], popHome: [20, 40], chat: [10, 20], wander: [8, 15], admire: [5, 10], stroll: [10, 20],
    use: [30, 60],
  },
  DUR_JITTER: 0.25,
  NIGHT_STROLL_EVERY: 90,
  NIGHT_STROLL_LEN: 30,
  HUM_CHEERFUL: [20, 40],           // s between hums while walking, per villager, at Cheerful (§9.2)
  HUM_GLOWING: [10, 20],            // … at Glowing
  NIGHT_STROLL_WAKE_GAP: 2.5,       // h: with time flowing, a stroll starts only this long before the villager's wake hour
  FIRST_CHORE: [20, 30],            // s: the chore by the door right after moving in (§4.6, the storyboard's watering)
  FIRST_WISH_NEAR: 4,               // cells: a villager's first wish is a one-piece wish with its spot this near a door
  RESEAT_DELAY: 0.4,
  SKY_JUMP: 0.05,
  HANGOUT_MAX: 6,
  PLAZA_MAX: 4,
  PORCH_MAX: 2,
  WANDER_RADIUS: 6,
  VISIT_RADIUS: 15,
  // nav (§6.1)
  COST_GRASS: 1.0,
  COST_RING: 1.5,
  COST_PATH: 0.55,
  COST_DECK: 0.8,
  COST_STEPS: 0.8,
  COST_FOUNDATION: 1.0,
  COST_NEAR_BLOOM: 0.3,             // added to a cell 4-adjacent to a bloom: walkers keep off the flower beds
  HOP_COST: 25,
  SLIP_COST: 200,
  PATHS_PER_FRAME: 4,
  LOS_STEP: 0.25,
  LOS_VERTEX: 0.35,
  LANE_OFFSET: 0.3,
  SURF: { grass: 0, path: 0.025, deck: 0.25, steps: 0.125, foundation: 0.25 },
  // Cozy (§9)
  WARMTH_START: 10,
  WARMTH_MAX: 60,
  COZY_WISH: { S: 6, M: 8, L: 12 },
  COZY_MOVEIN: 4,
  COZY_FIX: 3,
  COZY_CAMP: 12,
  COZY_DRIFT_EVERY: 120,
  COZY_DRIFT_DIV: 20,
  CHARM_MAX: 40,
  CHARM_SCALE: 30,
  COZY_FLOOR: { base: 15, per: 2, cap: 10 },
  TIERS: [25, 50, 75],
  GIFT_COUNT_AS: 2,                 // every gift counts as 2 kinds of decor
  // gifts (§8)
  GIFT_AT: [2, 4, 7, 10, 14, 18, 23, 28, 34, 40],
  // lights / presentation hints (§5.6, §10)
  SPILL_GAIN: 0.55,
  SPILL_ASLEEP: 0.15,
  BUBBLE_MAX: 6,
  // persistence (§12.9)
  CAMP_GRANTS_MAX: 60,
  SAVE_EVERY: 30,
};

// ====================================================================== shared vocabulary (§2.1)
export const SETS = {
  BLOOM: ['flowers', 'lavender', 'sunflowers', 'gift_flower_cart'],
  TREE: ['tree_oak', 'tree_pine', 'tree_birch', 'tree_apple'],
  FARM: ['veggie_bed', 'pumpkins', 'hay_bale', 'chickens', 'scarecrow', 'gift_hen_house'],
  LAMP: ['lamp_post', 'gift_festoon'],
  FENCE: ['fence_picket', 'fence_rail', 'hedge'],
  PATHY: ['path', 'steps', 'deck'],
  SEAT_OUT: ['bench', 'picnic_table', 'rocking_chair', 'boulders', 'hay_bale', 'gift_tea_table'],
  SEAT_IN: ['armchair', 'sofa', 'rocking_chair'],
  DOORWAY: ['wall_door', 'wall_door_glass', 'wall_door_barn', 'wall_arch'],
  WALLISH: ['wall', 'gable', 'gable_window', 'wall_window', 'wall_window_tall', 'wall_window_wide', 'wall_window_round',
    'wall_window_arch', 'wall_window_shutters'],
  WINDOW: ['wall_window', 'wall_window_tall', 'wall_window_wide', 'wall_window_round', 'wall_window_arch',
    'wall_window_shutters', 'gable_window'],
  HOPWALL: ['wall_half', 'railing'],
  KITCHEN: ['kitchen', 'kitchen_counter'],
  BAKE_TABLE: ['bench', 'picnic_table'],
  // nav (§6.1): solid items block their cell; soft items add cost
  SOLID: ['tree_oak', 'tree_pine', 'tree_birch', 'tree_apple', 'pond', 'well', 'boulders', 'bush', 'fire_pit', 'birdbath',
    'scarecrow', 'beehive', 'doghouse', 'woodpile', 'hay_bale', 'veggie_bed', 'pumpkins', 'picnic_table', 'bench',
    'chimney', 'crate_stack', 'barrel', 'wheelbarrow', 'stairs', 'stairs_spiral', 'ladder', 'lamp_post', 'mailbox',
    'birdhouse'],
  POLE: ['lamp_post', 'mailbox', 'birdhouse', 'gift_festoon', 'gift_signpost'],
  // Cozy charm (§9.1); GIFTS ids count too (as 2 kinds each). COZY_IN is every 'interior' id except bed (plus chimney),
  // read from the catalog at runtime, with this list as the fallback.
  DECOR_OUT: ['flowers', 'lavender', 'sunflowers', 'bush', 'tree_oak', 'tree_pine', 'tree_birch', 'tree_apple', 'bench',
    'picnic_table', 'lamp_post', 'mailbox', 'birdhouse', 'birdbath', 'well', 'pond', 'boulders', 'fire_pit', 'path',
    'deck', 'rocking_chair', 'beehive', 'chickens', 'scarecrow', 'clothesline', 'doghouse', 'wheelbarrow', 'hay_bale',
    'woodpile', 'veggie_bed', 'pumpkins', 'fence_picket', 'fence_rail', 'hedge'],
  COZY_IN: ['nightstand', 'wardrobe', 'dresser', 'sofa', 'armchair', 'rocking_chair', 'rug', 'rug_round', 'floor_lamp',
    'bookshelf', 'fireplace', 'wood_stove', 'piano', 'grandfather_clock', 'plant_pot', 'cat', 'dog_bed', 'table', 'chair',
    'kitchen', 'kitchen_counter', 'kitchen_range', 'desk', 'bathtub', 'washstand', 'crate_stack', 'barrel', 'chimney'],
  // pretty things a stroll admires (§5.3)
  PRETTY: ['flowers', 'lavender', 'sunflowers', 'tree_oak', 'tree_pine', 'tree_birch', 'tree_apple', 'pond', 'lamp_post',
    'birdbath', 'well', 'fire_pit', 'bush'],
};

/** Soft items: extra nav cost (§6.1). Gifts with walk 'soft' add SOFT_GIFT. */
export const SOFT = { flowers: 6, lavender: 6, sunflowers: 6, plant_pot: 2, chair: 2, rocking_chair: 3, armchair: 3,
  chickens: 1.5, cat: 1.5, dog_bed: 1.5, clothesline: 1.2 };
export const SOFT_GIFT = 2.5;

// ====================================================================== gifts (§8.2, §12.4 — exact)
// seats: local [x, y, z, yaw] seat anchors (yaw about +Y, 0 = +Z)
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
};
export const GIFT_IDS = Object.keys(GIFTS);

// ====================================================================== jobs (§2.2)
export const JOB_ORDER = ['gardener', 'farmer', 'woodcutter', 'fisher', 'beekeeper', 'baker', 'lamplighter', 'postie'];

// terms: { set | id, where ('foot' | 'door' | 'inside' | 'hive' | 'town'), R (Chebyshev cells), need, of?, piece, text }
//   set: a SETS name (BLOOM counts the cart as 2); id: one piece id; where 'hive' = within R of the hive of term `of`;
//   where 'town' = a town count (homes); piece = what Show me hands over for it; text = the missing-item phrase.
export const JOBS = {
  gardener: {
    id: 'gardener', label: 'Gardener', icon: '🌷', color: '#9cae6b', signature: 'Mabel', oddWish: 'w_door_flowers',
    terms: [{ set: 'BLOOM', where: 'foot', R: 4, need: 3, piece: 'flowers', text: 'flowers within 4 cells' }],
    look: { hat: '#e9c46a', tool: '#8fb8c9' }, work: { produces: 'flowers' },
  },
  farmer: {
    id: 'farmer', label: 'Farmer', icon: '🥕', color: '#5d7fa3', signature: 'Otis', oddWish: 'w_veg_patch',
    terms: [{ set: 'FARM', where: 'foot', R: 5, need: 2, piece: 'veggie_bed', text: 'vegetable beds or animals within 5 cells' }],
    look: { hat: '#7a5a3a', tool: '#8a6a4a' }, work: { produces: 'veg' },
  },
  woodcutter: {
    id: 'woodcutter', label: 'Woodcutter', icon: '🪓', color: '#b4473a', signature: 'Bram', oddWish: 'J_wood_pile',
    terms: [{ id: 'woodpile', where: 'foot', R: 3, need: 1, piece: 'woodpile', text: 'a woodpile within 3 cells' },
      { set: 'TREE', where: 'foot', R: 6, need: 2, piece: 'tree_pine', text: 'trees within 6 cells' }],
    look: { hat: '#b4473a', tool: '#6b6b6b' }, work: { produces: 'logs' },
  },
  fisher: {
    id: 'fisher', label: 'Fisher', icon: '🎣', color: '#2f4a66', signature: 'Wendell', oddWish: 'w_pond',
    terms: [{ id: 'pond', where: 'foot', R: 6, need: 1, piece: 'pond', text: 'a Lily Pond within 6 cells' }],
    look: { hat: '#e9c46a', tool: '#7a5a3a' }, work: { produces: 'fish' },
  },
  beekeeper: {
    id: 'beekeeper', label: 'Beekeeper', icon: '🐝', color: '#e9b949', signature: 'Posy', oddWish: 'w_hive',
    terms: [{ id: 'beehive', where: 'foot', R: 4, need: 1, piece: 'beehive', text: 'a beehive within 4 cells' },
      { set: 'BLOOM', where: 'hive', of: 0, R: 2, need: 2, piece: 'lavender', text: 'flowers beside the hive' }],
    look: { hat: '#f4f1e8', tool: '#9a9a9a' }, work: { produces: 'honey' },
  },
  baker: {
    id: 'baker', label: 'Baker', icon: '🍞', color: '#c96a5a', signature: 'Hazel', oddWish: 'w_kitchen',
    terms: [{ id: 'kitchen_range', where: 'inside', need: 1, piece: 'kitchen_range', text: 'a cook stove inside' },
      { set: 'KITCHEN', where: 'inside', need: 1, piece: 'kitchen_counter', text: 'a kitchen counter or sink inside' },
      { set: 'BAKE_TABLE', where: 'door', R: 4, need: 1, piece: 'bench', text: 'a bench or picnic table near the door' }],
    look: { hat: '#ffffff', tool: '#c9a46a' }, work: { produces: 'bread' },
  },
  lamplighter: {
    id: 'lamplighter', label: 'Lamplighter', icon: '🏮', color: '#2f4a66', signature: 'Ivy', oddWish: 'w_door_lamp',
    terms: [{ set: 'LAMP', where: 'foot', R: 6, need: 2, piece: 'lamp_post', text: 'lamp posts within 6 cells' }],
    look: { hat: '#3b3a3a', tool: '#3b3a3a' }, work: { produces: 'light' },
  },
  postie: {
    id: 'postie', label: 'Postie', icon: '✉️', color: '#8e3b32', signature: 'Percy', oddWish: 'w_mailbox',
    terms: [{ id: 'mailbox', where: 'door', R: 3, need: 1, piece: 'mailbox', text: 'a mailbox by the door' },
      { what: 'homes', where: 'town', need: 2, piece: 'foundation', text: 'another home in the meadow' }],
    look: { hat: '#2f4a66', tool: '#7a4b3a' }, work: { produces: 'letters' },
  },
};

// ====================================================================== traits (§2.4, §5.2)
// shift: hours added to wake / home / sleep. prefs: routine multipliers read by the sim.
export const TRAITS = {
  early: { id: 'early', label: 'Early riser', icon: '🌅', shift: { wake: -1, home: -1, sleep: -1 },
    favours: { w_door_flowers: 2, w_washing_line: 2, w_veg_patch: 2, w_door_bench: 2 }, prefs: { porch: 1.5 } },
  owl: { id: 'owl', label: 'Night owl', icon: '🦉', shift: { wake: 1.5, home: 2, sleep: 2 },
    favours: { w_fire_circle: 3, w_door_lamp: 2, w_route_lamp: 2, w_lamp_seat: 2 }, prefs: { fire: 1.5, lamp: 1.5, nightStroll: 1 } },
  homebody: { id: 'homebody', label: 'Homebody', icon: '🏡', shift: { wake: 0, home: -1.5, sleep: 0 },
    favours: { w_soft_rug: 2, w_reading_nook: 2, w_hearth: 2, w_porch: 2, w_door_bench: 2 }, prefs: { porch: 2, popHome: 2 } },
  chatty: { id: 'chatty', label: 'Chatty', icon: '💬', shift: { wake: 0, home: 1, sleep: 0.5 },
    favours: { w_path_friend: 3, w_supper_table: 2, w_fire_circle: 2, w_picnic_shade: 2 }, prefs: { occupied: 1.5, chat: 1.5 } },
  shy: { id: 'shy', label: 'Shy', icon: '🌿', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_shade_tree: 2, w_garden_fence: 2, w_water_bench: 2, w_birds: 2 }, prefs: { occupied: 0.5 } },
  bookish: { id: 'bookish', label: 'Bookish', icon: '📚', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_reading_nook: 3, w_birds: 2, w_route_lamp: 2 }, prefs: { read: 1 } },
  florist: { id: 'florist', label: 'Flower lover', icon: '🌸', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_door_flowers: 3, w_window_boxes: 2, w_bloom_riot: 2, w_hive: 2 }, prefs: { smell: 1 } },
  animals: { id: 'animals', label: 'Animal lover', icon: '🐾', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_pet: 3, w_chickens: 2, w_birds: 2 }, prefs: { animals: 1 } },
  sweet: { id: 'sweet', label: 'Sweet tooth', icon: '🍰', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_apple_tree: 3, w_picnic_shade: 2, w_kitchen: 2, w_hive: 2 }, prefs: { picnic: 1.5 } },
  stargazer: { id: 'stargazer', label: 'Stargazer', icon: '✨', shift: { wake: 0, home: 0, sleep: 0 },
    favours: { w_fire_circle: 2, w_well: 2, w_water_bench: 2, w_pond: 2 }, prefs: { nightStroll: 1, lookup: 1 } },
};
export const TRAIT_ORDER = Object.keys(TRAITS);

/** Job favourites (§7.3 "Favoured by"). */
export const JOB_FAVOURS = {
  gardener: ['w_door_flowers', 'w_window_boxes'],
  farmer: ['w_garden_fence', 'w_veg_patch', 'w_chickens', 'w_bath'],
  woodcutter: ['w_shade_tree', 'w_bath'],
  fisher: ['w_water_bench', 'w_pond'],
  beekeeper: ['w_hive'],
  baker: ['w_kitchen', 'w_apple_tree', 'J_bake_table', 'w_hive'],
  lamplighter: ['w_door_lamp', 'w_lamp_seat'],
  postie: ['w_mailbox', 'w_door_path', 'w_path_friend'],
};

// ====================================================================== names (§2.5)
export const NAMES = {
  signature: { gardener: 'Mabel', farmer: 'Otis', woodcutter: 'Bram', fisher: 'Wendell', beekeeper: 'Posy', baker: 'Hazel',
    lamplighter: 'Ivy', postie: 'Percy' },
  pool: ['Clover', 'Juniper', 'Rowan', 'Fern', 'Basil', 'Tilly', 'Alder', 'Wren', 'Hollis', 'Marigold', 'Ezra', 'Pippa',
    'Linus', 'Rosalind', 'Barnaby', 'Edie', 'Cedric', 'Willa', 'Odette', 'Amos', 'Florence', 'Jasper', 'Nell', 'Rufus',
    'Agnes', 'Milo', 'Thea', 'Hugo', 'Bea', 'Felix', 'Opal', 'Arlo', 'Greta', 'Moss', 'Iris', 'Quill', 'Dottie', 'Silas',
    'Juno', 'Maple', 'Teddy', 'Sorrel', 'Winnie', 'Ambrose', 'Lark', 'Bertie', 'Primrose', 'Cosmo'],
  suffix: ' II',
};

// ====================================================================== look (§2.3)
export const LOOK = {
  skin: ['#f3d2b3', '#e8b894', '#c98f66', '#a86b4a', '#7d4e34', '#5a3a28'],
  hair: ['#2b2018', '#5a3a22', '#8a5a2b', '#c98a3a', '#d9c08a', '#b9b2a6'],
  outfit: [0, 0.15, -0.15],        // the job colour, lightened 15 %, darkened 15 %
  build: ['slim', 'round', 'tall'],
  voice: [0.85, 1.25],
};

// ====================================================================== flavour lines (§2.6)
export const LINES = {
  movein: ["Oh, it's even cosier inside than it looked from the lane!", "I've hung my hat. That makes it home.",
    "Look at that door! I think we'll get along, this house and me.", "Home at last. I'll put the kettle on."],
  granted: ["It's perfect. Thank you!", 'Oh! You remembered!', "I'll think of you every time I see it.",
    'Just what I was dreaming of.', 'My heart is as full as a teapot.', 'Look at that! I could hug it.'],
  grantedShy: ["Thank you… it's just right."],
  waiting: ["A little fixing up and it'll be good as new.", "I don't mind the draught. It's an adventure!",
    "I'll sleep on the sofa until it's mended."],
  camping: ['Sleeping under the stars is an adventure! Though a roof would be nice.',
    'The lane is lovely at night. A bed would be lovelier.', "I've made friends with an owl. Still, a bed…"],
  moving: ["A new home! I'll carry my teapot over.", 'Change is good. Especially with a fireplace.'],
  morning: ["Morning! The dew's still on the grass.", 'First cup of tea, then the world.', 'The birds are up before me again.',
    'What a morning to be busy.'],
  evening: ['The lamps are the best part of the day.', 'Supper smells are drifting over the meadow.',
    "Come and sit. The sun's doing its best colours.", 'One more chat, then home.'],
  night: ['Zzz… mmm… honey cakes…', "Shh, the whole meadow's asleep.", 'Owls are out. So am I, apparently.'],
  quiet: ["It's peaceful here. Maybe a little too peaceful.", 'A few more flowers and this place would sing.'],
  glowing: ["Have you noticed? Everyone's humming.", "I've never lived anywhere so warm.", 'The whole meadow feels like a hug.'],
  gardener: ['Every flower has its own little song.', "Water, sunshine and a kind word. That's the secret.",
    "The lavender's showing off again.", 'I talk to the sunflowers. They listen.', 'Weeds are just flowers nobody asked for.',
    'My knees are muddy and my heart is happy.'],
  farmer: ['The beans are climbing faster than I can count them.', 'Up with the hens, down with the sun.',
    'A pumpkin this size deserves a name.', 'Good soil is better than gold.', 'The scarecrow and I have an understanding.',
    'Rain tomorrow. I can feel it in my boots.'],
  woodcutter: ['Measure twice, chop once.', "Plant one, chop one. That's the deal I made with the forest.",
    'Nothing warms you like splitting your own logs. Twice.', "That pine's been standing longer than I have.",
    'A tidy woodpile is a happy winter.', 'Mind your toes!'],
  fisher: ["They're biting today. Well, one is.", "Haven't caught a thing. Best morning all week.",
    'The pond keeps its secrets. I keep my patience.', 'I named that frog Gerald.', 'Quiet water, quiet mind.',
    'The big one got away. Again.'],
  beekeeper: ["Hush now, they're busy.", 'Every jar is a summer you can keep.',
    "The bees like the lavender best. Don't tell the sunflowers.", 'A gentle puff, a gentle word.', 'Buzzing means happy. Mostly.',
    'Honey on toast, honey in tea, honey on everything.'],
  baker: ["Bread's in! Mind the steps, they're still warm.", "Flour in my hair again. It's a look.", 'A loaf for every doorstep.',
    'The secret ingredient is patience. And butter.', "Smell that? That's breakfast saying hello.", 'Knead, rest, bake. Like a good day.'],
  lamplighter: ['One more lamp and the whole lane will glow.', 'Somebody has to wake the lamps.',
    'I sleep late because the lamps stay up late.', 'A lit lamp is a kind word to strangers.', 'Polished till they shine.',
    'Dusk is my favourite time of day.'],
  postie: ['A letter for everyone today, and two for {neighbour}.', "Nobody's written yet. I deliver the weather instead.",
    'Rain or shine, the post gets through.', 'Every mailbox has its own personality.', 'Special delivery: one cheerful hello.',
    'I know every doorstep by heart.'],
  early: ['Up before the sun again. The lavender smells like summer.', 'Early bird gets the quiet.', "I've already had two cups of tea."],
  owl: ["The stars are better company than you'd think.", 'Mornings are a rumour.', "Night's when the meadow tells its stories."],
  homebody: ['My armchair knows my shape by now.', 'Home is where the slippers are.', "Why go out when the kettle's on?"],
  chatty: ['Did you hear about the pumpkin? No? Let me tell you!', "I've said hello to everyone twice today.",
    'A good chat is better than a nap.'],
  shy: ["Oh! Hello. I didn't see you there.", 'I like it quiet. Quiet is nice.', 'I wave from a distance. It still counts.'],
  bookish: ['Just one more chapter.', 'This bench is perfect for reading.', "I'm on page two hundred and the dragon's still asleep."],
  florist: ["Smell that? Sweet peas, I'd bet.", 'I stop for every flower. It takes a while.', 'A house without flowers is just a box.'],
  animals: ['The cat and I have an understanding.', 'Hello, little bird!', "Did you see the hens? They're so dignified."],
  sweet: ['Is that pie I smell?', 'Life is short. Eat the honey cake.', 'An apple a day, a pie a week.'],
  stargazer: ["Look up! There's the Teapot constellation.", 'I counted forty stars. Then I lost count.', "The moon's extra round tonight."],
  welcomeBack: ['There you are! We kept the kettle warm.', 'Back again! We missed you.'],
  neighbourNone: 'the hens',
  faded: 'Never mind, maybe another time!',
  campThanks: 'A real bed! Thank you!',
  fixThanks: 'Thank you for fixing it up!',
};

// ====================================================================== wish texts (§7.3; the template rows are in wishes.js)
export const WISH_TEXT = {
  w_door_flowers: { icon: '🌷', text: 'Some flowers by my door would be lovely.', label: 'flowers by the door' },
  w_door_bench: { icon: '🪑', text: 'A bench by my door, for morning tea.', label: 'a bench by the door' },
  w_door_lamp: { icon: '🏮', text: 'A lamp by my door for coming home late.', label: 'a lamp by the door' },
  w_route_lamp: { icon: '🏮', text: 'A lamp along my way home.', label: 'a lamp along the way home' },
  w_door_path: { icon: '🪨', text: 'A proper path up to my door.', label: 'a path up to the door' },
  w_path_friend: { icon: '🪨', text: "A path over to {friend}'s door.", label: "a path over to {friend}'s door" },
  w_mailbox: { icon: '📬', text: 'A mailbox of my own!', label: 'a mailbox' },
  w_shade_tree: { icon: '🌳', text: 'A shady tree near the house.', label: 'a shady tree near the house' },
  w_apple_tree: { icon: '🍎', text: 'An apple tree. Imagine the pies!', label: 'an apple tree' },
  w_birds: { icon: '🐦', text: 'Something for the birds to visit.', label: 'a birdhouse or birdbath' },
  w_window_boxes: { icon: '🌷', text: 'Window boxes full of flowers!', label: 'window boxes' },
  w_reading_nook: { icon: '📚', text: 'A cosy reading nook.', label: 'a reading nook' },
  w_hearth: { icon: '🔥', text: 'A warm fire for chilly evenings.', label: 'a fireplace' },
  w_kitchen: { icon: '🍲', text: 'A proper kitchen.', label: 'a proper kitchen' },
  w_supper_table: { icon: '🍽️', text: 'A table for supper with friends.', label: 'a supper table with chairs' },
  w_soft_rug: { icon: '🟥', text: 'Something soft underfoot.', label: 'a rug' },
  w_pet: { icon: '🐈', text: 'A little friend to come home to.', label: 'a pet' },
  w_bath: { icon: '🛁', text: 'A hot bath after a long day.', label: 'a bath' },
  w_porch: { icon: '🟧', text: 'A porch to sit out on.', label: 'a porch' },
  w_garden_fence: { icon: '🏡', text: 'A fence round my garden.', label: 'a garden fence' },
  w_pond: { icon: '🦆', text: 'A little pond to hear the frogs.', label: 'a Lily Pond' },
  w_water_bench: { icon: '🦆', text: 'A bench by the water.', label: 'a bench by the pond' },
  w_fire_circle: { icon: '🔥', text: 'Somewhere to gather in the evening.', label: 'a fire pit with seats' },
  w_picnic_shade: { icon: '🧺', text: 'A picnic table under a tree.', label: 'a picnic table under a tree' },
  w_lamp_seat: { icon: '🏮', text: 'A lamp by the bench so we can chat after dark.', label: 'a lamp by the bench' },
  w_well: { icon: '🪣', text: 'A wishing well for everyone.', label: 'a wishing well' },
  w_washing_line: { icon: '👕', text: 'A washing line in the sunshine.', label: 'a washing line' },
  w_veg_patch: { icon: '🥕', text: 'A little vegetable patch.', label: 'a vegetable patch' },
  w_chickens: { icon: '🐔', text: 'Chickens! Fresh eggs every morning.', label: 'chickens' },
  w_hive: { icon: '🐝', text: 'A beehive near the flowers.', label: 'a beehive' },
  w_bloom_riot: { icon: '🌸', text: 'A riot of flowers!', label: 'lots of flowers' },
  w_neighbour: { icon: '🏡', text: "A neighbour! It's a bit quiet.", label: 'a neighbour', note: 'or try a blueprint' },
  J_garden: { icon: '🌷', text: 'More flowers to tend, please!', label: 'more flowers to tend' },
  J_farm_crow: { icon: '🧑‍🌾', text: 'A scarecrow to mind the veggies.', label: 'a scarecrow' },
  J_farm_more: { icon: '🥕', text: 'Another vegetable bed. The beans are spreading!', label: 'another vegetable bed' },
  J_wood_sapling: { icon: '🌲', text: 'Plant a tree for every log I split.', label: 'a new tree' },
  J_wood_pile: { icon: '🪵', text: 'Another woodpile for winter.', label: 'a woodpile' },
  J_fish_perch: { icon: '🪨', text: 'Boulders to perch on by the pond.', label: 'boulders by the pond' },
  J_fish_dock: { icon: '🟧', text: 'A little dock to fish from.', label: 'a little dock' },
  J_bee_blooms: { icon: '💜', text: 'More flowers for my bees!', label: 'more flowers by the hive' },
  J_bake_table: { icon: '🧺', text: 'A table to set out my bread.', label: 'a picnic table by the door' },
  J_lamp_more: { icon: '🏮', text: 'Another lamp for my evening round.', label: 'another lamp' },
  J_post_paths: { icon: '🪨', text: 'Paths between the houses, for my round.', label: 'paths between the houses' },
  w_camp: { icon: '⛺', text: 'A bed for the campers ({n})', label: 'a bed for the campers', note: 'or try a blueprint' },
};

/** Template sizes (§7.3), for store.js's sanitizer (wishes.js holds the rows). */
export const WISH_SIZE = {
  w_door_flowers: 'M', w_door_bench: 'S', w_door_lamp: 'S', w_route_lamp: 'S', w_door_path: 'M', w_path_friend: 'L',
  w_mailbox: 'S', w_shade_tree: 'S', w_apple_tree: 'S', w_birds: 'S', w_window_boxes: 'S', w_reading_nook: 'M',
  w_hearth: 'S', w_kitchen: 'M', w_supper_table: 'M', w_soft_rug: 'S', w_pet: 'S', w_bath: 'S', w_porch: 'M',
  w_garden_fence: 'M', w_pond: 'S', w_water_bench: 'S', w_fire_circle: 'M', w_picnic_shade: 'M', w_lamp_seat: 'S',
  w_well: 'S', w_washing_line: 'S', w_veg_patch: 'S', w_chickens: 'S', w_hive: 'S', w_bloom_riot: 'M', w_neighbour: 'L',
  J_garden: 'M', J_farm_crow: 'S', J_farm_more: 'S', J_wood_sapling: 'S', J_wood_pile: 'S', J_fish_perch: 'S',
  J_fish_dock: 'M', J_bee_blooms: 'M', J_bake_table: 'S', J_lamp_more: 'S', J_post_paths: 'L',
};

// ====================================================================== hint texts (§3.7)
export const HINT_TEXT = {
  door: { icon: '🚪', text: 'Needs a way in: swap a wall for a door', piece: 'wall_door' },
  gaps: { icon: '🧱', text: 'A gap in the walls ({n})', piece: 'wall' },
  roof: { icon: '🏠', text: 'A hole in the roof ({n} cells)', one: 'A hole in the roof (1 cell)', upstairs: 'The bedroom upstairs needs a roof', piece: 'roof_flat' },
  bed: { icon: '🛏️', text: 'Almost a home: add a bed', piece: 'bed' },
  fix: { icon: '🔨', text: "{name}'s {home} needs fixing: {missing}" },
  vacancy: { icon: '🏡✨', text: 'Who could live here?' },
};

/** Status phrases for cards (index.js / hud.js fill {name} / {home}). */
export const STATUS_TEXT = {
  resident: '🏡 Lives in {home}',
  waiting: '🔨 {home} needs fixing: {missing}',
  waitingShort: '🔨 Waiting for {home} to be fixed',
  camping: "⛺ Camping by the lane until there's a bed free",
  traveller: '🎒 On the way to {home}',
  moving: '📦 Moving into {home}',
  full: 'The meadow is full: {n} neighbours live here.',
  noteCampOne: '⛺ {name} is camping by the lane',
  noteCamp: '⛺ {n} neighbours are camping by the lane',
  // §0.4: the one-time switch to flowing time for players who had pinned it before villagers existed (index.js)
  flowDefault: '🌅 The day now passes, so you can watch village life. Pin the time in Settings.',
};

/** Town card "Could move in" rows (index.js builds them from sim.couldMoveIn(), §10.3). */
export const ROW_TEXT = {
  bed: '{home}: one more bed and {who} would come',          // {who} = "Posy the Beekeeper" or "a beekeeper"
  bedCamp: '{home}: one more bed and {who} could move in from the camp',   // a camper takes the next free bed (§4.2)
  free: '{job}: {missing}',                                  // "Fisher: a Lily Pond within 6 cells"
};

/** The verb of the Show me hint toast ("Tap a glowing spot to plant a Flower Patch…"); everything else is 'place'. */
export const SHOWME_VERB = {
  flowers: 'plant', lavender: 'plant', sunflowers: 'plant', bush: 'plant', tree_oak: 'plant', tree_pine: 'plant',
  tree_birch: 'plant', tree_apple: 'plant', veggie_bed: 'plant', pumpkins: 'plant', hedge: 'plant', path: 'lay',
  deck: 'lay', foundation: 'lay', rug: 'lay', rug_round: 'lay', wall: 'build', wall_door: 'fit', roof_flat: 'put up',
};

// ====================================================================== socialising spots (§5.5)
// seats: local [x, y, z, yaw]; stand: standing spots in walkable neighbour cells (count); approach: local dir of the cell
// to come from ('front' = local +Z, 'any' = nearest free neighbour).
export const SPOT_DEFS = {
  bench: { seats: [[-0.40, 0.42, -0.05, 0], [0.40, 0.42, -0.05, 0]], approach: 'front', hangout: true, kind: 'seat' },
  picnic_table: { seats: [[-0.45, 0.45, 0.62, Math.PI], [0.45, 0.45, 0.62, Math.PI], [-0.45, 0.45, -0.62, 0], [0.45, 0.45, -0.62, 0]], approach: 'any', hangout: true, kind: 'seat' },
  rocking_chair: { seats: [[0, 0.42, 0, 0]], approach: 'front', hangout: false, kind: 'seat', pose: 'rock' },
  fire_pit: { seats: [[-0.3, 0.30, -0.85, 0], [0.3, 0.30, -0.85, 0], [0.85, 0.30, -0.25, -Math.PI / 2], [0.85, 0.30, 0.35, -Math.PI / 2]], stand: 2, approach: 'any', hangout: true, kind: 'seat', fire: true },
  well: { seats: [], stand: 2, approach: 'any', hangout: true, kind: 'stand', pose: 'stand' },
  boulders: { seats: [[0, 0.45, 0, 0]], approach: 'any', hangout: false, kind: 'seat' },
  hay_bale: { seats: [[0, 0.45, 0, 0]], approach: 'any', hangout: false, kind: 'seat' },
  gift_tea_table: { seats: GIFTS.gift_tea_table.seats, approach: 'any', hangout: true, kind: 'seat', tea: true },
  gift_rowboat: { seats: GIFTS.gift_rowboat.seats, approach: 'any', hangout: false, kind: 'seat' },
};

// ====================================================================== places
/** Lane camp ring cells (§3.6): (−11, 0) … (−11, 9). */
export const CAMP_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((z) => [-11, z]);
/** env.js LANE[0..2] fallback (index.js reads the real one through app.modules.env). */
export const LANE_FALLBACK = [[-20.5, -2], [-28, -3.5], [-37, -8]];
/** The lane cell where the lane enters the lot's nav ring (§6.1). */
export const LANE_CELL = [-11, -1];

/** Sky phases a debug `phase()` call jumps to (mid-phase sky times, §12.13). */
export const PHASE_TIMES = { morning: 0.29, day: 0.53, evening: 0.8, home: 0.927, night: 0.094 };
