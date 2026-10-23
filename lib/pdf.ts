import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { drawing, sceneBounds, sheets } from './drawings.ts';
import type { Project } from './model.ts';
export const paperSizes = { A1: [841, 594], A2: [594, 420], ARCHD: [914.4, 609.6] } as const;
const safe = (s: string) =>
  s
    .replace(/[′″×–·]/g, (c) => ({ '′': "'", '″': '"', '×': 'x', '–': '-', '·': '/' })[c]!)
    .replace(/[^\x20-\x7e]/g, '?');
export async function exportPDF(
  p: Project,
  size: keyof typeof paperSizes = 'A1',
  selection?: { view: string; floor: number },
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(p.requirements.name);
  doc.setSubject('Preliminary architectural drawings for professional review');
  const views = selection
    ? [selection]
    : [
        ...p.floors.map((_, i) => ({ view: 'Floor plan', floor: i })),
        ...sheets.map((view) => ({ view, floor: 0 })),
      ];
  const pt = 72 / 25.4;
  for (let i = 0; i < views.length; i++) {
    const { view, floor } = views[i];
    const s = drawing(p, view, floor),
      b = sceneBounds(s),
      [pw, ph] = paperSizes[size];
    const factor = pt / s.scale;
    const maxW = (pw - 40) * pt,
      maxH = (ph - 85) * pt;
    if (b.w * factor > maxW || b.h * factor > maxH)
      throw Error(
        `${s.title} does not fit ${size} at 1:${s.scale}. Choose a larger sheet; scale has not been silently changed.`,
      );
    const page = doc.addPage([pw * pt, ph * pt]);
    const ox = (pw * pt - b.w * factor) / 2 - b.x * factor,
      oy = (ph * pt - 55 * pt - b.h * factor) / 2 - b.y * factor;
    const X = (x: number) => ox + x * factor,
      Y = (y: number) => ph * pt - (oy + y * factor);
    for (const q of s.items) {
      if (q.type === 'line')
        page.drawLine({
          start: { x: X(q.x1), y: Y(q.y1) },
          end: { x: X(q.x2), y: Y(q.y2) },
          thickness: Math.max(0.15, q.width * factor),
          color: rgb(0, 0, 0),
        });
      else if (q.type === 'rect')
        page.drawRectangle({
          x: X(q.x),
          y: Y(q.y + q.h),
          width: q.w * factor,
          height: q.h * factor,
          borderWidth: q.width * factor,
          borderColor: rgb(0, 0, 0),
          ...(q.fill ? { color: rgb(0, 0, 0) } : {}),
        });
      else {
        const t = safe(q.text),
          fs = q.size * factor;
        page.drawText(t, {
          x: X(q.x) - (q.anchor === 'start' ? 0 : font.widthOfTextAtSize(t, fs) / 2),
          y: Y(q.y),
          size: fs,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }
    page.drawRectangle({
      x: 15 * pt,
      y: 12 * pt,
      width: (pw - 30) * pt,
      height: 35 * pt,
      borderWidth: 0.6,
      borderColor: rgb(0, 0, 0),
    });
    const tx = (t: string, x: number, y: number, sz = 8) => {
      const maxWidth =
        (x < pw * 0.45 ? pw * 0.47 - x - 12 : x < pw - 160 ? pw - 165 - x : pw - x - 25) * pt;
      let label = safe(t);
      while (label.length > 3 && font.widthOfTextAtSize(label, sz) > maxWidth)
        label = label.slice(0, -4) + '...';
      page.drawText(label, { x: x * pt, y: y * pt, size: sz, font });
    };
    tx('GY SMART HOUSE PLANNER', 20, 38, 10);
    tx(p.requirements.name, 20, 30, 9);
    tx(
      `${p.requirements.location} | ${p.requirements.owner || 'Applicant not provided'}`,
      20,
      23,
      7,
    );
    tx('PRELIMINARY - FOR PROFESSIONAL REVIEW', 20, 16, 8);
    tx(s.title, pw * 0.47, 38, 10);
    tx(`Scale 1:${s.scale} | Print at 100% / actual size`, pw * 0.47, 29);
    tx(
      `Model units: mm | ${size} | ${new Date(p.updatedAt).toISOString().slice(0, 10)}`,
      pw * 0.47,
      22,
    );
    tx(`A${String(i + 1).padStart(2, '0')} | Revision ${p.revisions.length}`, pw * 0.47, 16);
    tx('AUTHORITY STAMP / ANNOTATIONS', pw - 150, 37, 7);
    page.drawRectangle({
      x: (pw - 155) * pt,
      y: 15 * pt,
      width: 130 * pt,
      height: 25 * pt,
      borderWidth: 0.3,
      borderColor: rgb(0, 0, 0),
    });
    const sx = 25 * pt,
      sy = 58 * pt,
      len = 3048 * factor;
    page.drawLine({ start: { x: sx, y: sy }, end: { x: sx + len, y: sy }, thickness: 1 });
    for (let j = 0; j <= 2; j++)
      page.drawLine({
        start: { x: sx + (len * j) / 2, y: sy - 3 },
        end: { x: sx + (len * j) / 2, y: sy + 3 },
        thickness: 0.5,
      });
    for (let j = 0; j <= 2; j++) {
      const label = j === 2 ? '10 ft' : String(j * 5);
      page.drawText(label, {
        x: sx + (len * j) / 2 - font.widthOfTextAtSize(label, 7) / 2,
        y: sy + 7,
        size: 7,
        font,
      });
    }
  }
  return doc.save();
}
