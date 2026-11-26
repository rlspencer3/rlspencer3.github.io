// Smart-facing rule scenes and blueprint agreement: a page script for tools/smart-regress.mjs sections A and B
// (docs/SMART_BUILD.md §9 A/B, §10, Appendix A and B). Evaluated in the game page as the body of an async function;
// returns { scenes: [{ set, grp, name, ok, got, want, … }], metric: { rows, M, perBp } }. Every scene builds a little
// world with world.add / world.load and asks js/facing.js autoFacing for the facing at one spot; "built" scenes place
// panel after panel with the auto facing and roofHeight, then check every panel. The world is left empty.
const { K } = await import('/js/config.js');
const { getDef } = await import('/js/catalog.js');
const F = await import('/js/facing.js');
const autoFacing = F.autoFacing, groupOf = F.faceGroup, roofHeightGet = F.roofHeight;
const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0], opp = (d) => (d + 2) & 3;
const SC = [];

// ----------------------------------------------------------------------------------------------------
// Appendix A (F01–F46): walls on the grass and on foundations, corners with windows, chairs round a table, hearths, stairs, steps, decks, fences, roofs, hips, an L valley, garden fronts, benches, fallbacks. Camera [0.5, 0.86].
{
const W = __hw.world;
const res = [];
const ctx0 = { get: (k) => W.get(k), cam: [0.5, 0.86], fallback: 0 };
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { ...ctx0, roofLevel: p.y, recY: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', skip = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: skip[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: skip[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: skip[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: skip[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, got, want, why) => res.push({ name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, rule: got.rule, fb: !!got.fallback, tie: !!got.tie, S: (got.scores || []).map((v) => +v.toFixed(1)).join(','), why });
const reset = () => W.load({ pieces: [] });

// 1. walls on the grass (no foundation): outward via the opposite wall
reset(); add(ring(0, 2, 0, 2, 0, 'wall'));
check('wall on grass, front edge → outward (+Z, r0)', af({ t: 'wall_window_shutters', a: 'x', x: 1, y: 0, z: 3 }), 0);
check('wall on grass, back edge → outward (−Z, r2)', af({ t: 'wall_door', a: 'x', x: 1, y: 0, z: 0 }), 2);
check('wall on grass, left edge → outward (−X, r2)', af({ t: 'wall_window', a: 'z', x: 0, y: 0, z: 1 }), 2);
check('wall on grass, right edge → outward (+X, r0)', af({ t: 'wall_window', a: 'z', x: 3, y: 0, z: 1 }), 0);
// 2. foundation house: front door outward
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2));
check('door on a foundation house front → r0', af({ t: 'wall_door', a: 'x', x: 1, y: 0, z: 3 }), 0);
check('window on the left side → r2', af({ t: 'wall_window', a: 'z', x: 0, y: 0, z: 1 }), 2);
// 3. bed in a corner: back to the wall that is a plain wall rather than the window
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2, 0, 'wall', { 'x|0|0': 'wall_window' }));
check('bed in a corner (window behind on −Z, wall on −X) → back to the wall: face +X (r1)', af({ t: 'bed', x: 0, y: 0, z: 0 }), 1);
check('wardrobe against a long wall → back to −Z (r0)', af({ t: 'wardrobe', x: 2, y: 0, z: 0 }), 0);
check('bookshelf never backs onto a door', (add([{ t: 'wall_door', a: 'x', x: 3, y: 0, z: 0, r: 2 }]), af({ t: 'bookshelf', x: 3, y: 0, z: 0 })), 3);
// 4. chair faces a table; no table → back to a wall
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3)); add([{ t: 'table', x: 1, y: 0, z: 1 }]);
check('chair west of a table → faces +X (r1)', af({ t: 'chair', x: 0, y: 0, z: 1 }), 1);
check('chair south of a table → faces −Z (r2)', af({ t: 'chair', x: 1, y: 0, z: 2 }), 2);
check('chair with no table, by the back wall → faces into the room (r0)', af({ t: 'chair', x: 3, y: 0, z: 0 }), [0, 3]);
// 5. armchair faces the fireplace (same room); not one behind a wall
reset(); add(box('foundation', 0, 4, 0, 3)); add(ring(0, 4, 0, 3)); add([{ t: 'fireplace', x: 2, y: 0, z: 0, r: 0 }]);
check('armchair two cells in front of the fireplace → faces it (−Z, r2)', af({ t: 'armchair', x: 2, y: 0, z: 2 }), 2);
check('sofa beside the hearth, diagonal → faces it', af({ t: 'sofa', x: 3, y: 0, z: 1 }), [3, 2]);
add([{ t: 'wall', a: 'z', x: 2, y: 0, z: 2 }, { t: 'wall', a: 'z', x: 2, y: 0, z: 1 }, { t: 'wall', a: 'z', x: 2, y: 0, z: 0 }, { t: 'wall', a: 'z', x: 2, y: 0, z: 3 }]);
check('armchair with the hearth behind a partition → ignores it (back to a wall)', af({ t: 'armchair', x: 1, y: 0, z: 2 }), [0, 1, 3]);
// 6. stairs: along the wall, onto the floor above, foot clear
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('floor', 0, 3, 0, 2, 1));
check('stairs by the left wall at the front → climb toward the back (r2)', (add([{ t: 'grandfather_clock', x: 0, y: 0, z: 0 }]), af({ t: 'stairs', x: 0, y: 0, z: 1 })), 2);
W.remove(K.I(0, 0, 0), { record: false });
check('stairs in the middle of the back wall → climb along the wall (r1 or r3)', af({ t: 'stairs', x: 1, y: 0, z: 0 }), [1, 3]);
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('floor', 0, 1, 0, 2, 1));
check('stairs at the loft edge → climb onto the loft (−X, r3)', af({ t: 'stairs', x: 2, y: 0, z: 1 }), 3);
check('spiral stairs at the loft edge → land on the loft (r3)', af({ t: 'stairs_spiral', x: 2, y: 0, z: 1 }), 3);
check('ladder at the loft edge → leans on the loft (r3)', af({ t: 'ladder', x: 2, y: 0, z: 1 }), 3);
// 7. porch steps climb toward the deck / foundation; a path in front
reset(); add(box('foundation', 0, 2, 0, 1)); add(box('deck', 0, 2, 2, 2)); add([{ t: 'path', x: 1, y: 0, z: 4 }]);
check('porch steps in front of the deck → climb toward it (−Z, r2)', af({ t: 'steps', x: 1, y: 0, z: 3 }), 2);
check('porch steps beside the foundation → climb toward it (+X, r1)', af({ t: 'steps', x: -1, y: 0, z: 0 }), 1);
// 8. deck boards run away from the house
reset(); add(box('foundation', 0, 2, 0, 1));
check('deck east of the house → boards along X (r0)', af({ t: 'deck', x: 3, y: 0, z: 0 }), 0);
check('deck south of the house → boards along Z (r1)', af({ t: 'deck', x: 0, y: 0, z: 2 }), 1);
// 9. fences: pickets toward the street (away from the house)
reset(); add(box('foundation', 0, 2, 0, 2)); add(ring(0, 2, 0, 2));
check('fence south of the house → pickets +Z (r0)', af({ t: 'fence_picket', a: 'x', x: 1, y: 0, z: 6 }), 0);
check('fence north of the house → pickets −Z (r2)', af({ t: 'fence_picket', a: 'x', x: 1, y: 0, z: -3 }), 2);
check('hedge west of the house → face −X (r2)', af({ t: 'hedge', a: 'z', x: -3, y: 0, z: 1 }), 2);
// 10. roofs: a 4 × 6 house → ridge along Z, slopes face ±X; a square house with a front door → gable over the door
reset(); add(box('foundation', 0, 3, 0, 5)); add(ring(0, 3, 0, 5));
check('roof slope, west eave of a 4×6 house → downhill −X (r1)', af({ t: 'roof_slope', x: 0, y: 1, z: 2 }), 1);
check('roof slope, east eave → downhill +X (r3)', af({ t: 'roof_slope', x: 3, y: 1, z: 2 }), 3);
check('roof slope, north row middle of 4×6 → still across the short span (r1 / r3)', af({ t: 'roof_slope', x: 1, y: 1, z: 0 }), [1]);
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3, 0, 'wall', { 'x|1|4': 'wall_door' }));
check('square house, door on the front: west eave → slopes ±X (gable over the door, r1)', af({ t: 'roof_slope', x: 0, y: 1, z: 1 }), 1);
add([{ t: 'roof_slope', x: 0, y: 1, z: 1, r: 1 }]);
check('next panel along the row copies it (r1)', af({ t: 'roof_slope', x: 0, y: 1, z: 2 }), 1);
check('panel above it stacks on it (r1, h 1)', af({ t: 'roof_slope', x: 1, y: 1, z: 1 }), 1);
// 11. hip corners and an L valley
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3));
check('hip corner NW → r0', af({ t: 'roof_corner', x: 0, y: 1, z: 0 }), 0);
check('hip corner NE → r3', af({ t: 'roof_corner', x: 3, y: 1, z: 0 }), 3);
check('hip corner SE → r2', af({ t: 'roof_corner', x: 3, y: 1, z: 3 }), 2);
check('hip corner SW → r1', af({ t: 'roof_corner', x: 0, y: 1, z: 3 }), 1);
reset(); add([...box('foundation', 0, 3, 0, 1), ...box('foundation', 0, 1, 2, 3)]);
add([{ t: 'wall', a: 'x', x: 0, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 1, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 2, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 3, y: 0, z: 0 },
  { t: 'wall', a: 'z', x: 4, y: 0, z: 0 }, { t: 'wall', a: 'z', x: 4, y: 0, z: 1 }, { t: 'wall', a: 'x', x: 2, y: 0, z: 2 }, { t: 'wall', a: 'x', x: 3, y: 0, z: 2 },
  { t: 'wall', a: 'z', x: 2, y: 0, z: 2 }, { t: 'wall', a: 'z', x: 2, y: 0, z: 3 }, { t: 'wall', a: 'x', x: 0, y: 0, z: 4 }, { t: 'wall', a: 'x', x: 1, y: 0, z: 4 },
  { t: 'wall', a: 'z', x: 0, y: 0, z: 0 }, { t: 'wall', a: 'z', x: 0, y: 0, z: 1 }, { t: 'wall', a: 'z', x: 0, y: 0, z: 2 }, { t: 'wall', a: 'z', x: 0, y: 0, z: 3 }]);
check('valley at the inside corner of an L → low corner into the notch (r2)', af({ t: 'roof_inner', x: 1, y: 1, z: 1 }), 2);
// 12. garden: bench faces the pond; mailbox faces away from the house; bench on the porch faces out
reset(); add(box('foundation', 0, 2, 0, 1)); add(ring(0, 2, 0, 1)); add([{ t: 'pond', x: 6, y: 0, z: 6 }]);
check('bench two cells west of a pond → faces it (+X, r1)', af({ t: 'bench', x: 4, y: 0, z: 6 }), 1);
check('mailbox south of the house → faces the street (+Z, r0)', af({ t: 'mailbox', x: 1, y: 0, z: 4 }), 0);
add(box('deck', 0, 2, 2, 2));
check('bench on the porch against the house → faces out (+Z, r0)', af({ t: 'bench', x: 1, y: 0, z: 2 }), 0);
check('rocking chair on the porch → faces out (r0)', af({ t: 'rocking_chair', x: 0, y: 0, z: 2 }), 0);
check('tree: no reason → the fallback (r0)', af({ t: 'tree_oak', x: 7, y: 0, z: -5 }), 0);
check('tree: fallback follows the last chosen facing (r3)', af({ t: 'tree_oak', x: 7, y: 0, z: -5 }, { fallback: 3 }), 3);
check('bench in an empty meadow → the fallback (r2)', (reset(), af({ t: 'bench', x: 0, y: 0, z: 0 }, { fallback: 2 })), 2);
// 13. a lean-to porch roof against the house (no main roof yet): downhill away from the house
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 3, 0, { r: 1 }));
add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 4 })).concat([{ t: 'beam', a: 'z', x: 0, y: 0, z: 3 }, { t: 'beam', a: 'z', x: 4, y: 0, z: 3 }]));
check('porch roof panel on the porch beams → downhill away from the house (+Z, r2)', af({ t: 'roof_slope', x: 1, y: 1, z: 3 }), 2);
reset();
SC.push(...res.map((r) => ({ ...r, set: 'A' })));
}

// ----------------------------------------------------------------------------------------------------
// Appendix B, C1: the design critique's set 1 (corners, hearths, desks, benches and fences by the path, L houses, lean-tos, valleys).
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(Math.PI * 0.25), Math.cos(Math.PI * 0.25)];   // the rig's default view (theta = π/4)
const ctx0 = { get: (k) => W.get(k), cam: CAM, fallback: 0 };
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { ...ctx0, roofLevel: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: got.scores.map((v) => +v.toFixed(1)).join(','), why: got.why.join(';') });
  return got;
};
const reset = () => W.load({ pieces: [] });
const place = (p, extra) => { const g = af(p, extra); const q = { ...p, r: g.r }; if (getDef(p.t).layer === 'R') q.h = roofHeightGet(W.get.bind(W), getDef(p.t), p.x, p.z, g.r, p.y); add([q]); return q; };

// ---- furniture
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3));
check('bed in a plain corner (0,0) → back to a wall (r0 or r1)', { t: 'bed', x: 0, y: 0, z: 0 }, [0, 1]);
check('sofa in the middle of a 4x4 room (1,1), no hearth → any facing into room', { t: 'sofa', x: 1, y: 0, z: 1 }, [0, 1, 2, 3]);
check('chair with no table, room middle (2,2)', { t: 'chair', x: 2, y: 0, z: 2 }, [0, 1, 2, 3]);
reset(); add(box('foundation', 0, 4, 0, 3)); add(ring(0, 4, 0, 3)); add([{ t: 'fireplace', x: 2, y: 0, z: 0, r: 0 }]);
check('armchair beside the fireplace on the same wall (1,0) → into the room (r0), not into the hearth side', { t: 'armchair', x: 1, y: 0, z: 0 }, [0]);
check('sofa beside the fireplace on the same wall (3,0) → into the room (r0)', { t: 'sofa', x: 3, y: 0, z: 0 }, [0]);
check('armchair BEHIND the fireplace line? (2,1) right in front → faces it (r2)', { t: 'armchair', x: 2, y: 0, z: 1 }, [2]);
check('sofa 3 cells in front of the fireplace (2,3) → faces it (r2)', { t: 'sofa', x: 2, y: 0, z: 3 }, [2]);
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3)); add([{ t: 'desk', x: 1, y: 0, z: 0, r: 0 }]);
check('chair east of a desk (2,0) (desk faces +Z) → should not face the desk side', { t: 'chair', x: 2, y: 0, z: 0 }, [0, 3]);
check('chair in front of the desk (1,1) — the desk already has its own chair there', { t: 'chair', x: 1, y: 0, z: 1 }, [0, 1, 2, 3]);
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3, 0, 'wall', { 'x|0|0': 'wall_window', 'z|0|0': 'wall_window' }));
check('wardrobe in a corner between two windows (0,0)', { t: 'wardrobe', x: 0, y: 0, z: 0 }, [0, 1]);
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3, 0, 'wall', { 'x|1|0': 'wall_door' }));
check('bed whose only near wall is a door, cell (1,0) → not back to the door', { t: 'bed', x: 1, y: 0, z: 0 }, [1, 3]);

// ---- outdoors
reset();
check('bench in the open meadow, fallback 2 → fallback', { t: 'bench', x: 0, y: 0, z: 0 }, [2], { fallback: 2 });
check('rocking chair in the open meadow, fallback 2 → fallback', { t: 'rocking_chair', x: 0, y: 0, z: 0 }, [2], { fallback: 2 });
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2, 0, 'wall', { 'x|1|3': 'wall_door' }));
add([{ t: 'path', x: 1, y: 0, z: 3 }, { t: 'path', x: 1, y: 0, z: 4 }, { t: 'path', x: 1, y: 0, z: 5 }, { t: 'path', x: 1, y: 0, z: 6 }]);
// fences along both sides of the front path: axis z edges at x=1 (west side) and x=2 (east side), z 4..6
for (const z of [4, 5, 6]) {
  check(`picket fence WEST of the path (z ${z}) → pickets toward the path (+X, r0)`, { t: 'fence_picket', a: 'z', x: 1, y: 0, z }, [0]);
  check(`picket fence EAST of the path (z ${z}) → pickets toward the path (−X, r2)`, { t: 'fence_picket', a: 'z', x: 2, y: 0, z }, [2]);
}
check('bench beside the path (0,5) → faces the path (+X, r1)', { t: 'bench', x: 0, y: 0, z: 5 }, [1]);
check('mailbox at the path end (2,6) → door toward the path/street', { t: 'mailbox', x: 2, y: 0, z: 6 }, [0, 3]);
// two houses near each other on grass
reset(); add(ring(0, 2, 0, 2)); add(ring(5, 7, 0, 2));
check('grass house A east wall (x 3), house B 2 cells away → outward (+X, r0)', { t: 'wall_window_shutters', a: 'z', x: 3, y: 0, z: 1 }, [0]);
check('grass house B west wall (x 5) → outward (−X, r2)', { t: 'wall_window_shutters', a: 'z', x: 5, y: 0, z: 1 }, [2]);
// a garden wall: half wall standing alone near the house (decorative)
// edge of the lot
reset(); add(box('foundation', 7, 9, 0, 2)); add(ring(7, 9, 0, 2));
check('wall on the lot edge (x 10) → outward (+X, r0)', { t: 'wall_door', a: 'z', x: 10, y: 0, z: 1 }, [0]);
check('hedge on the lot boundary (x 10, z 6) → good side out (+X, r0)', { t: 'hedge', a: 'z', x: 10, y: 0, z: 6 }, [0]);

// ---- interior walls
reset(); add(box('foundation', 0, 5, 0, 2)); add(ring(0, 5, 0, 2));
check('door in a partition between two rooms (x 3) → either', { t: 'wall_door', a: 'z', x: 3, y: 0, z: 1 }, [0, 2]);
// shuttered window on a wall with rooms both sides (shutters show only without floors)

// ---- stairs
reset(); add(box('foundation', 0, 0, 0, 3)); add(ring(0, 0, 0, 3)); add(box('floor', 0, 0, 0, 3, 1));
check('stairs in a 1-cell hall (0,1), floor above everywhere → along the hall (r0 or r2)', { t: 'stairs', x: 0, y: 0, z: 1 }, [0, 2]);
check('stairs at the hall end (0,0) → climbs away from the end wall (r0)', { t: 'stairs', x: 0, y: 0, z: 0 }, [0]);
reset(); add(box('foundation', 0, 0, 0, 3)); add(ring(0, 0, 0, 3)); add(box('floor', 0, 0, 0, 1, 1));
check('stairs in a 1-cell hall up to a half loft (0,2) → climbs onto it (r2)', { t: 'stairs', x: 0, y: 0, z: 2 }, [2]);

// ---- roofs: L-shaped house, empty roof, each cell's FIRST panel
reset();
const L1 = [...box('foundation', 0, 5, 0, 1), ...box('foundation', 0, 1, 2, 5)];
add(L1);
const lw = [];
for (let x = 0; x <= 5; x++) lw.push({ t: 'wall', a: 'x', x, y: 0, z: 0 });
for (let x = 2; x <= 5; x++) lw.push({ t: 'wall', a: 'x', x, y: 0, z: 2 });
for (let x = 0; x <= 1; x++) lw.push({ t: 'wall', a: 'x', x, y: 0, z: 6 });
for (let z = 0; z <= 5; z++) lw.push({ t: 'wall', a: 'z', x: 0, y: 0, z });
for (let z = 0; z <= 1; z++) lw.push({ t: 'wall', a: 'z', x: 6, y: 0, z });
for (let z = 2; z <= 5; z++) lw.push({ t: 'wall', a: 'z', x: 2, y: 0, z });
add(lw);
const Lgrid = {};
for (const [x, z] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4], [1, 4], [0, 5], [1, 5]]) {
  const g = af({ t: 'roof_slope', x, y: 1, z });
  Lgrid[`${x},${z}`] = g.r + (g.tie ? 't' : '') + (g.fallback ? 'f' : '');
}
res.push({ name: 'L house first-panel facings', ok: true, got: JSON.stringify(Lgrid) });
// eave-first build of the L: wing rows in order (x along z=0 row, then z=1 row, ...)
const Lbuild = {};
for (const [x, z] of [[2, 0], [3, 0], [4, 0], [5, 0], [2, 1], [3, 1], [4, 1], [5, 1], [0, 3], [0, 4], [0, 5], [1, 3], [1, 4], [1, 5], [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]) {
  const q = place({ t: 'roof_slope', x, y: 1, z });
  Lbuild[`${x},${z}`] = q.r + '/h' + q.h;
}
res.push({ name: 'L house built wing by wing', ok: true, got: JSON.stringify(Lbuild) });

// ---- lean-to against a 2-storey house: extension x 4..5 (2 deep) beside a 4x4 house with 2 storeys
reset(); add(box('foundation', 0, 5, 0, 3)); add(ring(0, 3, 0, 3)); add(box('floor', 0, 3, 0, 3, 1)); add(ring(0, 3, 0, 3, 1));
add([{ t: 'wall', a: 'x', x: 4, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 5, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 4, y: 0, z: 4 }, { t: 'wall', a: 'x', x: 5, y: 0, z: 4 }]);
for (let z = 0; z <= 3; z++) add([{ t: 'wall', a: 'z', x: 6, y: 0, z }]);
check('lean-to 2 deep against a 2-storey wall, cell next to the house (4,1) → downhill away (+X: r3)', { t: 'roof_slope', x: 4, y: 1, z: 1 }, [3]);
check('lean-to 2 deep, outer cell (5,1) → downhill away (+X: r3)', { t: 'roof_slope', x: 5, y: 1, z: 1 }, [3]);
// porch 2 deep with beams on the front
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 4, 0, { r: 1 }));
add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 5 })).concat([3, 4].flatMap((z) => [{ t: 'beam', a: 'z', x: 0, y: 0, z }, { t: 'beam', a: 'z', x: 4, y: 0, z }])));
check('porch roof 2 deep, cell next to the house (1,3) → downhill away (+Z: r2)', { t: 'roof_slope', x: 1, y: 1, z: 3 }, [2]);
check('porch roof 2 deep, outer cell (1,4) → downhill away (+Z: r2)', { t: 'roof_slope', x: 1, y: 1, z: 4 }, [2]);

// ---- valleys in all four L orientations (literal covered() = roofReach(c, lv, 0, max 0))
const valley = (mirrorX, mirrorZ) => {
  reset();
  const fx = (x) => (mirrorX ? 3 - x : x), fz = (z) => (mirrorZ ? 3 - z : z);
  const cells = [...box('foundation', 0, 3, 0, 1), ...box('foundation', 0, 1, 2, 3)].map((q) => ({ ...q, x: fx(q.x), z: fz(q.z) }));
  add(cells);
  const set = new Set(cells.map((q) => `${q.x},${q.z}`));
  const ws = [];
  for (const q of cells) for (let d = 0; d < 4; d++) {
    const nx = q.x + DX[d], nz = q.z + DZ[d];
    if (set.has(`${nx},${nz}`)) continue;
    ws.push(d === 0 ? { t: 'wall', a: 'x', x: q.x, y: 0, z: q.z + 1 } : d === 1 ? { t: 'wall', a: 'z', x: q.x + 1, y: 0, z: q.z } : d === 2 ? { t: 'wall', a: 'x', x: q.x, y: 0, z: q.z } : { t: 'wall', a: 'z', x: q.x, y: 0, z: q.z });
  }
  add(ws);
  // valley sits at the inner corner cell (1,1) mirrored; its low corner points at the notch (2,2) mirrored
  const vx = fx(1), vz = fz(1);
  // low corner at local (−X, −Z): r such that opp(r) and r+3 point to the notch
  const want = [0, 1, 2, 3].filter((r) => { const a = opp(r), b = (r + 3) & 3; return vx + DX[a] + DX[b] === fx(2) && vz + DZ[a] + DZ[b] === fz(2); });
  check(`valley at the inner corner, L mirrored x${+mirrorX} z${+mirrorZ}`, { t: 'roof_inner', x: vx, y: 1, z: vz }, want);
};
valley(false, false); valley(true, false); valley(false, true); valley(true, true);

reset();
SC.push(...res.map((r) => ({ ...r, set: 'C1' })));
}

// ----------------------------------------------------------------------------------------------------
// Appendix B, C2: the critique's set 2 (porch after a front-sloping roof, a 3-deep lean-to, valleys and hips after the wings, a partition window, a gable with no roof).
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(Math.PI * 0.25), Math.cos(Math.PI * 0.25)];   // the rig's default view (theta = π/4)
const ctx0 = { get: (k) => W.get(k), cam: CAM, fallback: 0 };
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { ...ctx0, roofLevel: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: got.scores.map((v) => +v.toFixed(1)).join(','), why: got.why.join(';') });
  return got;
};
const reset = () => W.load({ pieces: [] });
const place = (p, extra) => { const g = af(p, extra); const q = { ...p, r: g.r }; if (getDef(p.t).layer === 'R') q.h = roofHeightGet(W.get.bind(W), getDef(p.t), p.x, p.z, g.r, p.y); add([q]); return q; };


// ---- porch roof after the house roof (1-storey house 4x3, gable roof ridge along X, 2-deep porch with beams)
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 4, 0, { r: 1 }));
add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 5 })).concat([3, 4].flatMap((z) => [{ t: 'beam', a: 'z', x: 0, y: 0, z }, { t: 'beam', a: 'z', x: 4, y: 0, z }])));
// a shed roof over the house sloping to the front (all panels r2, stacked from the front eave z=2 up to z=0)
for (let x = 0; x <= 3; x++) add([{ t: 'roof_slope', x, y: 1, z: 2, r: 2, h: 0 }, { t: 'roof_slope', x, y: 1, z: 1, r: 2, h: 1 }, { t: 'roof_slope', x, y: 1, z: 0, r: 2, h: 2 }]);
check('porch roof 2 deep after a front-sloping house roof, cell next to house (1,3) → continue downhill (+Z: r2)', { t: 'roof_slope', x: 1, y: 1, z: 3 }, [2]);
// ---- 3-deep lean-to shed against a 2-storey wall
reset(); add(box('foundation', 0, 6, 0, 3)); add(ring(0, 3, 0, 3)); add(box('floor', 0, 3, 0, 3, 1)); add(ring(0, 3, 0, 3, 1));
for (const x of [4, 5, 6]) add([{ t: 'wall', a: 'x', x, y: 0, z: 0 }, { t: 'wall', a: 'x', x, y: 0, z: 4 }]);
for (let z = 0; z <= 3; z++) add([{ t: 'wall', a: 'z', x: 7, y: 0, z }]);
const lt = [];
for (const x of [4, 5, 6]) { const g = af({ t: 'roof_slope', x, y: 1, z: 1 }); lt.push(x + ':' + g.r + (g.tie ? 't' : '')); }
res.push({ name: 'lean-to 3 deep against a 2-storey wall (x 4,5,6): want all r3 (downhill +X)', ok: lt.join(' ') === '4:3 5:3 6:3', got: lt.join(' ') });
// ---- valleys after the wing slopes exist (the normal order), all four L orientations
const valley2 = (mirrorX, mirrorZ) => {
  reset();
  const fx = (x) => (mirrorX ? 5 - x : x), fz = (z) => (mirrorZ ? 5 - z : z);
  // L: horizontal wing x0..5 z0..1, vertical wing x0..1 z2..5 (2 deep each)
  const cells = [...box('foundation', 0, 5, 0, 1), ...box('foundation', 0, 1, 2, 5)].map((q) => ({ ...q, x: fx(q.x), z: fz(q.z) }));
  add(cells);
  const set = new Set(cells.map((q) => q.x + ',' + q.z));
  const ws = [];
  for (const q of cells) for (let d = 0; d < 4; d++) {
    if (set.has((q.x + DX[d]) + ',' + (q.z + DZ[d]))) continue;
    ws.push(d === 0 ? { t: 'wall', a: 'x', x: q.x, y: 0, z: q.z + 1 } : d === 1 ? { t: 'wall', a: 'z', x: q.x + 1, y: 0, z: q.z } : d === 2 ? { t: 'wall', a: 'x', x: q.x, y: 0, z: q.z } : { t: 'wall', a: 'z', x: q.x, y: 0, z: q.z });
  }
  add(ws);
  // wing slopes (unmirrored): horizontal wing x2..5: z0 r0, z1 r2 ; vertical wing z2..5: x0 r1, x1 r3
  const mr = (r) => { let rr = r; if (mirrorX && (rr === 1 || rr === 3)) rr = (rr + 2) & 3; if (mirrorZ && (rr === 0 || rr === 2)) rr = (rr + 2) & 3; return rr; };
  for (let x = 2; x <= 5; x++) add([{ t: 'roof_slope', x: fx(x), y: 1, z: fz(0), r: mr(0), h: 0 }, { t: 'roof_slope', x: fx(x), y: 1, z: fz(1), r: mr(2), h: 0 }]);
  for (let z = 2; z <= 5; z++) add([{ t: 'roof_slope', x: fx(0), y: 1, z: fz(z), r: mr(1), h: 0 }, { t: 'roof_slope', x: fx(1), y: 1, z: fz(z), r: mr(3), h: 0 }]);
  const vx = fx(1), vz = fz(1);
  const want = [0, 1, 2, 3].filter((r) => { const a = opp(r), b = (r + 3) & 3; return vx + DX[a] + DX[b] === fx(2) && vz + DZ[a] + DZ[b] === fz(2); });
  check('valley at the inner corner after the wings, mirror x' + (+mirrorX) + ' z' + (+mirrorZ), { t: 'roof_inner', x: vx, y: 1, z: vz }, want);
  const hx = fx(0), hz = fz(0);
  // the outer corner (0,0): hip low along the two outer walls (−X and −Z unmirrored → r0)
  const wantH = [0, 1, 2, 3].filter((r) => { const lo1 = opp(r), lo2 = (r + 3) & 3; const outs = [lo1, lo2].map((d) => set.has((hx + DX[d]) + ',' + (hz + DZ[d]))); return !outs[0] && !outs[1]; });
  check('hip at the outer corner after the wings, mirror x' + (+mirrorX) + ' z' + (+mirrorZ), { t: 'roof_corner', x: hx, y: 1, z: hz }, wantH);
};
valley2(false, false); valley2(true, false); valley2(false, true); valley2(true, true);
// ---- window between two rooms; shuttered window on a partition
reset(); add(box('foundation', 0, 5, 0, 2)); add(ring(0, 5, 0, 2));
check('shuttered window on a partition (x 3) → no signal, fallback', { t: 'wall_window_shutters', a: 'z', x: 3, y: 0, z: 1 }, [0, 2]);
// ---- gable wall with no roof yet: wallEdge facing decides which end is HIGH
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2));
check('gable with no roof on the left wall (fallback/wallEdge)', { t: 'gable', a: 'z', x: 0, y: 1, z: 1 }, [0, 2]);
reset();
SC.push(...res.map((r) => ({ ...r, set: 'C2' })));
}

// ----------------------------------------------------------------------------------------------------
// Appendix B, C3: the critique's set 3 (garden things with a front against the front, east and back walls and off the west wall).
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(Math.PI * 0.25), Math.cos(Math.PI * 0.25)];   // the rig's default view (theta = π/4)
const ctx0 = { get: (k) => W.get(k), cam: CAM, fallback: 0 };
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { ...ctx0, roofLevel: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: got.scores.map((v) => +v.toFixed(1)).join(','), why: got.why.join(';') });
  return got;
};
const reset = () => W.load({ pieces: [] });
const place = (p, extra) => { const g = af(p, extra); const q = { ...p, r: g.r }; if (getDef(p.t).layer === 'R') q.h = roofHeightGet(W.get.bind(W), getDef(p.t), p.x, p.z, g.r, p.y); add([q]); return q; };


reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2));
for (const t of ['woodpile', 'mailbox', 'birdhouse', 'lamp_post', 'beehive', 'doghouse', 'wheelbarrow']) {
  check(t + ' right against the front wall outside (1,3) → away from the house (+Z, r0)', { t, x: 1, y: 0, z: 3 }, [0]);
  check(t + ' right against the east wall outside (4,1) → away (+X, r1)', { t, x: 4, y: 0, z: 1 }, [1]);
  check(t + ' against the back wall outside (2,-1) → away (−Z, r2)', { t, x: 2, y: 0, z: -1 }, [2]);
  check(t + ' two cells off the west wall (-2,1) → away (−X, r3)', { t, x: -2, y: 0, z: 1 }, [3]);
}
reset();
SC.push(...res.map((r) => ({ ...r, set: 'C3' })));
}

// ----------------------------------------------------------------------------------------------------
// Appendix B, N1–N17: the revision-2 scenes (lean-tos, porch roofs, gable ends, seats by a hearth, benches, garden fronts on every side, a second deck row, fences by the path, a chair by a desk, the meadow).
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(Math.PI * 0.25), Math.cos(Math.PI * 0.25)];   // the rig's default view (theta = π/4)
const ctx0 = { get: (k) => W.get(k), cam: CAM, fallback: 0 };
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { ...ctx0, roofLevel: p.y, recY: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: (got.scores || []).map((v) => +v.toFixed(1)).join(','), why: (got.why || []).join(';') });
  return got;
};
const reset = () => W.load({ pieces: [] });
const place = (p, extra) => { const g = af(p, extra); const q = { ...p, r: g.r }; if (getDef(p.t).layer === 'R') q.h = roofHeightGet(W.get.bind(W), getDef(p.t), p.x, p.z, g.r, p.y); add([q]); return q; };

// N1-N4: lean-tos 1, 2 and 3 deep against a 2-storey house, built from the house outward, then a second row
for (const deep of [1, 2, 3]) {
  reset(); add(box('foundation', 0, 3 + deep, 0, 3)); add(ring(0, 3, 0, 3)); add(box('floor', 0, 3, 0, 3, 1)); add(ring(0, 3, 0, 3, 1));
  for (let x = 4; x < 4 + deep; x++) add([{ t: 'wall', a: 'x', x, y: 0, z: 0 }, { t: 'wall', a: 'x', x, y: 0, z: 4 }]);
  for (let z = 0; z <= 3; z++) add([{ t: 'wall', a: 'z', x: 4 + deep, y: 0, z }]);
  for (let x = 4; x < 4 + deep; x++) check(`lean-to ${deep} deep against a 2-storey wall, first panel at x ${x} → downhill away (r3)`, { t: 'roof_slope', x, y: 1, z: 1 }, 3);
  // built panel by panel from the outer eave in, then along the rows
  const got = [];
  for (const z of [1, 2, 0, 3]) for (let x = 3 + deep; x >= 4; x--) got.push(place({ t: 'roof_slope', x, y: 1, z }).r);
  res.push({ name: `lean-to ${deep} deep built eave-first, every panel r3`, ok: got.every((r) => r === 3), got: got.join('') });
}
// N4b: a 2-deep lean-to against the 2-storey house AFTER the house roof is on (gable over Floor 2, ridge along X)
reset(); add(box('foundation', 0, 5, 0, 3)); add(ring(0, 3, 0, 3)); add(box('floor', 0, 3, 0, 3, 1)); add(ring(0, 3, 0, 3, 1));
for (let x = 0; x <= 3; x++) add([{ t: 'roof_slope', x, y: 2, z: 0, r: 0, h: 0 }, { t: 'roof_slope', x, y: 2, z: 1, r: 0, h: 1 }, { t: 'roof_slope', x, y: 2, z: 3, r: 2, h: 0 }, { t: 'roof_slope', x, y: 2, z: 2, r: 2, h: 1 }]);
for (const x of [4, 5]) add([{ t: 'wall', a: 'x', x, y: 0, z: 0 }, { t: 'wall', a: 'x', x, y: 0, z: 4 }]);
for (let z = 0; z <= 3; z++) add([{ t: 'wall', a: 'z', x: 6, y: 0, z }]);
check('lean-to 2 deep after the house roof is on, inner panel (4,1) → r3', { t: 'roof_slope', x: 4, y: 1, z: 1 }, 3);
check('lean-to 2 deep after the house roof is on, outer panel (5,2) → r3', { t: 'roof_slope', x: 5, y: 1, z: 2 }, 3);
// N5-N6: porches 2 and 3 deep on a 1-storey house (no house roof yet), beams round the porch
for (const deep of [2, 3]) {
  reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 2 + deep, 0, { r: 1 }));
  add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 3 + deep })));
  for (let z = 3; z < 3 + deep; z++) add([{ t: 'beam', a: 'z', x: 0, y: 0, z }, { t: 'beam', a: 'z', x: 4, y: 0, z }]);
  for (let z = 3; z < 3 + deep; z++) check(`porch roof ${deep} deep, no house roof, first panel at z ${z} → downhill away (r2)`, { t: 'roof_slope', x: 1, y: 1, z }, 2);
}
// N7: a 2-deep porch after a house roof that slopes to the front (shed) and after a gable roof (ridge along X)
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 4, 0, { r: 1 }));
add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 5 })).concat([3, 4].flatMap((z) => [{ t: 'beam', a: 'z', x: 0, y: 0, z }, { t: 'beam', a: 'z', x: 4, y: 0, z }])));
for (let x = 0; x <= 3; x++) add([{ t: 'roof_slope', x, y: 1, z: 2, r: 2, h: 0 }, { t: 'roof_slope', x, y: 1, z: 1, r: 2, h: 1 }, { t: 'roof_slope', x, y: 1, z: 0, r: 2, h: 2 }]);
check('2-deep porch after a front-sloping house roof, inner row (1,3) → r2', { t: 'roof_slope', x: 1, y: 1, z: 3 }, 2);
check('2-deep porch after a front-sloping house roof, outer row (1,4) → r2', { t: 'roof_slope', x: 1, y: 1, z: 4 }, 2);
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2)); add(box('deck', 0, 3, 3, 4, 0, { r: 1 }));
add([0, 1, 2, 3].map((x) => ({ t: 'beam', a: 'x', x, y: 0, z: 5 })).concat([3, 4].flatMap((z) => [{ t: 'beam', a: 'z', x: 0, y: 0, z }, { t: 'beam', a: 'z', x: 4, y: 0, z }])));
for (let x = 0; x <= 3; x++) add([{ t: 'roof_slope', x, y: 1, z: 0, r: 0, h: 0 }, { t: 'roof_slope', x, y: 1, z: 2, r: 2, h: 0 }, { t: 'roof_slope', x, y: 1, z: 1, r: 2, h: 1 }]);
check('2-deep porch after a gable house roof, inner row (2,3) → r2', { t: 'roof_slope', x: 2, y: 1, z: 3 }, 2);
// N8: the ordinary gable roof is not a lean-to: a 1-storey 4 × 6 house keeps its eaves (gables present)
reset(); add(box('foundation', 0, 3, 0, 5)); add(ring(0, 3, 0, 5));
add([0, 1, 2, 3].flatMap((x) => [{ t: 'gable', a: 'x', x, y: 1, z: 0, r: 0 }, { t: 'gable', a: 'x', x, y: 1, z: 6, r: 0 }]));
check('4×6 house with gables: west eave stays r1 (gables are not taller walls)', { t: 'roof_slope', x: 0, y: 1, z: 2 }, 1);
check('4×6 house with gables: east eave stays r3', { t: 'roof_slope', x: 3, y: 1, z: 2 }, 3);
// N9: the upper storey's roof on a 2-storey house is unaffected (its walls are the top)
reset(); add(box('foundation', 0, 3, 0, 5)); add(ring(0, 3, 0, 5)); add(box('floor', 0, 3, 0, 5, 1)); add(ring(0, 3, 0, 5, 1));
check('2-storey 4×6 house, roof over Floor 2: west eave r1', { t: 'roof_slope', x: 0, y: 2, z: 2 }, 1);

// N10: a seat beside the hearth on the same wall faces the room; in front of it, faces the fire
reset(); add(box('foundation', 0, 4, 0, 3)); add(ring(0, 4, 0, 3)); add([{ t: 'fireplace', x: 2, y: 0, z: 0, r: 0 }]);
check('armchair beside the hearth on the same wall (1,0) → into the room (r0)', { t: 'armchair', x: 1, y: 0, z: 0 }, 0);
check('sofa beside the hearth on the same wall (3,0) → into the room (r0)', { t: 'sofa', x: 3, y: 0, z: 0 }, 0);
check('armchair in front of the hearth (2,1) → faces it (r2)', { t: 'armchair', x: 2, y: 0, z: 1 }, 2);
check('rocking chair diagonal in front (1,1) → toward the hearth (r2 or r1)', { t: 'rocking_chair', x: 1, y: 0, z: 1 }, [1, 2]);
reset(); add(box('foundation', 0, 3, 0, 4)); add(ring(0, 3, 0, 4)); add([{ t: 'wood_stove', x: 0, y: 0, z: 2, r: 1 }]);
check('sofa beside a stove on the left wall (0,1) → into the room (r1)', { t: 'sofa', x: 0, y: 0, z: 1 }, 1);
check('armchair two cells in front of the stove (2,2) → faces it (r3)', { t: 'armchair', x: 2, y: 0, z: 2 }, 3);

// N12: garden pieces with a front, right against each wall of a FOUNDATION house and of a house on the grass
for (const found of [true, false]) {
  reset(); if (found) add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2));
  for (const t of ['woodpile', 'mailbox', 'beehive', 'doghouse']) {
    check(`${t} against the front wall (${found ? 'foundation' : 'grass'}) → r0`, { t, x: 1, y: 0, z: 3 }, 0);
    check(`${t} against the back wall (${found ? 'foundation' : 'grass'}) → r2`, { t, x: 2, y: 0, z: -1 }, 2);
    check(`${t} against the east wall (${found ? 'foundation' : 'grass'}) → r1`, { t, x: 4, y: 0, z: 1 }, 1);
    check(`${t} against the west wall (${found ? 'foundation' : 'grass'}) → r3`, { t, x: -1, y: 0, z: 1 }, 3);
    check(`${t} two cells off the front (${found ? 'foundation' : 'grass'}) → r0`, { t, x: 2, y: 0, z: 4 }, 0);
    check(`${t} off the NE corner, diagonal (${found ? "foundation" : "grass"}) → r1 or r2`, { t, x: 5, y: 0, z: -2 }, [1, 2]);
  }
}
// N11: bench facing the house from the garden (no path, no focal) and on a porch
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2));
check('bench three cells in front of the house (1,6) → faces the house (r2)', { t: 'bench', x: 1, y: 0, z: 6 }, 2);
check('bench beside the east wall (5,1) → faces the house (r3)', { t: 'bench', x: 5, y: 0, z: 1 }, 3);
check('bench right against the front wall (2,3) → its back to the wall (r0)', { t: 'bench', x: 2, y: 0, z: 3 }, 0);
// N14: fences on both sides of the path to the front door, and a fence across the yard front
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2, 0, 'wall', { 'x|1|3': 'wall_door' }));
for (let z = 3; z <= 8; z++) add([{ t: 'path', x: 1, y: 0, z }]);
for (const z of [4, 6, 8]) {
  check(`picket fence west of the path (z ${z}) → pickets toward the path (r0)`, { t: 'fence_picket', a: 'z', x: 1, y: 0, z }, 0);
  check(`picket fence east of the path (z ${z}) → pickets toward the path (r2)`, { t: 'fence_picket', a: 'z', x: 2, y: 0, z }, 2);
}
check('hedge along the yard front (axis x, x 3, z 9), no path beside → away from the house (r0)', { t: 'hedge', a: 'x', x: 3, y: 0, z: 9 }, 0);
check('fence on the west side of the yard (axis z, x −2, z 1) → away from the house (r2)', { t: 'fence_picket', a: 'z', x: -2, y: 0, z: 1 }, 2);
check('fence continuing the front wall line (axis x, x 5, z 3) → no house side: collinear / camera, never a crash', { t: 'fence_picket', a: 'x', x: 5, y: 0, z: 3 }, [0, 2]);
// N15: chair beside a desk never turns to the desk's side (a desk brings its own chair)
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3)); add([{ t: 'desk', x: 1, y: 0, z: 0, r: 0 }]);
check('chair east of a desk (2,0) → back to the wall (r0), not the desk side', { t: 'chair', x: 2, y: 0, z: 0 }, 0);
// N16: bench and rocking chair in the open meadow → the fallback; a bench by a path in the meadow → faces it
reset();
check('bench in the open meadow, fallback 2 → 2', { t: 'bench', x: 0, y: 0, z: 0 }, 2, { fallback: 2 });
check('rocking chair in the open meadow, fallback 3 → 3', { t: 'rocking_chair', x: 0, y: 0, z: 0 }, 3, { fallback: 3 });
add([{ t: 'path', x: 1, y: 0, z: 0 }, { t: 'path', x: 1, y: 0, z: 1 }]);
check('bench beside a meadow path (0,0) → faces it (r1)', { t: 'bench', x: 0, y: 0, z: 0 }, 1, { fallback: 2 });
// N13: a second deck row (the house two cells away) still runs its boards away from the house
reset(); add(box('foundation', 0, 2, 0, 1)); add(box('deck', 0, 2, 2, 2, 0, { r: 1 }).filter((q) => q.x !== 1));
check('second deck row (1,3) with no deck neighbour on its row → boards along Z (r1)', { t: 'deck', x: 1, y: 0, z: 3 }, [1]);
reset(); add(box('foundation', 0, 2, 0, 1)); add(box('deck', 0, 2, 2, 2, 0, { r: 1 }));
check('second deck row (1,3), first row present → r1', { t: 'deck', x: 1, y: 0, z: 3 }, 1);
// N17: a lone half wall is not a house
reset(); add([{ t: 'wall_half', a: 'x', x: 0, y: 0, z: 0, r: 0 }]);
check('birdhouse in the open with only a half wall nearby → fallback (half walls are not a house)', { t: 'birdhouse', x: 0, y: 0, z: 2 }, 0);

reset();
SC.push(...res.map((r) => ({ ...r, set: 'N' })));
}

// ----------------------------------------------------------------------------------------------------
// Repair round 1 (R1): a TALL piece on a window wall with a wall one cell to its side, and beside a corner bookshelf —
// its back to its own window, never to open floor or another piece (S1.1); a back pressed against another piece; porch
// steps in the open meadow (the fallback, D4) and laid before their porch (toward the house, whatever the camera).
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(0.5), Math.cos(0.5)];   // the verifier's hand-build view (θ 0.5)
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { get: (k) => W.get(k), cam: CAM, fallback: 0, roofLevel: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: (got.scores || []).map((v) => +v.toFixed(1)).join(','), why: (got.why || []).join(';') });
};
const reset = () => W.load({ pieces: [] });
// S1.1 the hand build: a 6 × 4 house, a Window on the back edge of cell (1, −2), the right wall one cell to its side
reset(); add(box('foundation', -3, 2, -2, 1)); add(ring(-3, 2, -2, 1, 0, 'wall', { 'x|1|-2': 'wall_window' }));
for (const t of ['kitchen_range', 'wardrobe', 'bookshelf', 'grandfather_clock', 'washstand']) {
  check(`${t} on a window wall, the side wall one cell away (1,−2) → back to its own window (r0), not to the open cell beside it`, { t, x: 1, y: 0, z: -2 }, 0);
}
// S1.1 a 4 × 3 room, Windows on the back edges of x −1 and 0, a bookshelf in the corner cell (−2, −1)
reset(); add(box('foundation', -2, 1, -1, 1)); add(ring(-2, 1, -1, 1, 0, 'wall', { 'x|-1|-1': 'wall_window', 'x|0|-1': 'wall_window' }));
add([{ t: 'bookshelf', x: -2, y: 0, z: -1, r: 0 }]);
check('cook stove beside a corner bookshelf, windows behind both (−1,−1) → back to its window (r0), not against the bookshelf', { t: 'kitchen_range', x: -1, y: 0, z: -1 }, 0);
check('wardrobe beside a corner bookshelf, windows behind both (−1,−1) → back to its window (r0)', { t: 'wardrobe', x: -1, y: 0, z: -1 }, 0);
// a back pressed against another piece: a wardrobe one cell off two walls, a bookshelf on the back wall behind one of them
reset(); add(box('foundation', 0, 3, 0, 3)); add(ring(0, 3, 0, 3)); add([{ t: 'bookshelf', x: 1, y: 0, z: 0, r: 0 }]);
check('wardrobe at (1,1), walls a cell away west and north, a bookshelf in the north cell → back toward the free west cell (r1)', { t: 'wardrobe', x: 1, y: 0, z: 1 }, 1);
// porch steps: the open meadow has no signal (the fallback, D4); laid before the porch they climb toward the house
reset();
check('porch steps in the open meadow, fallback 1 → 1', { t: 'steps', x: 0, y: 0, z: 0 }, 1, { fallback: 1 });
check('porch steps in the open meadow, fallback 3 → 3', { t: 'steps', x: 0, y: 0, z: 0 }, 3, { fallback: 3 });
reset(); add(box('foundation', 0, 3, 0, 2)); add(ring(0, 3, 0, 2, 0, 'wall', { 'x|1|3': 'wall_door' }));
check('porch steps two cells in front of the house, no deck yet, seen from behind the house → climb toward it (r2)', { t: 'steps', x: 1, y: 0, z: 4 }, 2, { cam: [0, -1] });
check('porch steps two cells east of the house, no deck yet → climb toward it (−X, r3)', { t: 'steps', x: 5, y: 0, z: 1 }, 3);
reset();
SC.push(...res.map((r) => ({ ...r, set: 'R1' })));
}

// ----------------------------------------------------------------------------------------------------
// Repair round 2 (R2): S2.4 — a TALL piece on a window wall still backs onto its own window with a table, counter,
// crates, bed or sofa in front of it (a wall a cell to its side no longer outscores it); a hallway one cell wide; stairs
// ignore a woodpile outside, behind the wall at their foot; S2.2 — the order a tap again walks once the room has changed
// round a piece: the rules' best first, then round every facing.
{
const W = __hw.world;
const res = [];
const CAM = [Math.sin(0.5), Math.cos(0.5)];
const af = (p, extra = {}) => autoFacing(getDef(p.t), p, { get: (k) => W.get(k), cam: CAM, fallback: 0, roofLevel: p.y, ...extra });
const add = (list) => { for (const q of list) W.add(q, { record: false, force: true }); };
const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
  const out = [];
  for (let x = x0; x <= x1; x++) { out.push({ t: swap[`x|${x}|${z1 + 1}`] || t, a: 'x', x, y, z: z1 + 1, r: 0 }); out.push({ t: swap[`x|${x}|${z0}`] || t, a: 'x', x, y, z: z0, r: 2 }); }
  for (let z = z0; z <= z1; z++) { out.push({ t: swap[`z|${x1 + 1}|${z}`] || t, a: 'z', x: x1 + 1, y, z, r: 0 }); out.push({ t: swap[`z|${x0}|${z}`] || t, a: 'z', x: x0, y, z, r: 2 }); }
  return out;
};
const sc = (got) => (got.scores || []).map((v) => +v.toFixed(1)).join(',');
const check = (name, p, want, extra) => {
  const got = af(p, extra);
  res.push({ grp: groupOf(getDef(p.t)), name, ok: Array.isArray(want) ? want.includes(got.r) : got.r === want, got: got.r, want, fb: !!got.fallback, tie: !!got.tie, S: sc(got), why: (got.why || []).join(';') });
};
const push = (name, ok, got, want, S = '') => res.push({ grp: 'order', name, ok, got, want, S });
const reset = () => W.load({ pieces: [] });
const TALL = ['kitchen_range', 'wardrobe', 'bookshelf', 'grandfather_clock', 'washstand'];
// S2.4 the S1.1 hand-build spot (a Window behind (1, −2), the right wall a cell to its side) with a piece in front
for (const front of ['table', 'kitchen_counter', 'crate_stack', 'bed', 'sofa']) {
  reset(); add(box('foundation', -3, 2, -2, 1)); add(ring(-3, 2, -2, 1, 0, 'wall', { 'x|1|-2': 'wall_window' })); add([{ t: front, x: 1, y: 0, z: -1, r: 0 }]);
  for (const t of TALL) check(`${t} on a window wall (1,−2), the side wall a cell away, a ${front} in front → still back to its own window (r0)`, { t, x: 1, y: 0, z: -2 }, 0);
}
// the mirror: the window second from the left corner, a table in front, the left wall a cell to its side
reset(); add(box('foundation', -3, 2, -2, 1)); add(ring(-3, 2, -2, 1, 0, 'wall', { 'x|-2|-2': 'wall_window' })); add([{ t: 'table', x: -2, y: 0, z: -1, r: 0 }]);
check('cook stove on a window wall (−2,−2), the left wall a cell away, a table in front → back to its window (r0)', { t: 'kitchen_range', x: -2, y: 0, z: -2 }, 0);
check('wardrobe on a window wall (−2,−2), the left wall a cell away, a table in front → back to its window (r0)', { t: 'wardrobe', x: -2, y: 0, z: -2 }, 0);
// a hallway one cell wide (x 0..2): a wardrobe in its middle stands against a long wall facing across, never along it
reset(); add(box('foundation', 0, 2, 0, 0)); add(ring(0, 2, 0, 0));
check('wardrobe in the middle of a hallway one cell wide → back to a long wall (r0 or r2), not sideways along the hall', { t: 'wardrobe', x: 1, y: 0, z: 0 }, [0, 2]);
// stairs in a house corner: a woodpile outside, behind the wall at the foot of one facing, changes nothing
{
  const house = () => { reset(); add(box('foundation', -2, 1, -1, 1)); add(ring(-2, 1, -1, 1)); add(box('floor', -2, 1, -1, 1, 1).filter((q) => !(q.x === 1 && q.z === 1))); };
  house();
  const a = af({ t: 'stairs', x: 1, y: 0, z: 1 });
  add([{ t: 'woodpile', x: 2, y: 0, z: 1, r: 1 }]);
  const b = af({ t: 'stairs', x: 1, y: 0, z: 1 });
  push('stairs in a house corner: a woodpile outside, behind the wall at the foot of one facing, changes no score', sc(a) === sc(b) && a.r === b.r, sc(b), sc(a), sc(b));
}
// S2.2 the turn order once the room has changed round a piece (the verifier's three scenes, room x −3..1, z −2..1):
// a first tap goes to the rules' best, a run of taps then visits every facing
{
  const room = () => { reset(); add(box('foundation', -3, 1, -2, 1)); add(ring(-3, 1, -2, 1)); };
  const walk = (t, r, order) => { const def = getDef(t), s = []; for (let i = 0; i < 4; i++) { r = F.nextFacing(def, r, order, i > 0); s.push(r); } return s; };
  const scene = (name, t, at, r0, others, want) => {
    room(); add(others);
    const a = af({ t, ...at, y: 0 });
    const s = walk(t, r0, a.order);
    push(name, s[0] === want && s[0] !== r0 && new Set(s).size === 4 && s.join() === (a.order || []).join(), s.join(','), `${want} first, then round the order ${(a.order || []).join(',')}`, sc(a));
  };
  scene('bed in the back-left corner facing r1, then a nightstand beside its foot on the back wall: tap again → r0 (head on the back wall, beside the nightstand), then round all four',
    'bed', { x: -3, z: -2 }, 1, [{ t: 'nightstand', x: -2, y: 0, z: -2, r: 0 }], 0);
  scene('armchair against the front wall facing r2, then a fireplace on the left wall: tap again → r3 (facing the fire), then round all four',
    'armchair', { x: -1, z: 1 }, 2, [{ t: 'fireplace', x: -3, y: 0, z: 0, r: 1 }], 3);
  scene('chair against the front wall facing r2, then a table beside it: tap again → r1 (facing the table), then round all four',
    'chair', { x: -1, z: 1 }, 2, [{ t: 'table', x: 0, y: 0, z: 1, r: 0 }], 1);
  // a piece already facing the best: the first tap goes to the next (as before); an edge piece always flips
  room();
  const w = af({ t: 'wardrobe', x: -1, y: 0, z: -2 });
  const wn = F.nextFacing(getDef('wardrobe'), w.r, w.order, false);
  push('wardrobe on the back wall, facing the best: tap again → the next in the order (as before)', wn === w.order[1] && wn !== w.r, wn, w.order?.[1], sc(w));
  const wl = af({ t: 'wall_window', a: 'x', x: -1, y: 0, z: -2 });
  const f1 = F.nextFacing(getDef('wall_window'), wl.r, wl.order, false), f2 = F.nextFacing(getDef('wall_window'), wl.r ^ 2, wl.order, false);
  push('a window: tap again always flips, fresh or not', f1 === (wl.r ^ 2) && f2 === wl.r, `${f1},${f2}`, `${wl.r ^ 2},${wl.r}`, sc(wl));
}
reset();
SC.push(...res.map((r) => ({ ...r, set: 'R2' })));
}

// ----------------------------------------------------------------------------------------------------
// §10 blueprint agreement: every rotatable, non-gable record of the five stock blueprints, asked in four build orders —
// leave-one-out (every other record there), build order (only the records before it in bp.pieces, the guided / cascade
// order), stage-cold (only the records of earlier stages) and shuffled within stages (20 seeded runs). Camera = the
// blueprint's own view, fallback 0. Rows: every disagreement in the three fixed orders.
let metric = null;
{
const sameF = F.sameFacing;
const CAT = {
  wallEdge: 'Walls, windows, doors', slope: 'Roof slopes', hip: 'Roof slopes', valley: 'Roof slopes',
  deck: 'Porch deck boards', pergola: 'Pergola', steps: 'Porch steps', climb: 'Stairs & ladder', back: 'Back-to-wall furniture',
  table: 'Tables', chair: 'Dining chairs', seat: 'Armchair / sofa / rocker', rug: 'Rugs', bench: 'Garden bench',
  free: 'Plants & round things (default)', canon: 'Railings & beams (default)', fence: 'Fences & hedges (default)',
};
const DELIB_FRONT = new Set(['woodpile', 'wheelbarrow', 'veggie_bed', 'mailbox']);
const catOf = (g, t, q, def) => {
  if (g === 'front') return DELIB_FRONT.has(t) ? 'Garden things with a front' : 'Garden front (default)';
  if (def.layer === 'R' && q.y === 0) return 'A-frame roof at y 0 (guide only)';
  return CAT[g] || g;
};
const ST = ['foundation', 'walls', 'porch', 'upper', 'upperWalls', 'roof', 'gables', 'inside', 'garden'];
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const M = { loo: {}, ord: {}, cold: {}, shuf: {} }, rows = [], perBp = {};
const bump = (tab, c, ok) => { const e = (tab[c] ||= { n: 0, ok: 0 }); e.n++; if (ok) e.ok++; };
const fmt = (res) => `${res.r}${res.fallback ? ' FB' : ''}${res.tie ? ' TIE' : ''} S=${(res.scores || []).map((v) => +v.toFixed(1)).join(',')} ${(res.why || []).slice(0, 5).join(';')}`;
for (const id of ['starter', 'aframe', 'logcabin', 'cottage', 'farmhouse']) {
  const bp = __hw.blueprints.get(id);
  const items = bp._items;
  const cam = [Math.sin(bp.cam.th), Math.cos(bp.cam.th)];
  const map = new Map(), idx = new Map(), stageIx = new Map();
  items.forEach((it, i) => { map.set(it.key, it.p); idx.set(it.key, i); stageIx.set(it.key, ST.indexOf(it.stage)); });
  const base = (q) => ({ cam, fallback: 0, roofLevel: q.y, recY: q.y, lift: 0 });
  items.forEach((it, i) => {
    const q = it.p, def = getDef(q.t), g = groupOf(def);
    if (!g || g === 'gable') return;
    const key = it.key, c = catOf(g, q.t, q, def), want = q.r | 0;
    const loo = autoFacing(def, q, { ...base(q), get: (k) => (k === key ? undefined : map.get(k)) });
    const ord = autoFacing(def, q, { ...base(q), get: (k) => (idx.has(k) && idx.get(k) < i ? map.get(k) : undefined) });
    const s = stageIx.get(key);
    const cold = autoFacing(def, q, { ...base(q), get: (k) => (stageIx.has(k) && stageIx.get(k) < s ? map.get(k) : undefined) });
    const okL = sameF(def, loo.r, want), okO = sameF(def, ord.r, want), okC = sameF(def, cold.r, want);
    bump(M.loo, c, okL); bump(M.ord, c, okO); bump(M.cold, c, okC);
    { const b = (perBp[id] ||= { n: 0, L: 0, O: 0, C: 0, dn: 0, dL: 0, dO: 0, dC: 0 }); const d = !/default|guide only/.test(c);
      b.n++; b.L += okL; b.O += okO; b.C += okC; if (d) { b.dn++; b.dL += okL; b.dO += okO; b.dC += okC; } }
    if (!okL || !okO || !okC) rows.push({ bp: id, t: q.t, at: `(${q.x},${q.y},${q.z}${q.a ? ' ' + q.a : ''})`, c, want, L: okL ? 'ok' : fmt(loo), O: okO ? 'ok' : fmt(ord), C: okC ? 'ok' : fmt(cold) });
  });
  for (let rep = 0; rep < 20; rep++) {
    const order = items.map((it) => ({ it, k: stageIx.get(it.key) + rnd() })).sort((a, b) => a.k - b.k).map((o) => o.it);
    const pos = new Map(order.map((it, i) => [it.key, i]));
    order.forEach((it, i) => {
      const q = it.p, def = getDef(q.t), g = groupOf(def);
      if (!g || g === 'gable') return;
      const r = autoFacing(def, q, { ...base(q), get: (k) => (pos.has(k) && pos.get(k) < i ? map.get(k) : undefined) });
      bump(M.shuf, catOf(g, q.t, q, def), sameF(def, r.r, q.r | 0));
    });
  }
}
metric = { M, rows, perBp };
}
__hw.world.load({ pieces: [] });
return { scenes: SC, metric };
