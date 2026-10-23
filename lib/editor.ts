import type { Floor, Project } from './model.ts';
import { geometryIssues, requirementsSchema, generateFloors } from './model.ts';
import { editSchema } from './ai.ts';
export function stretchAxis(
  f: Floor,
  axis: 'x' | 'y',
  old: number,
  value: number,
  limit: number,
  fixed?: number,
): Floor {
  const t = f.walls[0]?.thickness || 152.4,
    lo = fixed ?? t / 2,
    hi = limit - t / 2;
  if (old <= lo + 0.1 || old >= hi - 0.1 || value <= lo + 100 || value >= hi - 100)
    throw Error('Exterior walls stay on the confirmed footprint. Enter an interior position.');
  const map = (v: number) =>
    v <= lo
      ? v
      : v >= hi
        ? v
        : v <= old
          ? lo + ((v - lo) * (value - lo)) / (old - lo)
          : value + ((v - old) * (hi - value)) / (hi - old);
  return {
    ...f,
    rooms: f.rooms.map((q) =>
      axis === 'x'
        ? { ...q, x: map(q.x - t / 2) + t / 2, w: map(q.x + q.w + t / 2) - map(q.x - t / 2) - t }
        : { ...q, y: map(q.y - t / 2) + t / 2, h: map(q.y + q.h + t / 2) - map(q.y - t / 2) - t },
    ),
    walls: f.walls.map((w) => ({
      ...w,
      a: { ...w.a, [axis]: map(w.a[axis]) },
      b: { ...w.b, [axis]: map(w.b[axis]) },
    })),
    features: f.features.map((v) =>
      axis === 'x'
        ? { ...v, x: map(v.x), w: map(v.x + v.w) - map(v.x) }
        : { ...v, y: map(v.y), h: map(v.y + v.h) - map(v.y) },
    ),
    openings: f.openings.map((o) => {
      const w = f.walls.find((w) => w.id === o.wallId);
      if (!w) return o;
      const along = axis === 'x' ? Math.abs(w.b.y - w.a.y) < 1 : Math.abs(w.b.x - w.a.x) < 1;
      if (!along) return o;
      return { ...o, offset: map(w.a[axis] + o.offset) - map(w.a[axis]) };
    }),
  };
}
export function resizeRoom(
  f: Floor,
  id: string,
  width: number,
  height: number,
  limits: { width: number; length: number },
) {
  const room = f.rooms.find((q) => q.id === id);
  if (!room) throw Error('Room not found.');
  const t = f.walls[0]?.thickness || 152.4;
  let next = f;
  if (Math.abs(width - room.w) > 0.01)
    next = stretchAxis(
      next,
      'x',
      room.x + room.w + t / 2,
      room.x + width + t / 2,
      limits.width,
      room.x - t / 2,
    );
  const now = next.rooms.find((q) => q.id === id)!;
  if (Math.abs(height - now.h) > 0.01)
    next = stretchAxis(
      next,
      'y',
      now.y + now.h + t / 2,
      now.y + height + t / 2,
      limits.length,
      now.y - t / 2,
    );
  return next;
}
export function applyAIProposal(p: Project, input: unknown): Project {
  const proposal = editSchema.parse(input);
  let next = structuredClone(p);
  const reqFields = [
    'width',
    'length',
    'floors',
    'apartments',
    'bedrooms',
    'bathrooms',
    'front',
    'rear',
    'left',
    'right',
    'roof',
    'veranda',
    'parking',
    'futureFloors',
    'instructions',
  ];
  const req = proposal.changes.filter((c) => c.target === 'requirements'),
    rooms = proposal.changes.filter((c) => c.target === 'room');
  if (req.length && rooms.length)
    throw Error('Please apply building requirements separately from room edits.');
  for (const c of req) {
    if (!reqFields.includes(c.field)) throw Error('Unsupported building edit.');
    (next.requirements as Record<string, unknown>)[c.field] = c.value;
  }
  next.requirements = requirementsSchema.parse(next.requirements);
  if (req.length) next.floors = generateFloors(next.requirements);
  for (const c of rooms) {
    if (!['name', 'w', 'h'].includes(c.field))
      throw Error(
        'Assistant room edits support names and dimensions. Use the editor for wall positions.',
      );
    const fi = next.floors.findIndex((f) => f.rooms.some((q) => q.id === c.id));
    if (fi < 0) throw Error('The assistant referenced an unknown room.');
    const room = next.floors[fi].rooms.find((q) => q.id === c.id)!;
    if (c.field === 'name') {
      if (typeof c.value !== 'string') throw Error('Invalid name.');
      room.name = c.value;
    } else {
      if (typeof c.value !== 'number' || c.value < 600) throw Error('Room dimension is too small.');
      next.floors[fi] = resizeRoom(
        next.floors[fi],
        room.id,
        c.field === 'w' ? c.value : room.w,
        c.field === 'h' ? c.value : room.h,
        next.requirements,
      );
    }
  }
  const errors = next.floors
    .flatMap((f) => geometryIssues(f, next.requirements))
    .filter((i) => i.severity === 'error');
  if (errors.length) throw Error(errors.map((i) => i.title).join(', '));
  return next;
}
