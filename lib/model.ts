import { z } from 'zod';
export const FT = 304.8;
export const units = { ft: 304.8, in: 25.4, m: 1000, mm: 1 };
export type Unit = keyof typeof units;
export const mm = (v: number, u: Unit = 'ft') => Math.round(v * units[u] * 1000) / 1000;
export function measure(v: number, u: Unit = 'ft') {
  if (u === 'ft') {
    const inches = Math.round(v / 25.4);
    return `${Math.floor(inches / 12)}′ ${inches % 12}″`;
  }
  return `${(v / units[u]).toFixed(u === 'mm' ? 0 : 2)} ${u}`;
}
const positive = z.number().finite().positive().max(300000);
export const requirementsSchema = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(300),
  owner: z.string().max(120),
  lotWidth: positive,
  lotLength: positive,
  width: positive,
  length: positive,
  floors: z.number().int().min(1).max(12),
  apartments: z.number().int().min(1).max(48),
  bedrooms: z.number().int().min(1).max(4),
  bathrooms: z.number().int().min(1).max(3),
  front: z.number().finite().nonnegative(),
  rear: z.number().finite().nonnegative(),
  left: z.number().finite().nonnegative(),
  right: z.number().finite().nonnegative(),
  wall: z.number().min(75).max(450),
  floorHeight: z.number().min(2400).max(5000),
  roof: z.enum(['Hip', 'Gable', 'Flat']),
  buildingType: z.string().max(100),
  stairs: z.enum(['Internal', 'External']),
  parking: z.number().int().min(0).max(30),
  veranda: z.number().finite().nonnegative().max(5000),
  futureFloors: z.number().int().min(0).max(5),
  instructions: z.string().max(5000),
});
export type Requirements = z.infer<typeof requirementsSchema>;
export type Point = { x: number; y: number };
export type Wall = { id: string; a: Point; b: Point; thickness: number };
export type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  apartment: number;
};
export type Opening = {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  type: 'door' | 'window';
  from: string;
  to: string;
};
export type Feature = {
  id: string;
  type: 'stair' | 'veranda' | 'column' | 'label' | 'dimension';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  label: string;
};
export type Floor = {
  id: string;
  name: string;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  features: Feature[];
};
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  updatedAt: z.string(),
  requirements: requirementsSchema,
  floors: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        rooms: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().max(120),
              x: z.number().finite(),
              y: z.number().finite(),
              w: positive,
              h: positive,
              apartment: z.number().int(),
            }),
          )
          .max(500),
        walls: z
          .array(
            z.object({
              id: z.string(),
              a: z.object({ x: z.number().finite(), y: z.number().finite() }),
              b: z.object({ x: z.number().finite(), y: z.number().finite() }),
              thickness: z.number().min(50).max(500),
            }),
          )
          .max(2000),
        openings: z
          .array(
            z.object({
              id: z.string(),
              wallId: z.string(),
              offset: z.number().finite().nonnegative(),
              width: positive,
              type: z.enum(['door', 'window']),
              from: z.string(),
              to: z.string(),
            }),
          )
          .max(2000),
        features: z
          .array(
            z.object({
              id: z.string(),
              type: z.enum(['stair', 'veranda', 'column', 'label', 'dimension']),
              x: z.number().finite(),
              y: z.number().finite(),
              w: positive,
              h: positive,
              rotation: z.number().finite(),
              label: z.string().max(200),
            }),
          )
          .max(500),
      }),
    )
    .max(12),
  references: z
    .array(z.object({ id: z.string(), name: z.string(), path: z.string(), type: z.string() }))
    .max(30),
  revisions: z.array(z.object({ date: z.string(), note: z.string() })).max(100),
  downloads: z.array(z.object({ date: z.string(), format: z.string() })).max(200),
  confirmedMeasurements: z.boolean(),
  documents: z.record(z.boolean()),
  authority: z.object({
    name: z.string(),
    minFront: z.number().nonnegative(),
    minRear: z.number().nonnegative(),
    minSide: z.number().nonnegative(),
    confirmed: z.boolean(),
  }),
});
export type Project = z.infer<typeof projectSchema>;
export type Issue = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
};
export const defaultRequirements: Requirements = {
  name: 'Providence residences',
  location: 'Providence, East Bank Demerara',
  owner: '',
  lotWidth: mm(51),
  lotLength: mm(100),
  width: mm(40),
  length: mm(60),
  floors: 2,
  apartments: 4,
  bedrooms: 2,
  bathrooms: 1,
  front: mm(15),
  rear: mm(25),
  left: mm(5.5),
  right: mm(5.5),
  wall: 152.4,
  floorHeight: 3048,
  roof: 'Hip',
  buildingType: 'Apartments',
  stairs: 'Internal',
  parking: 2,
  veranda: 0,
  futureFloors: 0,
  instructions: 'Open kitchen and dining with shared internal stair access.',
};
export function requirementIssues(r: Requirements): Issue[] {
  const a: Issue[] = [];
  for (const [axis, sum, lot] of [
    ['width', r.width + r.left + r.right, r.lotWidth],
    ['length', r.length + r.front + r.rear, r.lotLength],
  ] as const) {
    const delta = lot - sum;
    if (Math.abs(delta) > 2)
      a.push({
        id: `setback-${axis}`,
        severity: 'error',
        title: `Reconcile ${axis} and setbacks`,
        detail: `The building and setbacks total ${measure(sum)} against ${measure(lot)} of land. ${delta > 0 ? 'Unallocated' : 'Excess'}: ${measure(Math.abs(delta))}. Confirm the survey and all four setbacks.`,
      });
  }
  if (r.apartments % r.floors !== 0)
    a.push({
      id: 'distribution',
      severity: 'error',
      title: 'Unequal apartment distribution',
      detail:
        'This generator needs an equal whole number of apartments on each floor. Edit the total or floor count.',
    });
  if (r.bedrooms > 2 || r.bathrooms > 1)
    a.push({
      id: 'typology',
      severity: 'error',
      title: 'Custom arrangement required',
      detail:
        'The constrained generator supports one or two bedrooms and one bathroom per apartment. Draft a custom plan or reduce the request.',
    });
  if (r.stairs === 'External')
    a.push({
      id: 'external-stair',
      severity: 'error',
      title: 'External stair needs a surveyed position',
      detail:
        'Use an internal stair to generate a layout. An external stair must be placed and its boundary clearance checked by the designer.',
    });
  if (r.veranda > 0)
    a.push({
      id: 'veranda',
      severity: 'warning',
      title: 'Veranda must be drafted separately',
      detail:
        'The requested veranda is not automatically fitted into the building footprint. Add and verify it in the editor.',
    });
  return a;
}
export function generationIssues(r: Requirements) {
  const a = requirementIssues(r);
  const n = r.apartments / r.floors;
  const rows = Math.ceil(n / 2);
  const w = (r.width - mm(4) - 2 * r.wall) / 2;
  const h = (r.length - mm(14) - 2 * r.wall) / rows;
  const area = (w * h) / FT ** 2;
  const min = r.bedrooms === 2 ? 560 : 400;
  if (n > 8 || w < mm(16) || h < mm(r.bedrooms === 2 ? 34 : 25) || area < min)
    a.push({
      id: 'fit',
      severity: 'error',
      title: 'The requested apartments do not fit this layout',
      detail: `After a 4 ft corridor, 14 ft stair/lobby zone and walls, each apartment has about ${Math.max(0, area).toFixed(0)} sq ft (${measure(Math.max(0, w))} × ${measure(Math.max(0, h))}). This template requires ${min} sq ft and minimum clear proportions. Try ${r.floors * 2} total apartments, fewer bedrooms, a larger footprint, or a professionally designed alternative. This is a template feasibility result, not a universal code minimum.`,
    });
  return a;
}
export function generateFloors(r: Requirements, variant = 0): Floor[] {
  const issues = generationIssues(r).filter((x) => x.severity === 'error');
  if (issues.length) throw new Error(issues.map((x) => x.detail).join('\n'));
  return Array.from({ length: r.floors }, (_, f) => {
    const floor: Floor = {
      id: `floor-${f}`,
      name: f === 0 ? 'Ground floor' : f === 1 ? 'First floor' : `Floor ${f + 1}`,
      rooms: [],
      walls: [],
      openings: [],
      features: [],
    };
    const t = r.wall;
    let count = 0;
    const map = new Map<string, string>();
    function wall(x1: number, y1: number, x2: number, y2: number) {
      const key = [x1, y1, x2, y2].map((v) => v.toFixed(2)).join(',');
      if (map.has(key)) return map.get(key)!;
      const id = `w${count++}`;
      floor.walls.push({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: t });
      map.set(key, id);
      return id;
    }
    function cell(
      id: string,
      name: string,
      x: number,
      y: number,
      w: number,
      h: number,
      apartment: number,
    ) {
      floor.rooms.push({ id, name, x: x + t / 2, y: y + t / 2, w: w - t, h: h - t, apartment });
      const top = wall(x, y, x + w, y),
        bottom = wall(x, y + h, x + w, y + h),
        left = wall(x, y, x, y + h),
        right = wall(x + w, y, x + w, y + h);
      return { top, bottom, left, right };
    }
    function opening(
      wallId: string,
      offset: number,
      type: 'door' | 'window',
      from: string,
      to: string,
      width = mm(3),
    ) {
      floor.openings.push({
        id: `o${floor.openings.length}`,
        wallId,
        offset,
        width,
        type,
        from,
        to,
      });
    }
    const corridor = mm(4),
      lobby = mm(14),
      ax = t / 2,
      ay = t / 2;
    const innerW = r.width - t,
      innerL = r.length - t;
    const half = (innerW - corridor) / 2;
    const n = r.apartments / r.floors,
      rows = Math.ceil(n / 2);
    const depth = (innerL - lobby) / rows;
    const hallX = ax + half;
    const lobbyCell = cell('lobby', 'Entrance lobby', ax, ay, innerW, lobby, 0);
    cell('corridor', 'Shared corridor', hallX, ay + lobby, corridor, innerL - lobby, 0);
    opening(lobbyCell.bottom, half + (corridor - mm(3)) / 2, 'door', 'lobby', 'corridor');
    floor.features.push({
      id: 'stair',
      type: 'stair',
      x: ax + mm(2),
      y: ay + mm(1),
      w: mm(8),
      h: mm(12),
      rotation: 0,
      label: 'Shared stair · conceptual',
    });
    if (f === 0) opening(floor.walls[0].id, innerW * 0.62, 'door', 'outside', 'lobby', mm(3.5));
    for (let i = 0; i < n; i++) {
      const side = i % 2;
      const row = Math.floor(i / 2);
      const x = ax + (side ? half + corridor : 0),
        y = ay + lobby + row * depth;
      const id = `a${i + 1}`,
        W = half,
        H = depth;
      const living = H * (variant ? 0.39 : 0.4),
        service = H * 0.25,
        hall = mm(3),
        bed = H - living - service - hall;
      const s = W * 0.6;
      const l = cell(`${id}-living`, 'Living / dining', x, y, W, living, i + 1);
      const k = cell(`${id}-kitchen`, 'Kitchen', x, y + living, s, service, i + 1);
      cell(`${id}-bath`, 'Bathroom', x + s, y + living, W - s, service, i + 1);
      const c = cell(`${id}-hall`, 'Passage', x, y + living + service, W, hall, i + 1);
      const bw = W / r.bedrooms;
      for (let b = 0; b < r.bedrooms; b++) {
        cell(
          `${id}-bed${b + 1}`,
          `Bedroom ${b + 1}`,
          x + b * bw,
          y + living + service + hall,
          bw,
          bed,
          i + 1,
        );
        opening(c.bottom, b * bw + bw / 2 - mm(1.5), 'door', `${id}-hall`, `${id}-bed${b + 1}`);
        const outer = wall(x + b * bw, y + H, x + (b + 1) * bw, y + H);
        opening(outer, bw / 2 - mm(2), 'window', `${id}-bed${b + 1}`, 'outside', mm(4));
      }
      opening(side ? l.left : l.right, living / 2 - mm(1.5), 'door', `${id}-living`, 'corridor');
      opening(l.bottom, s / 2 - mm(1.5), 'door', `${id}-living`, `${id}-kitchen`);
      opening(k.right, service / 2 - mm(1.5), 'door', `${id}-kitchen`, `${id}-bath`);
      opening(c.top, s / 2 - mm(1.5), 'door', `${id}-kitchen`, `${id}-hall`);
      opening(
        side ? l.right : l.left,
        living / 2 - mm(2),
        'window',
        `${id}-living`,
        'outside',
        mm(4),
      );
    }
    // Split intersecting/overlapping collinear segments to obtain clean architectural junctions.
    const normalized = normalizeWalls(floor),
      prefix = `f${f}-`;
    return {
      ...normalized,
      rooms: normalized.rooms.map((q) => ({ ...q, id: prefix + q.id })),
      walls: normalized.walls.map((w) => ({ ...w, id: prefix + w.id })),
      openings: normalized.openings.map((o) => ({
        ...o,
        id: prefix + o.id,
        wallId: prefix + o.wallId,
        from: o.from === 'outside' ? o.from : prefix + o.from,
        to: o.to === 'outside' ? o.to : prefix + o.to,
      })),
      features: normalized.features.map((v) => ({ ...v, id: prefix + v.id })),
    };
  });
}
export function normalizeWalls(f: Floor): Floor {
  const segments: Wall[] = [];
  const openings: Opening[] = [];
  for (const horizontal of [true, false]) {
    const groups = new Map<string, Wall[]>();
    for (const w of f.walls) {
      if (Math.abs(w.a.y - w.b.y) < 0.01 !== horizontal) continue;
      const key = (horizontal ? w.a.y : w.a.x).toFixed(2);
      groups.set(key, [...(groups.get(key) || []), w]);
    }
    for (const group of groups.values()) {
      const value = (p: Point) => (horizontal ? p.x : p.y);
      const cuts = [
        ...new Set(
          group.flatMap((w) => [Number(value(w.a).toFixed(3)), Number(value(w.b).toFixed(3))]),
        ),
      ].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const lo = cuts[i],
          hi = cuts[i + 1];
        const owner = group.find((w) => value(w.a) <= lo + 0.01 && value(w.b) >= hi - 0.01);
        if (!owner) continue;
        const coord = horizontal ? owner.a.y : owner.a.x;
        const id = `n${segments.length}`;
        segments.push({
          id,
          a: horizontal ? { x: lo, y: coord } : { x: coord, y: lo },
          b: horizontal ? { x: hi, y: coord } : { x: coord, y: hi },
          thickness: owner.thickness,
        });
        for (const old of group) {
          for (const o of f.openings.filter((o) => o.wallId === old.id)) {
            const pos = value(old.a) + o.offset;
            if (
              pos >= lo - 0.01 &&
              pos + o.width <= hi + 0.01 &&
              !openings.some((v) => v.id === o.id)
            )
              openings.push({ ...o, wallId: id, offset: pos - lo });
          }
        }
      }
    }
  }
  return { ...f, walls: segments, openings };
}
export function newProject(r: Requirements = defaultRequirements): Project {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    requirements: { ...r },
    floors: generateFloors(r),
    references: [],
    revisions: [],
    downloads: [],
    confirmedMeasurements: true,
    documents: {},
    authority: {
      name: 'Local authority — confirm jurisdiction',
      minFront: 0,
      minRear: 0,
      minSide: 0,
      confirmed: false,
    },
  };
}
export function geometryIssues(f: Floor, r: Requirements): Issue[] {
  const issues: Issue[] = [];
  for (const a of f.rooms) {
    if (a.x < 0 || a.y < 0 || a.x + a.w > r.width + 0.1 || a.y + a.h > r.length + 0.1)
      issues.push({
        id: `bounds-${a.id}`,
        severity: 'error',
        title: `${a.name} exceeds footprint`,
        detail: `${f.name}: move or resize the room to fit the building.`,
      });
    for (const b of f.rooms) {
      if (a.id >= b.id) continue;
      if (
        a.x < b.x + b.w - 0.1 &&
        a.x + a.w > b.x + 0.1 &&
        a.y < b.y + b.h - 0.1 &&
        a.y + a.h > b.y + 0.1
      )
        issues.push({
          id: `overlap-${a.id}-${b.id}`,
          severity: 'error',
          title: 'Overlapping rooms',
          detail: `${f.name}: ${a.name} overlaps ${b.name}.`,
        });
    }
  }
  for (const w of f.walls) {
    if (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) < 1)
      issues.push({
        id: `wall-${w.id}`,
        severity: 'error',
        title: 'Zero-length wall',
        detail: f.name,
      });
  }
  for (const o of f.openings) {
    const w = f.walls.find((w) => w.id === o.wallId);
    if (!w || o.offset + o.width > Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) + 0.1)
      issues.push({
        id: `opening-${o.id}`,
        severity: 'error',
        title: 'Opening does not fit its wall',
        detail: `${f.name}: ${o.type} ${o.id} needs correction.`,
      });
  }
  for (const q of f.rooms)
    if (q.w < 100 || q.h < 100 || !Number.isFinite(q.w + q.h))
      issues.push({
        id: `size-${q.id}`,
        severity: 'error',
        title: 'Invalid room dimensions',
        detail: `${f.name}: ${q.name} must have positive usable dimensions.`,
      });
  for (const w of f.walls)
    if ([w.a, w.b].some((p) => p.x < -1 || p.y < -1 || p.x > r.width + 1 || p.y > r.length + 1))
      issues.push({
        id: `wall-bounds-${w.id}`,
        severity: 'error',
        title: 'Wall exceeds the building footprint',
        detail: `${f.name}: resize the confirmed footprint before extending exterior walls.`,
      });
  for (let i = 0; i < f.openings.length; i++)
    for (let j = i + 1; j < f.openings.length; j++) {
      const a = f.openings[i],
        b = f.openings[j];
      if (
        a.wallId === b.wallId &&
        a.offset < b.offset + b.width - 0.1 &&
        b.offset < a.offset + a.width - 0.1
      )
        issues.push({
          id: `opening-overlap-${a.id}-${b.id}`,
          severity: 'error',
          title: 'Openings overlap',
          detail: `${f.name}: move or resize the overlapping openings.`,
        });
    }
  for (const q of f.rooms) {
    const edges = [
      { axis: 'x', pos: q.x - r.wall / 2, lo: q.y - r.wall / 2, hi: q.y + q.h + r.wall / 2 },
      { axis: 'x', pos: q.x + q.w + r.wall / 2, lo: q.y - r.wall / 2, hi: q.y + q.h + r.wall / 2 },
      { axis: 'y', pos: q.y - r.wall / 2, lo: q.x - r.wall / 2, hi: q.x + q.w + r.wall / 2 },
      { axis: 'y', pos: q.y + q.h + r.wall / 2, lo: q.x - r.wall / 2, hi: q.x + q.w + r.wall / 2 },
    ];
    for (const e of edges) {
      const spans = f.walls
        .filter((w) =>
          e.axis === 'x'
            ? Math.abs(w.a.x - w.b.x) < 0.1 && Math.abs(w.a.x - e.pos) < 1
            : Math.abs(w.a.y - w.b.y) < 0.1 && Math.abs(w.a.y - e.pos) < 1,
        )
        .map((w) =>
          e.axis === 'x'
            ? [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)]
            : [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)],
        )
        .sort((a, b) => a[0] - b[0]);
      let end = e.lo;
      for (const [lo, hi] of spans) if (lo <= end + 1 && hi >= end) end = Math.max(end, hi);
      if (end < e.hi - 1) {
        issues.push({
          id: `enclosure-${q.id}-${e.axis}-${e.pos}`,
          severity: 'warning',
          title: 'Room enclosure needs review',
          detail: `${f.name}: ${q.name} has a boundary that no longer matches its wall geometry. Room calculations may need redrafting.`,
        });
        break;
      }
    }
  }
  const reached = new Set(['outside']);
  if (f.name !== 'Ground floor' && f.features.some((v) => v.type === 'stair')) {
    const lobby = f.rooms.find((q) => q.name === 'Entrance lobby');
    if (lobby) reached.add(lobby.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of f.openings.filter((o) => o.type === 'door')) {
      if (reached.has(o.from) && !reached.has(o.to)) {
        reached.add(o.to);
        changed = true;
      }
      if (reached.has(o.to) && !reached.has(o.from)) {
        reached.add(o.from);
        changed = true;
      }
    }
  }
  for (const room of f.rooms)
    if (!reached.has(room.id))
      issues.push({
        id: `access-${room.id}`,
        severity: 'warning',
        title: 'Room access unverified',
        detail: `${f.name}: ${room.name} has no modelled door path to an entrance.`,
      });
  return issues;
}
export function readiness(p: Project): Issue[] {
  const r = p.requirements;
  const list = [...requirementIssues(r), ...p.floors.flatMap((f) => geometryIssues(f, r))];
  if (!p.confirmedMeasurements)
    list.push({
      id: 'confirm',
      severity: 'error',
      title: 'Confirm extracted measurements',
      detail: 'Reference measurements must be explicitly reviewed before generating drawings.',
    });
  if (!r.owner || !r.location)
    list.push({
      id: 'property',
      severity: 'warning',
      title: 'Property identification incomplete',
      detail: 'Enter the applicant/owner name and full property address.',
    });
  if (r.parking > 0 && (r.front < mm(16) || r.parking * mm(8) > r.lotWidth - r.left))
    list.push({
      id: 'parking-fit',
      severity: 'warning',
      title: 'Requested parking is not fully shown',
      detail:
        'The current front setback cannot contain all requested nominal 8 × 16 ft spaces. Resolve parking and driveway circulation with the designer; undrawn spaces are not counted as provided.',
    });
  for (const key of ['survey', 'ownership', 'identification', 'tin', 'rates'])
    if (!p.documents[key])
      list.push({
        id: `doc-${key}`,
        severity: 'warning',
        title: `Missing ${key} document`,
        detail:
          'Confirm the document is available and matches the project. These checkboxes do not verify its authenticity.',
      });
  if (!p.authority.confirmed)
    list.push({
      id: 'authority',
      severity: 'warning',
      title: 'Confirm local authority requirements',
      detail:
        'NDC and CHPA requirements depend on application type. Verify setbacks, fire access, parking, drainage and drawing requirements with the responsible authority.',
    });
  if (
    p.authority.confirmed &&
    [
      r.front < p.authority.minFront,
      r.rear < p.authority.minRear,
      r.left < p.authority.minSide,
      r.right < p.authority.minSide,
    ].some(Boolean)
  )
    list.push({
      id: 'minimum-setback',
      severity: 'error',
      title: 'Below configured setback minimum',
      detail: 'One or more setbacks are smaller than the locally confirmed profile.',
    });
  if (p.floors.length !== r.floors)
    list.push({
      id: 'missing-floors',
      severity: 'error',
      title: 'Floor count mismatch',
      detail: 'Generate or duplicate the missing floor sheets.',
    });
  if (r.floors > 1 && p.floors.some((f) => !f.features.some((v) => v.type === 'stair')))
    list.push({
      id: 'stairs',
      severity: 'error',
      title: 'Stair access missing',
      detail: 'Every upper floor needs coordinated staircase access.',
    });
  const stairs = p.floors.map((f) => f.features.find((v) => v.type === 'stair'));
  if (
    stairs.some(
      (s) =>
        s &&
        stairs[0] &&
        (s.x !== stairs[0].x || s.y !== stairs[0].y || s.w !== stairs[0].w || s.h !== stairs[0].h),
    )
  )
    list.push({
      id: 'stair-alignment',
      severity: 'error',
      title: 'Stairs differ between floors',
      detail: 'Coordinate stair locations and openings on every floor.',
    });
  list.push(
    {
      id: 'circulation',
      severity: 'warning',
      title: 'Review circulation and fire escape',
      detail:
        'Generated apartments access the bedroom passage through the kitchen. A professional must assess circulation, accessibility and independent emergency egress.',
    },
    {
      id: 'engineering',
      severity: 'warning',
      title: 'Structural engineering review required',
      detail: `Columns, beams, slabs, foundations and stair design are conceptual. ${r.futureFloors ? 'Future floors need engineered load and foundation checks.' : ''}`,
    },
    {
      id: 'services',
      severity: 'warning',
      title: 'Drainage and sanitation design outstanding',
      detail:
        'Survey levels, approved connection points, pipe falls, septic sizing and clearances have not been designed.',
    },
    {
      id: 'heights',
      severity: 'warning',
      title: 'Confirm vertical design assumptions',
      detail:
        'Storey heights, roof rise, sill/head levels and stairs are preliminary user inputs or schematic assumptions.',
    },
  );
  return list;
}
