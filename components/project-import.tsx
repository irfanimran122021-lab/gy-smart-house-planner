'use client';
import { useState } from 'react';
import type { Project } from '../lib/model';
export function ProjectImport({
  projects,
  initialId,
  busy,
  onImport,
}: {
  projects: Project[];
  initialId?: string;
  busy: boolean;
  onImport: (projects: Project[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(new Set(initialId ? [initialId] : [])),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  return (
    <>
      <p className="muted">
        Choose device projects to copy into your signed-in account. Each receives a new cloud ID.
        Existing device and cloud projects are kept. Reference files from another account stay with
        the original and are not transferred.
      </p>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {done && (
        <div role="status" className="auth-success">
          Cloud copies saved. The original device projects are unchanged.
        </div>
      )}
      {projects.map((p) => (
        <label className="evidence-row" key={p.id}>
          <input
            type="checkbox"
            disabled={busy}
            checked={selected.has(p.id)}
            onChange={(e) =>
              setSelected((current) => {
                const next = new Set(current);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                return next;
              })
            }
          />
          <span>
            <b>{p.requirements.name}</b>
            <small>
              {p.requirements.location || 'Location to confirm'} ·{' '}
              {new Date(p.updatedAt).toLocaleString()}
            </small>
          </span>
        </label>
      ))}
      {!projects.length && <p className="helper">There are no device projects to copy.</p>}
      <div className="modal-actions">
        <span className="helper">This confirmation creates separate cloud copies.</span>
        <button
          className="btn primary"
          disabled={busy || !selected.size}
          onClick={async () => {
            setError('');
            setDone(false);
            try {
              await onImport(projects.filter((p) => selected.has(p.id)));
              setSelected(new Set());
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {busy
            ? 'Copying…'
            : `Copy ${selected.size} selected ${selected.size === 1 ? 'project' : 'projects'} to account`}
        </button>
      </div>
    </>
  );
}
