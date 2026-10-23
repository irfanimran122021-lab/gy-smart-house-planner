import { FT, measure } from './model.ts';
import type { Project, Floor, Point } from './model.ts';
export type Line = { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number };
export type Rect = {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: boolean;
  width: number;
};
export type Text = {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  anchor?: 'middle' | 'start';
};
export type Primitive = Line | Rect | Text;
export type Scene = {
  items: Primitive[];
  width: number;
  height: number;
  title: string;
  scale: number;
};
export const sheets = [
  'Site plan',
  'Front elevation',
  'Rear elevation',
  'Left elevation',
  'Right elevation',
  'Section A–A',
  'Roof plan',
  'Door & window schedule',
  'General notes',
  'Drainage brief',
];
export function drawing(p: Project, view: string, floorIndex = 0): Scene {
  const r = p.requirements;
  const f = p.floors[floorIndex] || p.floors[0];
  const items: Primitive[] = [];
  const scene: Scene = {
    items,
    width: r.width,
    height: r.length,
    title: view === 'Floor plan' ? f.name : view,
    scale: view === 'Site plan' ? 192 : 96,
  };
  const line = (x1: number, y1: number, x2: number, y2: number, width = 20) =>
    items.push({ type: 'line', x1, y1, x2, y2, width });
  const rect = (x: number, y: number, w: number, h: number, fill = false, width = 25) =>
    items.push({ type: 'rect', x, y, w, h, fill, width });
  const text = (
    x: number,
    y: number,
    t: string,
    size = 150,
    anchor: 'middle' | 'start' = 'middle',
  ) => items.push({ type: 'text', x, y, text: t, size, anchor });
  function dim(a: Point, b: Point, offset: number, label?: string) {
    if (Math.abs(a.y - b.y) < 1) {
      line(a.x, a.y, a.x, a.y + offset + 100, 8);
      line(b.x, b.y, b.x, b.y + offset + 100, 8);
      line(a.x, a.y + offset, b.x, b.y + offset, 10);
      for (const x of [a.x, b.x]) line(x - 65, a.y + offset + 65, x + 65, a.y + offset - 65, 15);
      text((a.x + b.x) / 2, a.y + offset - 70, label || measure(Math.abs(b.x - a.x)), 140);
    } else {
      line(a.x, a.y, a.x + offset + 100, a.y, 8);
      line(b.x, b.y, b.x + offset + 100, b.y, 8);
      line(a.x + offset, a.y, a.x + offset, b.y, 10);
      for (const y of [a.y, b.y]) line(a.x + offset - 65, y + 65, a.x + offset + 65, y - 65, 15);
      text(a.x + offset - 90, (a.y + b.y) / 2, label || measure(Math.abs(b.y - a.y)), 140);
    }
  }
  if (view === 'Floor plan') {
    for (const w of f.walls) {
      const dx = w.b.x - w.a.x,
        dy = w.b.y - w.a.y,
        L = Math.hypot(dx, dy);
      if (!L) continue;
      const ux = dx / L,
        uy = dy / L;
      const os = f.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
      let start = 0;
      function piece(a: number, b: number) {
        if (b <= a) return;
        const x = w.a.x + ux * a,
          y = w.a.y + uy * a;
        if (Math.abs(dy) < 1) rect(x, y - w.thickness / 2, b - a, w.thickness, true, 0);
        else if (Math.abs(dx) < 1) rect(x - w.thickness / 2, y, w.thickness, b - a, true, 0);
        else {
          line(x, y, w.a.x + ux * b, w.a.y + uy * b, w.thickness);
        }
      }
      for (const o of os) {
        piece(start, o.offset);
        const x = w.a.x + ux * o.offset,
          y = w.a.y + uy * o.offset;
        if (o.type === 'window') {
          for (const d of [-w.thickness / 3, w.thickness / 3])
            line(x - uy * d, y + ux * d, x + ux * o.width - uy * d, y + uy * o.width + ux * d, 12);
          line(x, y, x + ux * o.width, y + uy * o.width, 8);
        } else {
          line(x, y, x - uy * o.width, y + ux * o.width, 15);
          let prev = { x: x + ux * o.width, y: y + uy * o.width };
          for (let i = 1; i <= 12; i++) {
            const angle = (i * Math.PI) / 24;
            const q = {
              x: x + (ux * Math.cos(angle) - uy * Math.sin(angle)) * o.width,
              y: y + (uy * Math.cos(angle) + ux * Math.sin(angle)) * o.width,
            };
            line(prev.x, prev.y, q.x, q.y, 8);
            prev = q;
          }
        }
        start = o.offset + o.width;
      }
      piece(start, L);
    }
    for (const room of f.rooms) {
      text(
        room.x + room.w / 2,
        room.y + room.h / 2 - 95,
        room.name,
        Math.min(260, (room.w / Math.max(7, room.name.length)) * 1.8),
      );
      text(
        room.x + room.w / 2,
        room.y + room.h / 2 + 210,
        `${measure(room.w)} × ${measure(room.h)}`,
        200,
      );
      if (room.name === 'Living / dining')
        text(room.x + room.w / 2, room.y + room.h / 2 - 400, `APARTMENT ${room.apartment}`, 150);
    }
    for (const v of f.features) {
      if (v.type === 'stair') {
        rect(v.x, v.y, v.w, v.h);
        const steps = Math.ceil(r.floorHeight / 180);
        for (let i = 1; i < steps; i++)
          line(v.x, v.y + (v.h * i) / steps, v.x + v.w, v.y + (v.h * i) / steps, 10);
        line(v.x + v.w / 2, v.y + v.h - 100, v.x + v.w / 2, v.y + 150, 15);
        line(v.x + v.w / 2, v.y + 150, v.x + v.w / 2 - 120, v.y + 400, 15);
        text(v.x + v.w / 2, v.y - 120, 'UP · verify risers', 110);
      } else if (v.type === 'label') text(v.x, v.y, v.label, 150);
      else if (v.type === 'dimension') dim({ x: v.x, y: v.y }, { x: v.x + v.w, y: v.y }, -350);
      else {
        rect(v.x, v.y, v.w, v.h, v.type === 'column');
        text(v.x + v.w / 2, v.y + v.h / 2, v.label || v.type, 100);
      }
    }
    dim({ x: 0, y: 0 }, { x: r.width, y: 0 }, -700);
    dim({ x: r.width, y: 0 }, { x: r.width, y: r.length }, 700);
    const sorted = [
      ...new Set(f.rooms.filter((q) => q.apartment > 0).map((q) => q.y - r.wall / 2)),
    ].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++)
      dim({ x: 0, y: sorted[i] }, { x: 0, y: sorted[i + 1] }, -600);
  } else if (view === 'Site plan') {
    scene.width = r.lotWidth;
    scene.height = r.lotLength;
    rect(0, 0, r.lotWidth, r.lotLength, false, 40);
    rect(r.left, r.front, r.width, r.length, false, 45);
    text(r.left + r.width / 2, r.front + r.length / 2, 'PROPOSED BUILDING', 220);
    text(
      r.left + r.width / 2,
      r.front + r.length / 2 + 330,
      `${((r.width * r.length) / FT ** 2).toFixed(0)} sq ft footprint`,
      180,
    );
    dim({ x: 0, y: 0 }, { x: r.lotWidth, y: 0 }, -800);
    dim({ x: r.lotWidth, y: 0 }, { x: r.lotWidth, y: r.lotLength }, 900);
    dim({ x: r.left, y: 0 }, { x: r.left, y: r.front }, r.width / 2);
    dim({ x: r.left, y: r.front + r.length }, { x: r.left, y: r.lotLength }, r.width / 2);
    dim({ x: 0, y: r.front + r.length / 2 }, { x: r.left, y: r.front + r.length / 2 }, 0);
    dim(
      { x: r.left + r.width, y: r.front + r.length / 2 },
      { x: r.lotWidth, y: r.front + r.length / 2 },
      0,
    );
    for (let i = 0; i < r.parking; i++) {
      const x = r.left + i * FT * 8;
      if (x + FT * 8 <= r.lotWidth && FT * 16 <= r.front) {
        rect(x, 100, FT * 8, FT * 16);
        text(x + FT * 4, FT * 8, `P${i + 1}`, 180);
      }
    }
    line(0, -2200, r.lotWidth, -2200, 40);
    text(r.lotWidth / 2, -2600, 'ROAD / ACCESS · confirm street & entrance', 180);
    line(r.lotWidth + 2500, 2000, r.lotWidth + 2500, 0, 30);
    line(r.lotWidth + 2500, 0, r.lotWidth + 2300, 450, 30);
    line(r.lotWidth + 2500, 0, r.lotWidth + 2700, 450, 30);
    text(r.lotWidth + 2500, -350, 'N*', 250);
    text(
      r.lotWidth / 2,
      r.lotLength + 1500,
      '*Orientation and surveyed boundaries require confirmation',
      180,
    );
  } else if (view.includes('elevation') || view === 'Section A–A') {
    const side = /Left|Right/.test(view),
      W = side ? r.length : r.width,
      H = r.floorHeight * r.floors;
    const roofRise = r.roof === 'Flat' ? 0 : mmRoof(r);
    scene.width = W;
    scene.height = H + roofRise + 600;
    rect(0, roofRise, W, H);
    line(-700, H + roofRise, W + 700, H + roofRise, 35);
    for (let i = 0; i <= r.floors; i++) {
      const y = roofRise + i * r.floorHeight;
      line(0, y, W, y, 35);
      text(W + 1500, y, `${(((r.floors - i) * r.floorHeight) / 1000).toFixed(2)} m`, 150);
    }
    // Project actual exterior opening positions from the selected face of every floor.
    p.floors.forEach((floor, index) => {
      const base = roofRise + (r.floors - index) * r.floorHeight;
      for (const o of floor.openings) {
        const w = floor.walls.find((w) => w.id === o.wallId);
        if (!w) continue;
        const exterior =
          view === 'Rear elevation'
            ? Math.abs(w.a.y - (r.length - r.wall / 2)) < 1 && Math.abs(w.b.y - w.a.y) < 1
            : view === 'Left elevation'
              ? Math.abs(w.a.x - r.wall / 2) < 1 && Math.abs(w.b.x - w.a.x) < 1
              : view === 'Right elevation'
                ? Math.abs(w.a.x - (r.width - r.wall / 2)) < 1 && Math.abs(w.b.x - w.a.x) < 1
                : Math.abs(w.a.y - r.wall / 2) < 1 && Math.abs(w.b.y - w.a.y) < 1;
        if (!exterior) continue;
        let x = (side ? w.a.y : w.a.x) + o.offset;
        if (view === 'Rear elevation' || view === 'Left elevation') x = W - x - o.width;
        const height = o.type === 'door' ? 2100 : 1200,
          sill = o.type === 'door' ? 0 : 900;
        rect(x, base - sill - height, o.width, height);
        if (o.type === 'window')
          line(x + o.width / 2, base - sill - height, x + o.width / 2, base - sill, 10);
      }
    });
    if (r.roof === 'Flat') rect(-250, 0, W + 500, 200);
    else if (r.roof === 'Gable' && side) rect(-250, 0, W + 500, roofRise);
    else {
      line(-250, roofRise, W / 2, 0, 35);
      line(W / 2, 0, W + 250, roofRise, 35);
      line(-250, roofRise, W + 250, roofRise, 25);
    }
    text(
      W / 2,
      H + roofRise + 400,
      'OPENING HEIGHTS / ROOF RISE ASSUMED · CONFIRM VERTICAL DESIGN',
      120,
    );
    if (view === 'Section A–A') {
      text(W / 2, H + roofRise + 800, 'SCHEMATIC SECTION · no structural member design', 150);
      for (let i = 0; i < r.floors; i++) {
        const y = roofRise + i * r.floorHeight;
        const stair = p.floors[i]?.features.find((v) => v.type === 'stair');
        if (stair) {
          line(stair.x, y + r.floorHeight, stair.x + stair.w, y, 25);
          text(stair.x + stair.w / 2, y + r.floorHeight / 2, 'STAIR*', 100);
        }
      }
    }
    dim({ x: W, y: roofRise }, { x: W, y: H + roofRise }, 800);
  } else if (view === 'Roof plan') {
    rect(-300, -300, r.width + 600, r.length + 600);
    rect(0, 0, r.width, r.length, false, 8);
    if (r.roof === 'Hip') {
      const inset = Math.min(r.width, r.length) / 2;
      line(0, 0, r.width / 2, inset);
      line(r.width, 0, r.width / 2, inset);
      line(r.width / 2, inset, r.width / 2, r.length - inset);
      line(0, r.length, r.width / 2, r.length - inset);
      line(r.width, r.length, r.width / 2, r.length - inset);
    } else if (r.roof === 'Gable') {
      line(r.width / 2, -300, r.width / 2, r.length + 300);
      line(0, r.length / 2, r.width / 2, r.length / 2);
      line(r.width / 2, r.length / 2, r.width, r.length / 2);
    }
    text(r.width / 2, r.length / 2 + 600, `${r.roof.toUpperCase()} ROOF · CONCEPT`, 200);
    text(r.width / 2, r.length / 2 + 950, 'Confirm pitch, overhangs, outlets and drainage', 120);
    dim({ x: 0, y: 0 }, { x: r.width, y: 0 }, -800);
  } else {
    scene.width = 18000;
    scene.height = 12000;
    scene.scale = 96;
    const lines: string[] = [];
    if (view === 'Door & window schedule') {
      lines.push('OPENING SCHEDULE · MODELLED WIDTHS', 'ID | FLOOR | TYPE | WIDTH | HEIGHT');
      p.floors.forEach((f) =>
        f.openings.forEach((o) =>
          lines.push(`${o.id} | ${f.name} | ${o.type} | ${measure(o.width)} | TO CONFIRM`),
        ),
      );
    } else if (view === 'Drainage brief') {
      lines.push(
        'PRELIMINARY DRAINAGE / SANITATION BRIEF',
        'No engineered drainage layout has been generated.',
        'Obtain survey levels and street drain connection levels.',
        'Confirm septic / sewer connection, setbacks and capacity.',
        'Design falls, invert levels, pipe diameters and inspection access.',
        'Coordinate sanitary fixtures on every floor.',
        'Professional drainage design and authority review required.',
      );
    } else {
      lines.push(
        'GENERAL ARCHITECTURAL NOTES',
        'PRELIMINARY · FOR PROFESSIONAL REVIEW',
        'All model coordinates and DXF values are millimetres.',
        'Do not scale from screen; verify dimensions on site.',
        'Confirm boundaries, datum, north, easements and levels by survey.',
        'No structural member sizes or reinforcement are specified.',
        'Review fire egress, ventilation, accessibility and circulation.',
        'Roof rise, window heights and stair symbols are schematic.',
        'Coordinate drainage, electrical and structural designs.',
        'No government approval or professional certification is implied.',
        `Project: ${r.name}`,
        `Address: ${r.location}`,
        `Applicant: ${r.owner || 'NOT PROVIDED'}`,
      );
    }
    lines.slice(0, 55).forEach((s, i) => text(200, 300 + i * 205, s, 140, 'start'));
    if (lines.length > 55)
      text(200, 11800, 'Additional openings: export native project for full data.', 130, 'start');
  }
  return scene;
}
function mmRoof(r: Project['requirements']) {
  return Math.min(r.width, r.length) * 0.2;
}
export function sceneBounds(s: Scene) {
  let minX = -1500,
    minY = -1500,
    maxX = s.width + 2400,
    maxY = s.height + 1200;
  for (const q of s.items) {
    if (q.type === 'line') {
      minX = Math.min(minX, q.x1, q.x2);
      minY = Math.min(minY, q.y1, q.y2);
      maxX = Math.max(maxX, q.x1, q.x2);
      maxY = Math.max(maxY, q.y1, q.y2);
    }
    if (q.type === 'text') {
      minX = Math.min(minX, q.x - 1000);
      minY = Math.min(minY, q.y - 300);
      maxX = Math.max(maxX, q.x + 1000);
      maxY = Math.max(maxY, q.y + 300);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export function sceneSVG(s: Scene) {
  const b = sceneBounds(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="2400" height="${(2400 * b.h) / b.w}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="white"/>${s.items.map((q) => (q.type === 'line' ? `<line x1="${q.x1}" y1="${q.y1}" x2="${q.x2}" y2="${q.y2}" stroke="black" stroke-width="${q.width}"/>` : q.type === 'rect' ? `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" fill="${q.fill ? 'black' : 'none'}" stroke="black" stroke-width="${q.width}"/>` : `<text x="${q.x}" y="${q.y}" font-family="Arial" font-size="${q.size}" text-anchor="${q.anchor || 'middle'}">${esc(q.text)}</text>`)).join('')}</svg>`;
}
export function dxf(s: Scene) {
  const out: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '9',
    '$MEASUREMENT',
    '70',
    '1',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    out.push(
      '0',
      'LINE',
      '8',
      'ARCHITECTURE',
      '10',
      `${x1}`,
      '20',
      `${-y1}`,
      '30',
      '0',
      '11',
      `${x2}`,
      '21',
      `${-y2}`,
      '31',
      '0',
    );
  for (const q of s.items) {
    if (q.type === 'line') line(q.x1, q.y1, q.x2, q.y2);
    else if (q.type === 'rect') {
      line(q.x, q.y, q.x + q.w, q.y);
      line(q.x + q.w, q.y, q.x + q.w, q.y + q.h);
      line(q.x + q.w, q.y + q.h, q.x, q.y + q.h);
      line(q.x, q.y + q.h, q.x, q.y);
    } else
      out.push(
        '0',
        'TEXT',
        '8',
        'LABELS',
        '10',
        `${q.x - (q.anchor === 'start' ? 0 : q.text.length * q.size * 0.25)}`,
        '20',
        `${-q.y}`,
        '30',
        '0',
        '40',
        `${q.size}`,
        '1',
        q.text.replace(
          /[′″×–·]/g,
          (c) => ({ '′': "'", '″': '"', '×': 'x', '–': '-', '·': '/' })[c]!,
        ),
      );
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
