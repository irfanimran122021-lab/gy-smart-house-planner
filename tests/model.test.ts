import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRequirements,
  newProject,
  mm,
  units,
  measure,
  generateFloors,
  generationIssues,
  geometryIssues,
  projectSchema,
  readiness,
} from '../lib/model.ts';
import { drawing, dxf, sceneSVG } from '../lib/drawings.ts';
import { exportPDF, paperSizes } from '../lib/pdf.ts';
import { PDFDocument } from 'pdf-lib';
import { applyAIProposal, stretchAxis, resizeRoom } from '../lib/editor.ts';
import { evidenceSchema, validateUpload } from '../lib/ai.ts';

test('feet, inches, metres and millimetres round-trip to one internal length', () => {
  assert.equal(mm(40), 12192);
  assert.equal(mm(480, 'in'), 12192);
  assert.equal(mm(12.192, 'm'), 12192);
  assert.equal(mm(12192, 'mm'), 12192);
  assert.equal(measure(mm(40)), '40′ 0″');
});
test('eight apartment acceptance case reports both the 1 ft discrepancy and spatial fit failure', () => {
  const r = { ...defaultRequirements, apartments: 8, left: mm(5), right: mm(5) };
  const issues = generationIssues(r);
  assert.ok(issues.some((x) => x.id === 'setback-width' && x.detail.includes('1′ 0″')));
  assert.ok(issues.some((x) => x.id === 'fit'));
  assert.throws(() => generateFloors(r), /Unallocated/);
  assert.throws(() => generateFloors({ ...r, right: mm(6) }), /template requires/);
});
test('coordinated default floors have valid geometry and every room has an entrance path', () => {
  const p = newProject();
  assert.equal(p.floors.length, 2);
  for (const f of p.floors) {
    assert.equal(f.rooms.filter((q) => q.name.startsWith('Bedroom')).length, 4);
    assert.deepEqual(geometryIssues(f, p.requirements), []);
    for (const w of f.walls) assert.ok(w.a.x === w.b.x || w.a.y === w.b.y);
    for (const room of f.rooms) {
      assert.ok(room.w > 0 && room.h > 0);
      assert.ok(room.x + room.w <= p.requirements.width);
    }
  }
  const f = p.floors[0],
    g = p.floors[1];
  assert.deepEqual(
    f.features.map(({ id, ...v }) => v),
    g.features.map(({ id, ...v }) => v),
  );
  assert.equal(
    new Set(p.floors.flatMap((f) => f.rooms.map((q) => q.id))).size,
    p.floors.reduce((sum, f) => sum + f.rooms.length, 0),
  );
});
test('overlapping rooms, invalid openings and missing access are detected', () => {
  const p = newProject(),
    f = structuredClone(p.floors[0]);
  f.rooms[1] = { ...f.rooms[1], x: f.rooms[0].x, y: f.rooms[0].y };
  f.openings[0].width = 100000;
  f.openings = f.openings.filter((o) => o.to !== f.rooms[2].id && o.from !== f.rooms[2].id);
  const issues = geometryIssues(f, p.requirements);
  assert.ok(issues.some((x) => x.id.startsWith('overlap')));
  assert.ok(issues.some((x) => x.id.startsWith('opening')));
  assert.ok(issues.some((x) => x.id.startsWith('access')));
});
test('layout alternatives preserve building boundaries and change room proportions', () => {
  const a = generateFloors(defaultRequirements, 0),
    b = generateFloors(defaultRequirements, 1);
  assert.notEqual(a[0].rooms[2].h, b[0].rooms[2].h);
  assert.deepEqual(geometryIssues(b[0], defaultRequirements), []);
});
test('native project serializes and reopens without losing exact geometry', () => {
  const p = newProject();
  p.revisions.push({ date: new Date().toISOString(), note: 'Draft' });
  p.references.push({
    id: 'reference',
    name: 'survey.pdf',
    path: 'owner/project/survey.pdf',
    type: 'application/pdf',
  });
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() =>
    projectSchema.parse({ ...p, requirements: { ...p.requirements, width: -1 } }),
  );
});
test('reference extraction keeps null measurements and conflicting evidence', () => {
  const data = evidenceSchema.parse({
    measurements: [
      {
        field: 'width',
        value: null,
        unit: null,
        source: 'photo',
        confidence: 'low',
        note: 'Not labelled',
      },
      { field: 'left', value: 5, unit: 'ft', source: 'scan A', confidence: 'high', note: '' },
      { field: 'left', value: 6, unit: 'ft', source: 'scan B', confidence: 'high', note: '' },
    ],
    conflicts: ['Side setback differs'],
    missing: ['width'],
    observations: [],
  });
  assert.equal(data.measurements[0].value, null);
  assert.equal(data.measurements.filter((x) => x.field === 'left').length, 2);
});
test('upload validation rejects unsupported and oversized files', () => {
  for (const [type, name] of [
    ['image/jpeg', 'photo.jpg'],
    ['image/png', 'sketch.png'],
    ['image/webp', 'house.webp'],
    ['application/pdf', 'survey.pdf'],
  ])
    assert.doesNotThrow(() => validateUpload({ name, type, size: 1024 }));
  assert.throws(() =>
    validateUpload({ name: 'script.exe', type: 'application/octet-stream', size: 20 }),
  );
  assert.throws(() =>
    validateUpload({ name: 'large.pdf', type: 'application/pdf', size: 4 * 1024 * 1024 }),
  );
});
test('AI edits remain proposals and reject unsupported or impossible changes', () => {
  const p = newProject(),
    snapshot = JSON.stringify(p);
  const proposal = {
    message: 'Rename bedroom',
    changes: [{ target: 'room', id: p.floors[0].rooms[2].id, field: 'name', value: 'Main living' }],
  };
  const next = applyAIProposal(p, proposal);
  assert.equal(next.floors[0].rooms[2].name, 'Main living');
  assert.equal(JSON.stringify(p), snapshot);
  assert.throws(() =>
    applyAIProposal(p, {
      message: 'too many units',
      changes: [{ target: 'requirements', id: '', field: 'apartments', value: 8 }],
    }),
  );
  assert.throws(() =>
    applyAIProposal(p, {
      message: 'bad edit',
      changes: [{ target: 'requirements', id: '', field: 'owner_id', value: 'attacker' }],
    }),
  );
});
test('interior wall movement preserves orthogonal joins and bounding dimensions', () => {
  const p = newProject(),
    f = p.floors[0],
    old = f.walls.find(
      (w) => w.a.x === w.b.x && w.a.x > 1000 && w.a.x < p.requirements.width - 1000,
    )!.a.x;
  const next = stretchAxis(f, 'x', old, old + 100, p.requirements.width);
  assert.deepEqual(geometryIssues(next, p.requirements), []);
  assert.equal(Math.max(...next.walls.map((w) => w.b.x)), Math.max(...f.walls.map((w) => w.b.x)));
  assert.throws(() => stretchAxis(f, 'x', 0, 500, p.requirements.width));
});
test('site, elevations, sections and roof derive from the same building requirements', () => {
  const p = newProject();
  assert.equal(drawing(p, 'Site plan').width, p.requirements.lotWidth);
  assert.equal(drawing(p, 'Left elevation').width, p.requirements.length);
  assert.equal(drawing(p, 'Front elevation').width, p.requirements.width);
  assert.equal(drawing(p, 'Section A–A').width, p.requirements.width);
  const s = drawing(p, 'Floor plan');
  assert.equal(s.scale, 96);
  assert.equal(drawing(p, 'Site plan').scale, 192);
  assert.ok(sceneSVG(s).includes('xmlns="http://www.w3.org/2000/svg"'));
  const cad = dxf(s);
  assert.ok(cad.includes('$INSUNITS\n70\n4'));
  assert.ok(cad.includes('LINE'));
  assert.ok(cad.endsWith('0\nEOF'));
  assert.ok(cad.includes('12192'));
});
test('vector PDF exports a full coordinated package at exact physical sheet size', async () => {
  const p = newProject();
  const bytes = await exportPDF(p);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 12);
  const page = pdf.getPage(0);
  assert.ok(Math.abs(page.getWidth() - (841 * 72) / 25.4) < 0.01);
  assert.ok(Math.abs(page.getHeight() - (594 * 72) / 25.4) < 0.01);
  const site = await exportPDF(p, 'A2', { view: 'Site plan', floor: 0 });
  assert.equal((await PDFDocument.load(site)).getPageCount(), 1);
  assert.equal(((mm(10) / 96) * 72) / 25.4, 90);
});
test('PDF refuses to silently shrink an oversized measured drawing', async () => {
  const p = newProject();
  p.requirements.lotLength = 200000;
  await assert.rejects(exportPDF(p, 'A2', { view: 'Site plan', floor: 0 }), /does not fit/);
});
test('readiness flags missing documents, authority, engineering and stair misalignment', () => {
  const p = newProject();
  p.floors[1].features[0].x += 100;
  const ids = readiness(p).map((x) => x.id);
  for (const id of [
    'property',
    'doc-survey',
    'authority',
    'engineering',
    'services',
    'stair-alignment',
  ])
    assert.ok(ids.includes(id));
});
test('exact room resize keeps wall enclosures and sets the requested clear dimension', () => {
  const p = newProject(),
    f = p.floors[0],
    q = f.rooms.find((q) => q.name === 'Kitchen')!;
  const next = resizeRoom(f, q.id, q.w + 100, q.h + 100, p.requirements);
  assert.ok(Math.abs(next.rooms.find((x) => x.id === q.id)!.w - q.w - 100) < 0.001);
  assert.ok(Math.abs(next.rooms.find((x) => x.id === q.id)!.h - q.h - 100) < 0.001);
  assert.deepEqual(geometryIssues(next, p.requirements), []);
});
test('removing a bounding wall flags the stale room enclosure', () => {
  const p = newProject(),
    f = structuredClone(p.floors[0]);
  f.walls = f.walls.filter((w) => w.id !== f.walls[0].id);
  assert.ok(geometryIssues(f, p.requirements).some((i) => i.id.startsWith('enclosure')));
});
test('elevation openings are projected from actual floor openings', () => {
  const p = newProject(),
    before = drawing(p, 'Front elevation').items.filter((x) => x.type === 'rect').length;
  const next = structuredClone(p);
  next.floors[0].openings = next.floors[0].openings.filter((o) => o.from !== 'outside');
  assert.equal(
    drawing(next, 'Front elevation').items.filter((x) => x.type === 'rect').length,
    before - 1,
  );
});
