'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronDown,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Expand,
  FileImage,
  FileText,
  FolderOpen,
  Grid2X2,
  History,
  House,
  Layers,
  LayoutDashboard,
  Maximize2,
  MessageSquare,
  Minus,
  MousePointer2,
  Move,
  PanelLeftClose,
  Plus,
  Redo2,
  Ruler,
  Save,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  DoorOpen,
  AppWindow,
  ChartNoAxesColumnIncreasing,
  AlertTriangle,
  Cloud,
  LogIn,
  Send,
  PenLine,
} from 'lucide-react';
import {
  defaultRequirements,
  generateFloors,
  generationIssues,
  geometryIssues,
  mm,
  measure,
  newProject,
  projectSchema,
  readiness,
  requirementsSchema,
  units,
  FT,
} from '../lib/model';
import type { Project, Requirements, Unit, Floor, Point } from '../lib/model';
import { drawing, sceneBounds, sceneSVG, dxf, sheets } from '../lib/drawings';
import { exportPDF } from '../lib/pdf';
import { accessToken, cloud, storeReference } from '../lib/cloud';
import { useAuthentication } from '../components/use-authentication';
import { useProjectWorkspace } from '../components/use-project-workspace';
import { AccountPanel } from '../components/account-panel';
import { CloudHistory } from '../components/cloud-history';
import { ProjectImport } from '../components/project-import';
import { writeDeviceProject } from '../lib/project-storage';
import { evidenceSchema, validateUpload } from '../lib/ai';
import type { Evidence } from '../lib/ai';
import { applyAIProposal, resizeRoom, stretchAxis } from '../lib/editor';

type Modal =
  'requirements' | 'upload' | 'export' | 'checks' | 'account' | 'history' | 'project-import' | null;
type Selected = { kind: 'room' | 'wall' | 'opening' | 'feature'; id: string } | null;
const uid = () => crypto.randomUUID();
const date = (s: string) =>
  new Date(s).toLocaleString('en-GB', {
    timeZone: 'America/Guyana',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ErrorBox({ text }: { text: string }) {
  return (
    <div className="error-box">
      <AlertTriangle size={17} />
      <span>{text}</span>
    </div>
  );
}
function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 10000) / 10000 : ''}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Plan({
  project,
  view = 'Floor plan',
  floor = 0,
  mini = false,
}: {
  project: Project;
  view?: string;
  floor?: number;
  mini?: boolean;
}) {
  const s = drawing(project, view, floor),
    b = sceneBounds(s);
  return (
    <svg
      viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
      className={mini ? 'mini-plan' : 'plan'}
      aria-label={`${s.title} vector drawing`}
    >
      {s.items.map((q, i) =>
        q.type === 'line' ? (
          <line
            key={i}
            x1={q.x1}
            y1={q.y1}
            x2={q.x2}
            y2={q.y2}
            stroke="currentColor"
            strokeWidth={q.width}
          />
        ) : q.type === 'rect' ? (
          <rect
            key={i}
            x={q.x}
            y={q.y}
            width={q.w}
            height={q.h}
            fill={q.fill ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={q.width}
          />
        ) : (
          <text
            key={i}
            x={q.x}
            y={q.y}
            textAnchor={q.anchor || 'middle'}
            fontSize={q.size}
            fill="currentColor"
          >
            {q.text}
          </text>
        ),
      )}
    </svg>
  );
}

export default function Planner() {
  const [project, setProject] = useState<Project | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [screen, setScreen] = useState<'workspace' | 'dashboard'>('workspace');
  const [modal, setModal] = useState<Modal>(null),
    [unit, setUnit] = useState<Unit>('ft'),
    [floorIndex, setFloorIndex] = useState(0),
    [view, setView] = useState('Floor plan'),
    [selected, setSelected] = useState<Selected>(null),
    [tool, setTool] = useState('select'),
    [zoom, setZoom] = useState(1),
    [snap, setSnap] = useState(true),
    [showGrid, setShowGrid] = useState(true);
  const [undo, setUndo] = useState<Project[]>([]),
    [redo, setRedo] = useState<Project[]>([]),
    [status, setStatus] = useState('Saved on this device'),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<Requirements>(defaultRequirements),
    [drafts, setDrafts] = useState<Project[]>([]),
    [draftChoice, setDraftChoice] = useState(0),
    [error, setError] = useState('');
  const [prompt, setPrompt] = useState(''),
    [messages, setMessages] = useState<{ role: string; text: string }[]>([]),
    [proposal, setProposal] = useState<{ project: Project; text: string } | null>(null),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [paper, setPaper] = useState<'A1' | 'A2' | 'ARCHD'>('A1'),
    [packageAll, setPackageAll] = useState(true),
    [format, setFormat] = useState('PDF'),
    [search, setSearch] = useState('');
  const [point, setPoint] = useState<Point | null>(null),
    [ruler, setRuler] = useState<number | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [evidenceSelections, setEvidenceSelections] = useState<Record<string, boolean>>({});
  const drag = useRef<{ point: Point; selected: Selected } | null>(null),
    svgRef = useRef<SVGSVGElement>(null),
    importRef = useRef<HTMLInputElement>(null);
  const auth = useAuthentication();
  const signedIn = auth.user?.email || '';
  const workspace = useProjectWorkspace(
    auth.user,
    auth.ready,
    project,
    setProject,
    setProjects,
    setStatus,
    setNotice,
  );
  const [studioOpen, setStudioOpen] = useState(false),
    [importId, setImportId] = useState<string | undefined>();
  const studioRef = useRef<HTMLDivElement>(null),
    busyOperation = useRef(0),
    authOwnerRef = useRef<string | null>(null),
    activeProjectRef = useRef<Project | null>(null);
  authOwnerRef.current = auth.user?.id || null;
  activeProjectRef.current = project;
  useEffect(() => {
    setUndo([]);
    busyOperation.current++;
    setBusy(false);
    setRedo([]);
    setSelected(null);
    setFloorIndex(0);
    setProposal(null);
    setEvidence(null);
    setFiles([]);
    setMessages([]);
    setDrafts([]);
    setForm({ ...defaultRequirements });
    setNotice('');
    setStudioOpen(false);
    setModal((current) => (current === 'account' ? current : null));
  }, [auth.user?.id]);
  useEffect(() => {
    if (auth.recovery) setModal('account');
  }, [auth.recovery]);
  useEffect(() => {
    if (!studioOpen) return;
    const close = (e: PointerEvent) => {
      if (!studioRef.current?.contains(e.target as Node)) setStudioOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStudioOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [studioOpen]);
  function openAccount(mode: 'signin' | 'signup' | 'forgot' = 'signin') {
    auth.open(mode);
    setError('');
    setStudioOpen(false);
    setModal('account');
  }
  function openCloudProjects() {
    setModal(null);
    setStudioOpen(false);
    setScreen('dashboard');
    void workspace.refresh();
  }
  function openProjectImport(id?: string) {
    setImportId(id);
    setError('');
    setStudioOpen(false);
    if (!auth.user) {
      openAccount();
      return;
    }
    setModal('project-import');
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
      if (e.key === 'Escape') {
        setPoint(null);
        setSelected(null);
        setTool('select');
      }
      if (e.key === 'Delete') removeSelected();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  const [creatingNew, setCreatingNew] = useState(false);
  function change(p: Project, note = 'Drawing edited') {
    if (!project) return;
    setUndo((v) => [...v.slice(-39), structuredClone(project)]);
    setRedo([]);
    if (p.id !== project.id) workspace.registerNew(p);
    setFloorIndex((i) => Math.min(i, p.floors.length - 1));
    setProject({
      ...p,
      updatedAt: new Date().toISOString(),
      revisions: [...p.revisions.slice(-99), { date: new Date().toISOString(), note }],
    });
  }
  function doUndo() {
    if (!project || !undo.length) return;
    setRedo((v) => [...v, project]);
    workspace.activate(undo[undo.length - 1]);
    setUndo((v) => v.slice(0, -1));
    setSelected(null);
  }
  function doRedo() {
    if (!project || !redo.length) return;
    setUndo((v) => [...v, project]);
    workspace.activate(redo[redo.length - 1]);
    setRedo((v) => v.slice(0, -1));
    setSelected(null);
  }
  function updateFloor(next: Floor, note = 'Drawing edited', validate = true) {
    if (!project) return;
    const issues = geometryIssues(next, project.requirements).filter((v) => v.severity === 'error');
    if (validate && issues.length) {
      setNotice(issues.map((x) => x.title).join(', '));
      return;
    }
    change(
      { ...project, floors: project.floors.map((f, i) => (i === floorIndex ? next : f)) },
      note,
    );
  }
  function openRequirements(newOne = false) {
    setCreatingNew(newOne);
    setError('');
    setDrafts([]);
    setForm(
      newOne
        ? { ...defaultRequirements, name: 'Untitled project', owner: '', location: '' }
        : structuredClone(project!.requirements),
    );
    setModal('requirements');
  }
  function preview() {
    try {
      const req = requirementsSchema.parse(form);
      const base = creatingNew ? newProject(req) : { ...project!, requirements: req };
      setDrafts(
        [0, 1].map((i) => ({
          ...base,
          confirmedMeasurements: true,
          floors: generateFloors(req, i),
        })),
      );
      setError('');
      setDraftChoice(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function acceptDraft() {
    const next = drafts[draftChoice];
    change(next, 'Generated layout after measurement confirmation');
    setModal(null);
    setView('Floor plan');
    setFloorIndex(0);
    setScreen('workspace');
    setSelected(null);
    setNotice(
      'Layout generated. Review circulation, stairs and authority requirements before submission.',
    );
  }
  function duplicateFloor() {
    if (!project) return;
    if (project.floors.length >= 12) {
      setNotice('Maximum 12 floors.');
      return;
    }
    const next = structuredClone(project),
      f = structuredClone(next.floors[floorIndex]),
      prefix = `f${next.floors.length}-`;
    const oldIds = new Map(f.rooms.map((q) => [q.id, prefix + q.id]));
    const wallIds = new Map(f.walls.map((w) => [w.id, prefix + w.id]));
    f.id = uid();
    f.name = `Floor ${next.floors.length + 1}`;
    f.rooms = f.rooms.map((q) => ({ ...q, id: oldIds.get(q.id)! }));
    f.walls = f.walls.map((w) => ({ ...w, id: wallIds.get(w.id)! }));
    f.openings = f.openings
      .filter((o) => o.from !== 'outside' || o.type === 'window')
      .map((o) => ({
        ...o,
        id: prefix + o.id,
        wallId: wallIds.get(o.wallId)!,
        from: oldIds.get(o.from) || o.from,
        to: oldIds.get(o.to) || o.to,
      }));
    f.features = f.features.map((v) => ({ ...v, id: prefix + v.id }));
    next.floors.push(f);
    next.requirements.floors++;
    next.requirements.apartments += project.requirements.apartments / project.requirements.floors;
    change(next, 'Duplicated floor');
    setFloorIndex(next.floors.length - 1);
    setSelected(null);
  }
  function removeSelected() {
    if (!project || !selected) return;
    const f = structuredClone(project.floors[floorIndex]);
    if (selected.kind === 'wall') {
      f.walls = f.walls.filter((w) => w.id !== selected.id);
      f.openings = f.openings.filter((o) => o.wallId !== selected.id);
      setNotice('Wall removed. Recheck room enclosure and circulation.');
    } else if (selected.kind === 'opening')
      f.openings = f.openings.filter((o) => o.id !== selected.id);
    else if (selected.kind === 'feature')
      f.features = f.features.filter((v) => v.id !== selected.id);
    else {
      setNotice('Rooms are tied to wall geometry. Edit their dimensions or remove bounding walls.');
      return;
    }
    updateFloor(f, 'Removed drawing object');
    setSelected(null);
  }
  function svgPoint(e: React.PointerEvent) {
    const svg = svgRef.current!,
      pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: snap ? Math.round(p.x / mm(0.25)) * mm(0.25) : p.x,
      y: snap ? Math.round(p.y / mm(0.25)) * mm(0.25) : p.y,
    };
  }
  function pointerDown(e: React.PointerEvent) {
    if (!project || view !== 'Floor plan') return;
    const p = svgPoint(e);
    if (tool === 'wall' || tool === 'measure') {
      if (!point) {
        setPoint(p);
        return;
      }
      if (tool === 'measure') {
        setRuler(Math.hypot(p.x - point.x, p.y - point.y));
        setPoint(null);
        return;
      }
      const end =
        Math.abs(p.x - point.x) > Math.abs(p.y - point.y)
          ? { x: p.x, y: point.y }
          : { x: point.x, y: p.y };
      const f = structuredClone(project.floors[floorIndex]);
      f.walls.push({ id: uid(), a: point, b: end, thickness: project.requirements.wall });
      updateFloor(f, 'Drew wall');
      setPoint(null);
      return;
    }
    if (['stair', 'veranda', 'column', 'label', 'dimension'].includes(tool)) {
      const f = structuredClone(project.floors[floorIndex]);
      const t = tool as Floor['features'][number]['type'];
      f.features.push({
        id: uid(),
        type: t,
        x: p.x,
        y: p.y,
        w: mm(t === 'stair' ? 8 : t === 'column' ? 1 : 10),
        h: mm(t === 'stair' ? 12 : t === 'column' ? 1 : 4),
        rotation: 0,
        label: t === 'label' ? 'New label' : t,
      });
      updateFloor(f, `Added ${t}`);
      return;
    }
    if (selected && tool === 'move') {
      drag.current = { point: p, selected };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  }
  function pointerUp(e: React.PointerEvent) {
    if (!project || !drag.current) return;
    const d = drag.current;
    drag.current = null;
    const p = svgPoint(e),
      dx = p.x - d.point.x,
      dy = p.y - d.point.y;
    let f = structuredClone(project.floors[floorIndex]);
    try {
      if (d.selected?.kind === 'wall') {
        const w = f.walls.find((w) => w.id === d.selected?.id)!;
        const axis = Math.abs(w.a.x - w.b.x) < 1 ? 'x' : 'y';
        f = stretchAxis(
          f,
          axis,
          w.a[axis],
          w.a[axis] + (axis === 'x' ? dx : dy),
          axis === 'x' ? project.requirements.width : project.requirements.length,
        );
      } else if (d.selected?.kind === 'feature') {
        const v = f.features.find((v) => v.id === d.selected?.id)!;
        v.x += dx;
        v.y += dy;
      } else
        throw Error(
          'Select an interior wall or feature to move. Shared room geometry follows wall movement.',
        );
      updateFloor(f, 'Moved drawing object');
    } catch (err) {
      setNotice((err as Error).message);
    }
  }
  function selectWall(id: string, p: Point) {
    if (!project) return;
    if (tool === 'door' || tool === 'window') {
      const f = structuredClone(project.floors[floorIndex]),
        w = f.walls.find((w) => w.id === id)!,
        L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
        width = mm(tool === 'door' ? 3 : 4),
        offset = Math.max(0, Math.min(L - width, Math.hypot(p.x - w.a.x, p.y - w.a.y)));
      if (width > L) {
        setNotice('This opening is wider than the wall segment. Choose another wall.');
        return;
      }
      if (
        f.openings.some(
          (o) => o.wallId === id && o.offset < offset + width && o.offset + o.width > offset,
        )
      ) {
        setNotice('The opening overlaps an existing door or window.');
        return;
      }
      const o = {
        id: uid(),
        wallId: id,
        offset,
        width,
        type: tool as 'door' | 'window',
        from: 'unassigned',
        to: 'unassigned',
      };
      f.openings.push(o);
      updateFloor(f, `Inserted ${tool}`);
      setSelected({ kind: 'opening', id: o.id });
      setNotice('Opening added. Assign connected spaces in the inspector to verify access.');
    } else setSelected({ kind: 'wall', id });
  }
  async function manualSave() {
    if (!project) return;
    try {
      if (auth.user) {
        if (!workspace.isCloud(project.id)) {
          openProjectImport(project.id);
          return;
        }
        await workspace.save(project);
        setNotice('Project and revision saved to your cloud account.');
      } else {
        writeDeviceProject(localStorage, project);
        setNotice('Project saved on this device. Sign in for cloud backup.');
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function upload() {
    if (!project || !files.length) return;
    const operation = ++busyOperation.current;
    const owner = authOwnerRef.current,
      drawingAtStart = project;
    const current = () =>
      owner === authOwnerRef.current && drawingAtStart === activeProjectRef.current;
    setBusy(true);
    setError('');
    try {
      const refs = [];
      for (const file of files) {
        if (!current()) return;
        validateUpload(file);
        refs.push(await storeReference(project, file));
      }
      if (!current()) return;
      change(
        {
          ...project,
          references: [...project.references, ...refs].slice(-30),
          confirmedMeasurements: false,
        },
        'Stored reference uploads',
      );
      setFiles([]);
      setNotice(
        'References stored privately. Select Interpret references to extract measurements.',
      );
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
    } finally {
      if (operation === busyOperation.current) setBusy(false);
    }
  }
  async function interpret() {
    if (!project) return;
    const operation = ++busyOperation.current;
    const owner = authOwnerRef.current,
      drawingAtStart = project;
    const current = () =>
      owner === authOwnerRef.current && drawingAtStart === activeProjectRef.current;
    setBusy(true);
    setError('');
    try {
      const token = await accessToken();
      const res = await fetch('/api/interpret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ references: project.references.slice(-4) }),
      });
      const data = await res.json();
      if (!current()) return;
      if (!res.ok) throw Error(data.error);
      setEvidence(evidenceSchema.parse(data));
      setEvidenceSelections({});
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
    } finally {
      if (operation === busyOperation.current) setBusy(false);
    }
  }
  function confirmEvidence() {
    if (!project || !evidence) return;
    const r = { ...project.requirements };
    for (let i = 0; i < evidence.measurements.length; i++) {
      const m = evidence.measurements[i];
      if (!evidenceSelections[String(i)] || m.value === null || !m.unit) continue;
      if (
        ['lotWidth', 'lotLength', 'width', 'length', 'front', 'rear', 'left', 'right'].includes(
          m.field,
        ) &&
        m.unit !== 'count'
      )
        (r as Record<string, unknown>)[m.field] = mm(m.value, m.unit);
      if (['floors', 'apartments', 'bedrooms', 'bathrooms'].includes(m.field) && m.unit === 'count')
        (r as Record<string, unknown>)[m.field] = m.value;
    }
    setCreatingNew(false);
    setForm(r);
    setDrafts([]);
    setEvidence(null);
    setModal('requirements');
    setError(
      'Review all imported measurements and reconcile conflicts before generating. The existing drawing is unchanged until you apply a layout.',
    );
  }
  async function assistant() {
    if (!project || !prompt.trim()) return;
    const text = prompt;
    setPrompt('');
    setMessages((v) => [...v, { role: 'user', text }]);
    const operation = ++busyOperation.current;
    const owner = authOwnerRef.current,
      drawingAtStart = project;
    const current = () =>
      owner === authOwnerRef.current && drawingAtStart === activeProjectRef.current;
    setBusy(true);
    try {
      const token = await accessToken();
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ project, prompt: text }),
      });
      const data = await res.json();
      if (!current()) return;
      if (!res.ok) throw Error(data.error);
      if (!data.changes?.length) {
        setMessages((v) => [...v, { role: 'assistant', text: data.message }]);
        return;
      }
      const next = applyAIProposal(project, data);
      setProposal({ project: next, text: data.message });
      setMessages((v) => [
        ...v,
        {
          role: 'assistant',
          text: 'A proposed change is ready. Review the drawing preview before applying it.',
        },
      ]);
    } catch (e) {
      if (!current()) return;
      setMessages((v) => [...v, { role: 'assistant', text: (e as Error).message }]);
    } finally {
      if (operation === busyOperation.current) setBusy(false);
    }
  }
  async function exportFile() {
    if (!project) return;
    setError('');
    const operation = ++busyOperation.current;
    const owner = authOwnerRef.current,
      drawingAtStart = project;
    const current = () =>
      owner === authOwnerRef.current && drawingAtStart === activeProjectRef.current;
    setBusy(true);
    try {
      const s = drawing(project, view, floorIndex),
        name = project.requirements.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (format === 'PDF') {
        const bytes = await exportPDF(
          project,
          paper,
          packageAll ? undefined : { view, floor: floorIndex },
        );
        if (!current()) return;
        download(
          new Uint8Array(bytes).buffer,
          `${name}-${packageAll ? 'drawing-package' : s.title}.pdf`,
          'application/pdf',
        );
      }
      if (format === 'DXF') download(dxf(s), `${name}-${s.title}.dxf`, 'application/dxf');
      if (format === 'SVG') download(sceneSVG(s), `${name}-${s.title}.svg`, 'image/svg+xml');
      if (format === 'Project')
        download(JSON.stringify(project, null, 2), `${name}.gyplan`, 'application/json');
      if (format === 'PNG') {
        const url = URL.createObjectURL(new Blob([sceneSVG(s)], { type: 'image/svg+xml' }));
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = 3200;
          c.height = Math.round((3200 * img.height) / img.width);
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
          if (!blob) throw Error('PNG rendering failed.');
          const output = await blob.arrayBuffer();
          if (!current()) return;
          download(output, `${name}.png`, 'image/png');
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (!current()) return;
      change(
        {
          ...project,
          downloads: [...project.downloads.slice(-199), { date: new Date().toISOString(), format }],
        },
        `Exported ${format}`,
      );
      setNotice(`${format} downloaded. Drawings are preliminary and need professional review.`);
      setModal(null);
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
    } finally {
      if (operation === busyOperation.current) setBusy(false);
    }
  }
  async function importProject(file: File) {
    const owner = authOwnerRef.current;
    try {
      if (file.size > 5000000) throw Error('Native project exceeds 5 MB.');
      const p = projectSchema.parse(JSON.parse(await file.text()));
      if (owner !== authOwnerRef.current) return;
      const imported = { ...p, id: uid() };
      workspace.registerNew(imported);
      setProject(imported);
      setScreen('workspace');
      setFloorIndex(0);
      setUndo([]);
      setRedo([]);
      setNotice('Project imported as a new copy.');
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
    }
  }
  if (!project || (auth.ready && workspace.owner !== (auth.user?.id || null)))
    return (
      <div className="loading">
        <Building2 size={36} />
        <p>Opening your architectural workspace…</p>
      </div>
    );
  const r = project.requirements,
    floor = project.floors[floorIndex] || project.floors[0],
    scene = drawing(project, view, floorIndex),
    bounds = sceneBounds(scene),
    issues = readiness(project),
    errors = issues.filter((x) => x.severity === 'error');
  const selectedRoom =
      selected?.kind === 'room' ? floor.rooms.find((v) => v.id === selected.id) : null,
    selectedWall = selected?.kind === 'wall' ? floor.walls.find((v) => v.id === selected.id) : null,
    selectedOpening =
      selected?.kind === 'opening' ? floor.openings.find((v) => v.id === selected.id) : null,
    selectedFeature =
      selected?.kind === 'feature' ? floor.features.find((v) => v.id === selected.id) : null;
  const modalTitles = {
    requirements: 'Project requirements',
    upload: 'Reference studio',
    export: 'Export drawings',
    checks: 'Preliminary submission readiness',
    account: 'Your account',
    history: 'Project history',
    'project-import': 'Copy device projects to account',
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setScreen('dashboard');
          }}
        >
          <span className="brand-icon">
            <House size={25} />
          </span>
          <span>
            GY Smart<span className="brand-sub">HOUSE PLANNER</span>
          </span>
        </a>
        <div className="studio-control" ref={studioRef}>
          <button
            className="studio-switch"
            aria-label="My architecture studio"
            aria-haspopup="menu"
            aria-expanded={studioOpen}
            onClick={() => setStudioOpen((v) => !v)}
          >
            <span className="avatar">{signedIn ? signedIn.slice(0, 2).toUpperCase() : 'GY'}</span>
            <span>
              My architecture studio<small>{signedIn || 'Personal workspace'}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {studioOpen && (
            <div className="studio-menu" role="menu" aria-label="Studio account menu">
              {auth.user ? (
                <>
                  <div className="studio-user">
                    <b>{auth.user.user_metadata.full_name || 'Your account'}</b>
                    <small>{auth.user.email}</small>
                  </div>
                  <button role="menuitem" onClick={() => openAccount()}>
                    Account settings
                  </button>
                  <button role="menuitem" onClick={openCloudProjects}>
                    Cloud projects
                  </button>
                  <button role="menuitem" onClick={() => openProjectImport()}>
                    Copy device projects
                  </button>
                  <button
                    role="menuitem"
                    disabled={auth.busy}
                    onClick={async () => {
                      setStudioOpen(false);
                      if (!(await auth.run('signout'))) setModal('account');
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <button role="menuitem" onClick={() => openAccount('signin')}>
                    Sign in
                  </button>
                  <button role="menuitem" onClick={() => openAccount('signup')}>
                    Create account
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={screen === 'dashboard' ? 'active' : ''}
            onClick={() => setScreen('dashboard')}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button
            className={screen === 'workspace' ? 'active' : ''}
            onClick={() => setScreen('workspace')}
          >
            <PenLine size={18} />
            Design workspace
            <span className="nav-dot" />
          </button>
          <button
            onClick={() => {
              setError('');
              setModal('upload');
            }}
          >
            <ScanLine size={18} />
            Reference studio<span className="new-badge">AI</span>
          </button>
          <button onClick={() => setModal('checks')}>
            <ShieldCheck size={18} />
            Submission readiness
          </button>
          <button onClick={() => setModal('history')}>
            <History size={18} />
            Version history
          </button>
        </nav>
        <div className="nav-label drawing-label">
          PROJECT DRAWINGS <span>{project.floors.length + sheets.length}</span>
        </div>
        <div className="drawing-nav">
          {project.floors.map((f, i) => (
            <button
              key={f.id}
              className={
                view === 'Floor plan' && floorIndex === i && screen === 'workspace' ? 'current' : ''
              }
              onClick={() => {
                setFloorIndex(i);
                setView('Floor plan');
                setScreen('workspace');
                setSelected(null);
              }}
            >
              <Layers size={16} />
              {f.name}
              <span>A{String(i + 1).padStart(2, '0')}</span>
            </button>
          ))}
          {['Site plan', 'Front elevation', 'Section A–A', 'Roof plan'].map((v) => (
            <button
              key={v}
              className={view === v ? 'current' : ''}
              onClick={() => {
                setView(v);
                setScreen('workspace');
                setSelected(null);
              }}
            >
              <FileText size={16} />
              {v}
            </button>
          ))}
        </div>
        <button className="add-sheet" onClick={duplicateFloor}>
          <Plus size={15} />
          Duplicate current floor
        </button>
        <div className="sidebar-bottom">
          <div className="review-note">
            <ShieldCheck size={19} />
            <b>Designed for Guyana</b>
            <p>Measured drawings. Informed decisions. Professional review.</p>
            <a href="https://chpa.gov.gy/single-window/" target="_blank" rel="noreferrer">
              View CHPA guidance <ArrowUpRight size={13} />
            </a>
          </div>
          <button
            className="account"
            onClick={() => {
              openAccount();
            }}
          >
            <span className="avatar">{signedIn ? signedIn.slice(0, 2).toUpperCase() : 'GY'}</span>
            <span>
              {signedIn || 'Your workspace'}
              <small>{signedIn ? 'Cloud account' : 'Device storage · sign in for cloud'}</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <b>{screen === 'dashboard' ? 'Overview' : r.name}</b>
            {screen === 'workspace' && <span className="draft-pill">Draft</span>}
          </div>
          <div className="top-actions">
            {auth.user ? (
              <button className="btn auth-entry" onClick={() => openAccount()}>
                Account
              </button>
            ) : (
              <>
                <button className="btn auth-entry" onClick={() => openAccount('signin')}>
                  Sign in
                </button>
                <button className="btn auth-entry" onClick={() => openAccount('signup')}>
                  Create account
                </button>
              </>
            )}

            <span className="save-state">
              <span /> {status}
            </span>
            <button className="btn" disabled={workspace.saving} onClick={manualSave}>
              <Save size={15} />
              Save project
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setError('');
                setModal('export');
              }}
            >
              <Download size={16} />
              Export drawings <ChevronDown size={14} />
            </button>
          </div>
        </header>
        {workspace.error && (
          <div role="alert" className="notice sync-warning">
            <AlertTriangle size={16} />
            <span>{workspace.error}</span>
            {workspace.conflict && (
              <button
                className="btn"
                disabled={workspace.saving}
                onClick={() => void workspace.resolveConflict().catch((e) => setNotice(e.message))}
              >
                Save my edits as a separate cloud project
              </button>
            )}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <CheckCircle2 size={17} />
            {notice}
            <button onClick={() => setNotice('')} aria-label="Dismiss notification">
              <X size={16} />
            </button>
          </div>
        )}
        {screen === 'dashboard' ? (
          <div className="dashboard">
            <div className="eyebrow">YOUR DESIGN STUDIO</div>
            <div className="dashboard-heading">
              <div>
                <h1>A better plan starts here.</h1>
                <p>Turn your ideas into measured, editable architectural drawings.</p>
              </div>
              <button className="btn primary" onClick={() => openRequirements(true)}>
                <Plus size={17} />
                Create new project
              </button>
            </div>
            <div className="hero-card">
              <div>
                <span className="tag">FROM REFERENCE TO REAL GEOMETRY</span>
                <h2>
                  Your vision.
                  <br />A plan you can build on.
                </h2>
                <p>
                  Bring a sketch, floor plan or survey. Review its measurements, explore a layout
                  and make every line your own.
                </p>
                <button
                  className="btn white"
                  onClick={() => {
                    setError('');
                    setModal('upload');
                  }}
                >
                  <Upload size={16} />
                  Upload existing design
                  <ArrowRight size={16} />
                </button>
                <small>JPG, PNG, WEBP & PDF · Multiple references supported</small>
              </div>
              <div className="hero-plan">
                <Plan project={project} mini />
                <span>PRECISION IN EVERY LINE</span>
              </div>
            </div>
            <div className="stat-row">
              <div>
                <span>
                  <FolderOpen size={18} />
                  {auth.user ? 'Your projects' : 'Projects on this device'}
                </span>
                <b>{projects.length || 1}</b>
              </div>
              <div>
                <span>
                  <Layers size={18} />
                  Current drawing sheets
                </span>
                <b>{project.floors.length + sheets.length}</b>
              </div>
              <div>
                <span>
                  <Ruler size={18} />
                  Total gross floor area
                </span>
                <b>
                  {((r.width * r.length * r.floors) / FT ** 2).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  <small>sq ft</small>
                </b>
              </div>
              <div>
                <span>
                  <ShieldCheck size={18} />
                  Readiness items to review
                </span>
                <b>
                  {issues.filter((i) => i.severity !== 'info').length}
                  <small>items</small>
                </b>
              </div>
            </div>
            <div className="section-heading">
              <h2>
                Recent projects <span>{projects.length || 1}</span>
              </h2>
              <div className="search">
                <Search size={15} />
                <input
                  placeholder="Search projects"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="btn" onClick={() => importRef.current?.click()}>
                <Upload size={15} />
                Import project
              </button>
            </div>
            {auth.user && (
              <div className="cloud-library">
                <span>
                  <Cloud size={16} />
                  {workspace.loading
                    ? 'Loading cloud projects…'
                    : `${Object.keys(workspace.entries).length} account projects · ${workspace.deviceProjects.length} device projects`}
                </span>
                <button
                  className="btn"
                  disabled={workspace.loading}
                  onClick={() => void workspace.refresh()}
                >
                  Refresh cloud projects
                </button>
                <button className="btn" onClick={() => openProjectImport()}>
                  Copy device projects to account
                </button>
              </div>
            )}
            <div className="project-grid">
              {(projects.length ? projects : [project])
                .filter((p) => p.requirements.name.toLowerCase().includes(search.toLowerCase()))
                .map((p) => (
                  <article className="project-card" key={p.id}>
                    <button
                      className="project-thumbnail"
                      onClick={() => {
                        workspace.activate(p);
                        setFloorIndex(0);
                        setView('Floor plan');
                        setScreen('workspace');
                        setUndo([]);
                        setRedo([]);
                        setSelected(null);
                      }}
                    >
                      <Plan project={p} mini />
                      <span className="project-chip">
                        {workspace.isCloud(p.id) ? 'Cloud project' : 'On this device'}
                      </span>
                      <ArrowUpRight className="open-arrow" size={23} />
                    </button>
                    <div className="project-card-body">
                      <h3>{p.requirements.name}</h3>
                      <p>{p.requirements.location || 'Location to confirm'}</p>
                      <div>
                        <span>
                          {measure(p.requirements.width)} × {measure(p.requirements.length)}
                        </span>
                        <span>{p.requirements.floors} floors</span>
                      </div>
                      <footer>
                        <span>Updated {date(p.updatedAt)}</span>
                        <button
                          title="Duplicate project"
                          onClick={() => {
                            const copy = {
                              ...structuredClone(p),
                              id: uid(),
                              requirements: {
                                ...p.requirements,
                                name: p.requirements.name + ' · copy',
                              },
                            };
                            workspace.registerNew(copy);
                            setProject(copy);
                            setNotice('Project duplicated.');
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </footer>
                    </div>
                  </article>
                ))}
              <button className="new-project-card" onClick={() => openRequirements(true)}>
                <span>
                  <Plus size={24} />
                </span>
                <b>Start something new</b>
                <small>Create a project from your requirements</small>
              </button>
            </div>
            <div className="dashboard-foot">
              <ShieldCheck size={19} />
              <p>
                <b>Built for thoughtful planning.</b> All drawings are preliminary and subject to
                qualified professional review and applicable authority requirements.
              </p>
              <a href="https://chpa.gov.gy/ndc-corner/" target="_blank" rel="noreferrer">
                NDC resources <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <div className="eyebrow">ARCHITECTURAL WORKSPACE</div>
                <h1>{r.name}</h1>
                <p>
                  <span className="location-dot" />
                  {r.location || 'Set property location'}
                  <span className="middot">·</span>
                  {r.floors} storeys<span className="middot">·</span>
                  {r.apartments} apartments
                </p>
              </div>
              <button className="btn" onClick={() => openRequirements()}>
                <Settings2 size={16} />
                Project requirements
              </button>
            </div>
            <div className="workspace-tabs">
              <button className="active">
                <PenLine size={16} />
                Drawing editor
              </button>
              <button
                onClick={() => {
                  setError('');
                  setModal('upload');
                }}
              >
                <FileImage size={16} />
                References <span>{project.references.length}</span>
              </button>
              <button onClick={() => setModal('checks')}>
                <ShieldCheck size={16} />
                Readiness check{' '}
                <span className={errors.length ? 'error-count' : ''}>{issues.length}</span>
              </button>
              <div className="workspace-mode">
                <span className="live-dot" />
                Vector drawing · millimetre precision
              </div>
            </div>
            <div className="workspace-body">
              <section className="drawing-panel">
                <div className="drawing-toolbar">
                  <div className="floor-picker">
                    <Layers size={17} />
                    <select
                      aria-label="Drawing sheet"
                      value={view === 'Floor plan' ? `floor:${floorIndex}` : view}
                      onChange={(e) => {
                        if (e.target.value.startsWith('floor:')) {
                          setFloorIndex(Number(e.target.value.slice(6)));
                          setView('Floor plan');
                        } else setView(e.target.value);
                        setSelected(null);
                        setZoom(1);
                      }}
                    >
                      {project.floors.map((f, i) => (
                        <option key={f.id} value={`floor:${i}`}>
                          {f.name}
                        </option>
                      ))}
                      {sheets.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <span className="toolbar-divider" />
                  <button title="Undo (Ctrl+Z)" disabled={!undo.length} onClick={doUndo}>
                    <Undo2 size={17} />
                  </button>
                  <button title="Redo (Ctrl+Shift+Z)" disabled={!redo.length} onClick={doRedo}>
                    <Redo2 size={17} />
                  </button>
                  <div className="toolbar-right">
                    <button
                      className={showGrid ? 'enabled' : ''}
                      title="Toggle grid"
                      onClick={() => setShowGrid((v) => !v)}
                    >
                      <Grid2X2 size={17} />
                    </button>
                    <button title="Fit drawing" onClick={() => setZoom(1)}>
                      <Expand size={17} />
                    </button>
                    <select
                      aria-label="Display units"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as Unit)}
                    >
                      {Object.keys(units).map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={`canvas-area ${showGrid ? 'grid-on' : ''}`}>
                  <div className="canvas-title">
                    <span>{scene.title.toUpperCase()}</span>
                    <small>PRELIMINARY · FOR PROFESSIONAL REVIEW</small>
                  </div>
                  <div className="tool-palette">
                    {[
                      { id: 'select', icon: MousePointer2, label: 'Select' },
                      { id: 'move', icon: Move, label: 'Move wall / feature' },
                      { id: 'wall', icon: PenLine, label: 'Draw wall: click two points' },
                      { id: 'door', icon: DoorOpen, label: 'Insert door on wall' },
                      { id: 'window', icon: AppWindow, label: 'Insert window on wall' },
                      {
                        id: 'stair',
                        icon: ChartNoAxesColumnIncreasing,
                        label: 'Add conceptual stair',
                      },
                      { id: 'veranda', icon: Square, label: 'Add veranda' },
                      { id: 'label', icon: FileText, label: 'Add label' },
                      { id: 'dimension', icon: Ruler, label: 'Add dimension' },
                      { id: 'measure', icon: ScanLine, label: 'Measure two points' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        aria-label={t.label}
                        title={t.label}
                        className={tool === t.id ? 'selected' : ''}
                        disabled={view !== 'Floor plan'}
                        onClick={() => {
                          setTool(t.id);
                          setPoint(null);
                          setNotice(t.label);
                        }}
                      >
                        <t.icon size={18} />
                      </button>
                    ))}
                  </div>
                  <div className="canvas-scroll">
                    <div
                      className="paper"
                      style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 480}px` }}
                    >
                      <svg
                        ref={svgRef}
                        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
                        className={`drawing-svg tool-${tool}`}
                        onPointerDown={pointerDown}
                        onPointerUp={pointerUp}
                        aria-label="Interactive architectural drawing"
                        role="img"
                      >
                        <g color="#17252b">
                          {scene.items.map((q, i) =>
                            q.type === 'line' ? (
                              <line
                                key={i}
                                x1={q.x1}
                                y1={q.y1}
                                x2={q.x2}
                                y2={q.y2}
                                stroke="currentColor"
                                strokeWidth={q.width}
                              />
                            ) : q.type === 'rect' ? (
                              <rect
                                key={i}
                                x={q.x}
                                y={q.y}
                                width={q.w}
                                height={q.h}
                                fill={q.fill ? 'currentColor' : 'none'}
                                stroke="currentColor"
                                strokeWidth={q.width}
                              />
                            ) : (
                              <text
                                key={i}
                                x={q.x}
                                y={q.y}
                                textAnchor={q.anchor || 'middle'}
                                fontSize={q.size}
                                fill="currentColor"
                              >
                                {q.text}
                              </text>
                            ),
                          )}
                        </g>
                        {view === 'Floor plan' && (
                          <g>
                            {floor.rooms.map((q) => (
                              <rect
                                key={q.id}
                                x={q.x}
                                y={q.y}
                                width={q.w}
                                height={q.h}
                                fill={selected?.id === q.id ? '#25a58c22' : 'transparent'}
                                stroke={selected?.id === q.id ? '#13967e' : 'none'}
                                strokeWidth={30}
                                onPointerDown={(e) => {
                                  if (tool === 'select') {
                                    e.stopPropagation();
                                    setSelected({ kind: 'room', id: q.id });
                                  }
                                }}
                              />
                            ))}
                            {floor.walls.map((w) => (
                              <line
                                key={w.id}
                                x1={w.a.x}
                                y1={w.a.y}
                                x2={w.b.x}
                                y2={w.b.y}
                                stroke={selected?.id === w.id ? '#169a84' : 'transparent'}
                                strokeWidth={Math.max(w.thickness, 180)}
                                onPointerDown={(e) => {
                                  if (['select', 'move', 'door', 'window'].includes(tool)) {
                                    const p = svgPoint(e);
                                    selectWall(w.id, p);
                                    if (tool === 'move') {
                                      drag.current = {
                                        point: p,
                                        selected: { kind: 'wall', id: w.id },
                                      };
                                      svgRef.current?.setPointerCapture(e.pointerId);
                                    }
                                    e.stopPropagation();
                                  }
                                }}
                              />
                            ))}
                            {floor.features.map((v) => (
                              <rect
                                key={v.id}
                                x={v.x}
                                y={v.y}
                                width={v.w}
                                height={v.h}
                                fill="transparent"
                                stroke={selected?.id === v.id ? '#169a84' : 'none'}
                                strokeWidth={30}
                                onPointerDown={(e) => {
                                  if (tool === 'select' || tool === 'move') {
                                    setSelected({ kind: 'feature', id: v.id });
                                    if (tool === 'move') {
                                      drag.current = {
                                        point: svgPoint(e),
                                        selected: { kind: 'feature', id: v.id },
                                      };
                                      svgRef.current?.setPointerCapture(e.pointerId);
                                    }
                                    e.stopPropagation();
                                  }
                                }}
                              />
                            ))}
                            {floor.openings.map((o) => {
                              const w = floor.walls.find((w) => w.id === o.wallId);
                              if (!w) return null;
                              const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
                                x = w.a.x + ((w.b.x - w.a.x) * o.offset) / L,
                                y = w.a.y + ((w.b.y - w.a.y) * o.offset) / L;
                              return (
                                <circle
                                  key={o.id}
                                  cx={x}
                                  cy={y}
                                  r={150}
                                  fill={selected?.id === o.id ? '#17a38a' : 'transparent'}
                                  onPointerDown={(e) => {
                                    if (tool === 'select') {
                                      e.stopPropagation();
                                      setSelected({ kind: 'opening', id: o.id });
                                    }
                                  }}
                                />
                              );
                            })}
                            {point && <circle cx={point.x} cy={point.y} r={100} fill="#13967e" />}
                          </g>
                        )}
                      </svg>
                      <div className="sheet-caption">
                        <div>
                          <b>{scene.title.toUpperCase()}</b>
                          <span>
                            {view === 'Site plan' ? '1/16″ = 1′–0″' : '1/8″ = 1′–0″'} · EXPORT AT
                            ACTUAL SIZE
                          </span>
                        </div>
                        <div>
                          <span>{r.name}</span>
                          <b>A{String(floorIndex + 1).padStart(2, '0')}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="canvas-controls">
                    <button onClick={() => setSnap((v) => !v)} className={snap ? 'snap-on' : ''}>
                      <Maximize2 size={13} />
                      {snap ? 'Snap on · 3 in' : 'Snap off'}
                    </button>
                    {ruler !== null && <span>Measured {measure(ruler, unit)}</span>}
                    <div>
                      <button
                        aria-label="Zoom out"
                        onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
                      >
                        <Minus size={16} />
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        aria-label="Zoom in"
                        onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="drawing-footer">
                  <span>
                    <span className="live-dot" /> {floor.rooms.length} spaces{' '}
                    <span className="middot">·</span>
                    {floor.walls.length} wall segments
                  </span>
                  <span>
                    1:{scene.scale}
                    <span className="middot">·</span>
                    {measure(r.width, unit)} × {measure(r.length, unit)}
                  </span>
                </div>
              </section>
              <aside className="inspector">
                <div className="inspector-heading">
                  <Settings2 size={16} />
                  <b>{selected ? 'Object properties' : 'Project at a glance'}</b>
                  <button title="Clear selection" onClick={() => setSelected(null)}>
                    {selected ? <X size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                <div className="properties">
                  {selectedRoom ? (
                    <>
                      <span className="property-label">
                        ROOM · APARTMENT {selectedRoom.apartment || 'SHARED'}
                      </span>
                      <label className="field">
                        Room name
                        <input
                          value={selectedRoom.name}
                          onChange={(e) =>
                            updateFloor(
                              {
                                ...floor,
                                rooms: floor.rooms.map((q) =>
                                  q.id === selectedRoom.id ? { ...q, name: e.target.value } : q,
                                ),
                              },
                              'Renamed room',
                            )
                          }
                        />
                      </label>
                      <div className="two-col">
                        <NumberInput
                          label={`Width (${unit})`}
                          value={selectedRoom.w / units[unit]}
                          onChange={(v) => {
                            try {
                              updateFloor(
                                resizeRoom(
                                  floor,
                                  selectedRoom.id,
                                  v * units[unit],
                                  selectedRoom.h,
                                  r,
                                ),
                                'Resized room',
                              );
                            } catch (e) {
                              setNotice((e as Error).message);
                            }
                          }}
                        />
                        <NumberInput
                          label={`Length (${unit})`}
                          value={selectedRoom.h / units[unit]}
                          onChange={(v) => {
                            try {
                              updateFloor(
                                resizeRoom(
                                  floor,
                                  selectedRoom.id,
                                  selectedRoom.w,
                                  v * units[unit],
                                  r,
                                ),
                                'Resized room',
                              );
                            } catch (e) {
                              setNotice((e as Error).message);
                            }
                          }}
                        />
                      </div>
                      <p className="helper">
                        Shared walls and adjacent spaces follow dimension changes. Recheck the
                        entire layout.
                      </p>
                    </>
                  ) : selectedWall ? (
                    <>
                      <span className="property-label">WALL SEGMENT</span>
                      <p className="selected-title">
                        {measure(
                          Math.hypot(
                            selectedWall.b.x - selectedWall.a.x,
                            selectedWall.b.y - selectedWall.a.y,
                          ),
                          unit,
                        )}{' '}
                        long
                      </p>
                      <NumberInput
                        label={`Thickness (${unit})`}
                        value={selectedWall.thickness / units[unit]}
                        min={50 / units[unit]}
                        step={0.1}
                        onChange={(v) => {
                          if (v * units[unit] < 50 || v * units[unit] > 500) return;
                          updateFloor(
                            {
                              ...floor,
                              walls: floor.walls.map((w) =>
                                w.id === selectedWall.id ? { ...w, thickness: v * units[unit] } : w,
                              ),
                            },
                            'Changed wall thickness',
                          );
                        }}
                      />
                      <NumberInput
                        label={`Exact segment length (${unit})`}
                        value={
                          Math.hypot(
                            selectedWall.b.x - selectedWall.a.x,
                            selectedWall.b.y - selectedWall.a.y,
                          ) / units[unit]
                        }
                        onChange={(v) => {
                          const horizontal = Math.abs(selectedWall.a.y - selectedWall.b.y) < 1;
                          const w = {
                            ...selectedWall,
                            b: horizontal
                              ? { x: selectedWall.a.x + v * units[unit], y: selectedWall.b.y }
                              : { x: selectedWall.b.x, y: selectedWall.a.y + v * units[unit] },
                          };
                          updateFloor(
                            { ...floor, walls: floor.walls.map((q) => (q.id === w.id ? w : q)) },
                            'Changed wall length',
                          );
                          setNotice(
                            'Wall length changed independently. Check adjacent junctions and room enclosure.',
                          );
                        }}
                      />
                      <p className="helper">
                        Use Move to shift an interior partition and its connected spaces.
                      </p>
                    </>
                  ) : selectedOpening ? (
                    <>
                      <span className="property-label">{selectedOpening.type.toUpperCase()}</span>
                      <NumberInput
                        label={`Width (${unit})`}
                        value={selectedOpening.width / units[unit]}
                        onChange={(v) =>
                          updateFloor(
                            {
                              ...floor,
                              openings: floor.openings.map((o) =>
                                o.id === selectedOpening.id ? { ...o, width: v * units[unit] } : o,
                              ),
                            },
                            'Resized opening',
                          )
                        }
                      />
                      {(['from', 'to'] as const).map((which) => (
                        <label className="field" key={which}>
                          Connected space ({which})
                          <select
                            value={selectedOpening[which]}
                            onChange={(e) =>
                              updateFloor(
                                {
                                  ...floor,
                                  openings: floor.openings.map((o) =>
                                    o.id === selectedOpening.id
                                      ? { ...o, [which]: e.target.value }
                                      : o,
                                  ),
                                },
                                'Assigned opening access',
                              )
                            }
                          >
                            <option value="unassigned">Unassigned</option>
                            <option value="outside">Outside</option>
                            {floor.rooms.map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.name} · {q.apartment || 'shared'}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </>
                  ) : selectedFeature ? (
                    <>
                      <span className="property-label">
                        {selectedFeature.type.toUpperCase()} · CONCEPTUAL
                      </span>
                      <label className="field">
                        Label
                        <input
                          value={selectedFeature.label}
                          onChange={(e) =>
                            updateFloor(
                              {
                                ...floor,
                                features: floor.features.map((v) =>
                                  v.id === selectedFeature.id ? { ...v, label: e.target.value } : v,
                                ),
                              },
                              'Updated feature label',
                            )
                          }
                        />
                      </label>
                      <div className="two-col">
                        {(['w', 'h'] as const).map((a) => (
                          <NumberInput
                            key={a}
                            label={`${a === 'w' ? 'Width' : 'Length'} (${unit})`}
                            value={selectedFeature[a] / units[unit]}
                            onChange={(v) =>
                              updateFloor(
                                {
                                  ...floor,
                                  features: floor.features.map((q) =>
                                    q.id === selectedFeature.id
                                      ? { ...q, [a]: Math.max(50, v * units[unit]) }
                                      : q,
                                  ),
                                },
                                'Resized feature',
                              )
                            }
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="property-stats">
                        <div>
                          <small>Building footprint</small>
                          <b>
                            {((r.width * r.length) / FT ** 2).toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}{' '}
                            <span>sq ft</span>
                          </b>
                        </div>
                        <span className="footprint-icon">
                          <Building2 size={25} />
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Lot dimensions</dt>
                          <dd>
                            {measure(r.lotWidth)} × {measure(r.lotLength)}
                          </dd>
                        </div>
                        <div>
                          <dt>Building dimensions</dt>
                          <dd>
                            {measure(r.width)} × {measure(r.length)}
                          </dd>
                        </div>
                        <div>
                          <dt>Floors / apartments</dt>
                          <dd>
                            {r.floors} floors · {r.apartments} units
                          </dd>
                        </div>
                        <div>
                          <dt>Bedrooms per unit</dt>
                          <dd>{r.bedrooms} bedrooms</dd>
                        </div>
                        <div>
                          <dt>Roof type</dt>
                          <dd>{r.roof} roof</dd>
                        </div>
                      </dl>
                      <button className="text-button" onClick={() => openRequirements()}>
                        Edit requirements <ArrowUpRight size={13} />
                      </button>
                    </>
                  )}
                  {selected && (
                    <button className="btn danger" onClick={removeSelected}>
                      <Trash2 size={14} />
                      Remove object
                    </button>
                  )}
                </div>
                <div className="assistant-heading">
                  <span className="spark-icon">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <b>Architectural assistant</b>
                    <small>Your ideas, precisely considered.</small>
                  </div>
                  <span className="ai-pill">AI</span>
                </div>
                <div className="assistant-content">
                  <div className="assistant-intro">
                    <p>Let’s shape your next idea.</p>
                    <span>
                      Ask for a layout change. Review the proposed geometry before applying it.
                    </span>
                  </div>
                  {!signedIn && (
                    <div className="connection-note">
                      <Cloud size={14} />
                      <span>
                        {cloud() ? 'Sign in to use AI assistance.' : 'AI & cloud setup required.'}{' '}
                        <button onClick={() => setModal('account')}>Connection details</button>
                      </span>
                    </div>
                  )}
                  <div className="suggestions">
                    {[
                      'Make Bedroom 1 larger',
                      'Add a front veranda',
                      'Prepare the drawing package',
                    ].map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          if (t === 'Prepare the drawing package') {
                            setPackageAll(true);
                            setModal('export');
                          } else setPrompt(t);
                        }}
                      >
                        {t}
                        <Plus size={13} />
                      </button>
                    ))}
                  </div>
                  <div className="chat-messages">
                    {messages.map((m, i) => (
                      <div key={i} className={`chat-message ${m.role}`}>
                        {m.text}
                      </div>
                    ))}
                  </div>
                  {proposal && (
                    <div className="proposal">
                      <b>Review proposed change</b>
                      <p>{proposal.text}</p>
                      <Plan project={proposal.project} mini />
                      <div>
                        <button
                          className="btn primary"
                          onClick={() => {
                            change(proposal.project, 'Applied AI proposal');
                            setProposal(null);
                          }}
                        >
                          Apply
                        </button>
                        <button className="btn" onClick={() => setProposal(null)}>
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <form
                  className="assistant-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void assistant();
                  }}
                >
                  <textarea
                    aria-label="Ask the architectural assistant"
                    placeholder="Describe a change to your plan…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={3000}
                  />
                  <div>
                    <span>
                      <Sparkles size={11} />
                      Changes need your review
                    </span>
                    <button aria-label="Send assistant request" disabled={busy || !prompt.trim()}>
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                </form>
                <div className="assistant-disclaimer">
                  <ShieldCheck size={13} />
                  Architectural guidance. Professional review required.
                </div>
              </aside>
            </div>
            <div className="workspace-bottom">
              <span>
                <ShieldCheck size={15} />
                Preliminary design · Not approved or professionally certified
              </span>
              <button onClick={() => setModal('checks')}>
                Review {issues.length} readiness items <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".gyplan,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProject(file);
          e.target.value = '';
        }}
      />
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === 'requirements' || modal === 'checks' ? 'wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={modalTitles[modal]}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">GY SMART HOUSE PLANNER</span>
                <h2>{modalTitles[modal]}</h2>
              </div>
              <button aria-label="Close dialog" onClick={() => setModal(null)}>
                <X size={21} />
              </button>
            </div>
            <div className="modal-body">
              {error && <ErrorBox text={error} />}
              {modal === 'requirements' && (
                <>
                  {drafts.length ? (
                    <>
                      <p className="muted">
                        Compare two constrained arrangements. Both use your confirmed building
                        footprint. Door access and circulation need professional review.
                      </p>
                      <div className="layout-choices">
                        {drafts.map((p, i) => (
                          <button
                            key={i}
                            className={draftChoice === i ? 'chosen' : ''}
                            onClick={() => setDraftChoice(i)}
                          >
                            <Plan project={p} mini />
                            <b>
                              Option {String.fromCharCode(65 + i)} ·{' '}
                              {i ? 'More bedroom space' : 'Balanced living space'}
                            </b>
                            <span>
                              {i === draftChoice ? (
                                <CheckCircle2 size={17} />
                              ) : (
                                <span className="radio" />
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="modal-actions">
                        <button className="btn" onClick={() => setDrafts([])}>
                          Back to measurements
                        </button>
                        <button className="btn primary" onClick={acceptDraft}>
                          Apply selected layout <ArrowRight size={16} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-top">
                        <p className="muted">
                          Confirm measurements against a survey. Values are converted to millimetres
                          internally.
                        </p>
                        <select
                          aria-label="Requirements units"
                          value={unit}
                          onChange={(e) => setUnit(e.target.value as Unit)}
                        >
                          {Object.keys(units).map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-section">
                        <h3>
                          01 <span>Project & property</span>
                        </h3>
                        <div className="two-col">
                          {(['name', 'location', 'owner', 'buildingType'] as const).map((a) => (
                            <label className="field" key={a}>
                              {
                                {
                                  name: 'Project name',
                                  location: 'Full property location',
                                  owner: 'Applicant / owner',
                                  buildingType: 'Building type',
                                }[a]
                              }
                              <input
                                value={form[a]}
                                maxLength={a === 'location' ? 300 : 120}
                                onChange={(e) => setForm((v) => ({ ...v, [a]: e.target.value }))}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="form-section">
                        <h3>
                          02 <span>Dimensions & setbacks ({unit})</span>
                        </h3>
                        <div className="four-col">
                          {(
                            [
                              'lotWidth',
                              'lotLength',
                              'width',
                              'length',
                              'front',
                              'rear',
                              'left',
                              'right',
                            ] as const
                          ).map((a) => (
                            <NumberInput
                              key={a}
                              label={
                                {
                                  lotWidth: 'Lot width',
                                  lotLength: 'Lot length',
                                  width: 'Building width',
                                  length: 'Building length',
                                  front: 'Front setback',
                                  rear: 'Rear setback',
                                  left: 'Left setback',
                                  right: 'Right setback',
                                }[a]
                              }
                              value={form[a] / units[unit]}
                              step={0.25}
                              onChange={(v) => setForm((f) => ({ ...f, [a]: mm(v, unit) }))}
                            />
                          ))}
                        </div>
                        {generationIssues(form).map((i) => (
                          <div className={`inline-issue ${i.severity}`} key={i.id}>
                            <AlertTriangle size={15} />
                            <span>
                              <b>{i.title}</b>
                              {i.detail}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="form-section">
                        <h3>
                          03 <span>Building programme</span>
                        </h3>
                        <div className="four-col">
                          {(
                            [
                              'floors',
                              'apartments',
                              'bedrooms',
                              'bathrooms',
                              'parking',
                              'futureFloors',
                            ] as const
                          ).map((a) => (
                            <NumberInput
                              key={a}
                              label={
                                {
                                  floors: 'Floors',
                                  apartments: 'Total apartments',
                                  bedrooms: 'Beds per apartment',
                                  bathrooms: 'Baths per apartment',
                                  parking: 'Parking spaces',
                                  futureFloors: 'Future floors',
                                }[a]
                              }
                              value={form[a]}
                              onChange={(v) => setForm((f) => ({ ...f, [a]: v }))}
                            />
                          ))}
                          <label className="field">
                            Roof
                            <select
                              value={form.roof}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  roof: e.target.value as Requirements['roof'],
                                }))
                              }
                            >
                              {['Hip', 'Gable', 'Flat'].map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            Stair position
                            <select
                              value={form.stairs}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  stairs: e.target.value as Requirements['stairs'],
                                }))
                              }
                            >
                              <option>Internal</option>
                              <option>External</option>
                            </select>
                          </label>
                          <NumberInput
                            label={`Wall thickness (${unit})`}
                            value={form.wall / units[unit]}
                            step={0.1}
                            onChange={(v) => setForm((f) => ({ ...f, wall: mm(v, unit) }))}
                          />
                          <NumberInput
                            label={`Storey height (${unit})`}
                            value={form.floorHeight / units[unit]}
                            step={0.1}
                            onChange={(v) => setForm((f) => ({ ...f, floorHeight: mm(v, unit) }))}
                          />
                          <NumberInput
                            label={`Veranda depth (${unit})`}
                            value={form.veranda / units[unit]}
                            step={0.25}
                            onChange={(v) => setForm((f) => ({ ...f, veranda: mm(v, unit) }))}
                          />
                        </div>
                        <label className="field">
                          Kitchen, dining, living, balcony and other requirements
                          <textarea
                            value={form.instructions}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, instructions: e.target.value }))
                            }
                            maxLength={5000}
                          />
                        </label>
                        <p className="helper">
                          Free-text requirements are retained for the designer and assistant. The
                          constrained generator supports rectangular apartments with one or two
                          bedrooms, one bathroom, kitchen and living/dining. Other requests require
                          manual drafting.
                        </p>
                      </div>
                      <div className="modal-actions">
                        <button
                          className="btn"
                          onClick={() => {
                            setForm({
                              ...defaultRequirements,
                              apartments: 8,
                              left: mm(5),
                              right: mm(5),
                            });
                            setError(
                              'Acceptance example loaded. Resolve the setback discrepancy and apartment fit before generating.',
                            );
                          }}
                        >
                          Load 8-apartment reference
                        </button>
                        <button className="btn primary" onClick={preview}>
                          <Sparkles size={16} />
                          Generate layout options
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {modal === 'upload' && (
                <>
                  <p className="muted">
                    Add sketches, survey plans, floor plans or building photographs. AI extracts
                    legible evidence for your confirmation; photographs alone cannot provide exact
                    measurements.
                  </p>
                  <label className="upload-zone">
                    <span>
                      <Upload size={26} />
                    </span>
                    <b>Bring your references together</b>
                    <p>Select JPG, PNG, WEBP or PDF files</p>
                    <small>Up to 4 files per interpretation · 3 MB per file</small>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      multiple
                      onChange={(e) => {
                        try {
                          const list = Array.from(e.target.files || []);
                          if (list.length > 4) throw Error('Choose up to 4 references.');
                          list.forEach(validateUpload);
                          setFiles(list);
                          setError('');
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    />
                  </label>
                  {files.map((f, i) => (
                    <div className="file-row" key={i}>
                      <FileImage size={18} />
                      <span>
                        {f.name}
                        <small>{(f.size / 1024).toFixed(0)} KB</small>
                      </span>
                      <Check size={16} />
                    </div>
                  ))}
                  <div className="modal-actions">
                    <button
                      className="btn"
                      onClick={() => {
                        setError('');
                        setModal('account');
                      }}
                    >
                      <LogIn size={15} />
                      Cloud connection
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy || !files.length}
                      onClick={() => void upload()}
                    >
                      {busy ? 'Working…' : 'Store reference files'}
                      <Upload size={16} />
                    </button>
                  </div>
                  <h3 className="subheading">
                    Stored references <span>{project.references.length}</span>
                  </h3>
                  {!project.references.length && (
                    <p className="helper">
                      No references uploaded. Files are stored privately in your cloud account after
                      sign-in.
                    </p>
                  )}
                  {project.references.map((ref) => (
                    <div className="file-row" key={ref.id}>
                      <FileImage size={17} />
                      <span>
                        {ref.name}
                        <small>Private cloud reference</small>
                      </span>
                      <button
                        title="Preview reference"
                        onClick={async () => {
                          const owner = authOwnerRef.current,
                            currentProject = project.id;
                          const result = await cloud()
                            ?.storage.from('references')
                            .createSignedUrl(ref.path, 120);
                          if (
                            owner !== authOwnerRef.current ||
                            currentProject !== activeProjectRef.current?.id
                          )
                            return;
                          if (result?.data)
                            window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer');
                          else setError('Sign in to preview this cloud reference.');
                        }}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        title="Remove reference from project"
                        onClick={() =>
                          change(
                            {
                              ...project,
                              references: project.references.filter((v) => v.id !== ref.id),
                            },
                            'Removed reference link',
                          )
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {project.references.length > 0 && (
                    <button
                      className="btn primary full"
                      disabled={busy}
                      onClick={() => void interpret()}
                    >
                      <ScanLine size={17} />
                      {busy
                        ? 'Interpreting references…'
                        : 'Convert image to house plan · review evidence'}
                    </button>
                  )}
                  {evidence && (
                    <div className="evidence">
                      <h3>Review extracted evidence</h3>
                      <p className="helper">
                        Select only values you can verify. Contradictory readings are preserved
                        below. Apply one value per field.
                      </p>
                      {evidence.measurements.map((m, i) => (
                        <label className="evidence-row" key={i}>
                          <input
                            type="checkbox"
                            checked={!!evidenceSelections[i]}
                            disabled={m.value === null}
                            onChange={(e) =>
                              setEvidenceSelections((v) => {
                                const next = { ...v };
                                evidence.measurements.forEach((q, j) => {
                                  if (q.field === m.field) next[j] = false;
                                });
                                next[i] = e.target.checked;
                                return next;
                              })
                            }
                          />
                          <span>
                            <b>
                              {m.field}: {m.value ?? 'Unknown'} {m.unit}
                            </b>
                            <small>
                              {m.source} · {m.confidence} confidence · {m.note}
                            </small>
                          </span>
                        </label>
                      ))}
                      {evidence.conflicts.map((v, i) => (
                        <ErrorBox key={i} text={v} />
                      ))}
                      {[
                        ...evidence.observations,
                        ...evidence.missing.map((v) => 'Missing: ' + v),
                      ].map((v, i) => (
                        <p key={i} className="helper">
                          {v}
                        </p>
                      ))}
                      <button className="btn primary" onClick={confirmEvidence}>
                        Review selected measurements <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {modal === 'export' && (
                <>
                  <div className="export-preview">
                    <Plan project={project} view={view} floor={floorIndex} mini />
                    <div>
                      <span className="eyebrow">MEASURED VECTOR OUTPUT</span>
                      <h3>
                        {packageAll && format === 'PDF'
                          ? 'Coordinated drawing package'
                          : scene.title}
                      </h3>
                      <p>{r.name}</p>
                      <span className="draft-pill">Preliminary · for professional review</span>
                    </div>
                  </div>
                  <label className="field">
                    File format
                    <div className="format-options">
                      {['PDF', 'DXF', 'SVG', 'PNG', 'Project'].map((t) => (
                        <button
                          key={t}
                          aria-label={t + ' format'}
                          className={format === t ? 'chosen' : ''}
                          onClick={() => setFormat(t)}
                        >
                          {t}
                          <small>
                            {
                              {
                                PDF: 'Vector sheets',
                                DXF: 'CAD · mm',
                                SVG: 'Vector graphic',
                                PNG: '3200 px',
                                Project: 'Editable native',
                              }[t]
                            }
                          </small>
                        </button>
                      ))}
                    </div>
                  </label>
                  {format === 'PDF' && (
                    <>
                      <label className="field">
                        Sheet size
                        <select
                          value={paper}
                          onChange={(e) => setPaper(e.target.value as typeof paper)}
                        >
                          <option value="A1">A1 landscape · 841 × 594 mm</option>
                          <option value="A2">A2 landscape · 594 × 420 mm</option>
                          <option value="ARCHD">ARCH D · 36 × 24 in</option>
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={packageAll}
                          onChange={(e) => setPackageAll(e.target.checked)}
                        />
                        Entire drawing package ({project.floors.length + sheets.length} sheets)
                      </label>
                      <p className="helper">
                        Floor plans/elevations 1:96; site plan 1:192. Export fails if the sheet is
                        too small. Print at 100% with page scaling disabled.
                      </p>
                    </>
                  )}
                  {format === 'DXF' && (
                    <p className="helper">
                      Exports the current sheet as model-space vector entities in millimetres. Wall
                      outlines, openings, door swings, dimensions and labels remain CAD geometry.
                      Paper-space layouts and parametric dimensions are not included.
                    </p>
                  )}
                  {errors.length > 0 && (
                    <ErrorBox
                      text={`${errors.length} unresolved geometry or measurement errors. Exports remain preliminary; resolve these before professional review.`}
                    />
                  )}
                  <div className="modal-actions">
                    <button className="btn" onClick={() => setModal('checks')}>
                      Review readiness
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void exportFile()}
                    >
                      <Download size={16} />
                      {busy ? 'Preparing export…' : `Download ${format}`}
                    </button>
                  </div>
                </>
              )}
              {modal === 'checks' && (
                <>
                  <div className="readiness-summary">
                    <span>
                      <ShieldCheck size={30} />
                    </span>
                    <div>
                      <h3>
                        {errors.length
                          ? `${errors.length} blocking items need attention`
                          : 'Ready for the next design review'}
                      </h3>
                      <p>
                        {issues.length} checks need review. This check does not certify compliance
                        or approval.
                      </p>
                    </div>
                  </div>
                  <div className="issues-list">
                    {issues.map((i, index) => (
                      <div key={`${i.id}-${index}`} className={`check-item ${i.severity}`}>
                        <AlertTriangle size={17} />
                        <div>
                          <b>{i.title}</b>
                          <p>{i.detail}</p>
                        </div>
                        <span>{i.severity === 'error' ? 'Resolve' : 'Review'}</span>
                      </div>
                    ))}
                  </div>
                  <h3 className="subheading">Authority profile</h3>
                  <p className="helper">
                    CHPA/NDC guidance was reviewed on 23 October 2026. Enter only minimum setbacks
                    confirmed for this property and application. Zero means no configured minimum.
                  </p>
                  <label className="field">
                    Responsible authority
                    <input
                      value={project.authority.name}
                      onChange={(e) =>
                        change(
                          {
                            ...project,
                            authority: {
                              ...project.authority,
                              name: e.target.value,
                              confirmed: false,
                            },
                          },
                          'Updated authority profile',
                        )
                      }
                    />
                  </label>
                  <div className="three-col">
                    {(['minFront', 'minRear', 'minSide'] as const).map((a) => (
                      <NumberInput
                        key={a}
                        label={`${a.replace('min', 'Minimum ')} (${unit})`}
                        value={project.authority[a] / units[unit]}
                        onChange={(v) =>
                          change(
                            {
                              ...project,
                              authority: {
                                ...project.authority,
                                [a]: mm(v, unit),
                                confirmed: false,
                              },
                            },
                            'Updated authority setbacks',
                          )
                        }
                      />
                    ))}
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={project.authority.confirmed}
                      onChange={(e) =>
                        change(
                          {
                            ...project,
                            authority: { ...project.authority, confirmed: e.target.checked },
                          },
                          'Confirmed authority profile',
                        )
                      }
                    />
                    I verified this profile with the responsible authority.
                  </label>
                  <h3 className="subheading">Supporting documents</h3>
                  <div className="document-checks">
                    {['survey', 'ownership', 'identification', 'tin', 'rates'].map((d) => (
                      <label className="checkbox-label" key={d}>
                        <input
                          type="checkbox"
                          checked={!!project.documents[d]}
                          onChange={(e) =>
                            change(
                              {
                                ...project,
                                documents: { ...project.documents, [d]: e.target.checked },
                              },
                              `Updated ${d} document checklist`,
                            )
                          }
                        />
                        {
                          {
                            survey: 'Survey plan with dimensions & orientation',
                            ownership: 'Certified ownership / permission',
                            identification: 'Applicant identification',
                            tin: 'TIN certificate',
                            rates: 'Rates and taxes evidence',
                          }[d]
                        }
                      </label>
                    ))}
                  </div>
                  <div className="official-links">
                    <a href="https://chpa.gov.gy/single-window/" target="_blank" rel="noreferrer">
                      CHPA Single Window <ArrowUpRight size={14} />
                    </a>
                    <a href="https://chpa.gov.gy/ndc-corner/" target="_blank" rel="noreferrer">
                      NDC guidance <ArrowUpRight size={14} />
                    </a>
                  </div>
                </>
              )}
              {modal === 'account' && (
                <>
                  <AccountPanel
                    auth={auth}
                    onProjects={openCloudProjects}
                    onImport={() => openProjectImport()}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      setFormat('Project');
                      setModal('export');
                    }}
                  >
                    <Download size={15} />
                    Download a native project backup
                  </button>
                </>
              )}
              {modal === 'project-import' && (
                <ProjectImport
                  key={importId || 'all'}
                  projects={workspace.deviceProjects}
                  initialId={importId}
                  busy={workspace.saving}
                  onImport={workspace.copyToAccount}
                />
              )}
              {modal === 'history' && (
                <>
                  <CloudHistory
                    project={project}
                    owner={auth.user?.id || null}
                    onPreview={(restored, snapshotDate) => {
                      setProposal({
                        project: restored,
                        text: `Restore the snapshot from ${date(snapshotDate)}. Review before applying; the current draft is saved on this device.`,
                      });
                      setModal(null);
                      setScreen('workspace');
                    }}
                  />
                  <h3 className="subheading">Local edit log</h3>
                  <p className="helper">
                    Cloud snapshots are restorable above. Undo keeps the last 40 edits in this
                    session.
                  </p>
                  {[...project.revisions].reverse().map((rev, i) => (
                    <div className="revision-row" key={i}>
                      <span className="revision-dot" />
                      <div>
                        <b>{rev.note}</b>
                        <small>{date(rev.date)}</small>
                      </div>
                      <span>R{project.revisions.length - i}</span>
                    </div>
                  ))}
                  {!project.revisions.length && (
                    <p className="muted">Your next drawing edit will appear here.</p>
                  )}
                  <h3 className="subheading">Download history</h3>
                  {[...project.downloads].reverse().map((v, i) => (
                    <div className="revision-row" key={i}>
                      <Download size={15} />
                      <div>
                        <b>{v.format} export</b>
                        <small>{date(v.date)}</small>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
