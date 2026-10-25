'use client';
import { useEffect, useState } from 'react';
import { cloudRevisions } from '../lib/cloud';
import type { Project } from '../lib/model';
export function CloudHistory({
  project,
  owner,
  onPreview,
}: {
  project: Project;
  owner: string | null;
  onPreview: (p: Project, date: string) => void;
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof cloudRevisions>>>([]),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setOffset(0);
    setRows([]);
  }, [project.id, owner]);
  useEffect(() => {
    let alive = true;
    setError('');
    if (!owner) {
      setRows([]);
      return;
    }
    setBusy(true);
    void cloudRevisions(project.id, offset)
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [project.id, owner, offset]);
  return (
    <>
      <div className="section-heading">
        <h3>Saved cloud revisions</h3>
      </div>
      {!owner && (
        <p className="helper">Sign in and open a cloud project to browse saved snapshots.</p>
      )}
      {busy && (
        <p role="status" className="helper">
          Loading revisions…
        </p>
      )}
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {!busy && owner && !rows.length && !error && (
        <p className="helper">No cloud snapshots for this project yet. Save a cloud copy first.</p>
      )}
      {rows.map((row) => (
        <div className="revision-row" key={row.id}>
          <div>
            <b>{new Date(row.date).toLocaleString('en-GB', { timeZone: 'America/Guyana' })}</b>
            <small>{row.project.requirements.name}</small>
          </div>
          <button className="btn" onClick={() => onPreview(row.project, row.date)}>
            Preview revision
          </button>
        </div>
      ))}
      {owner && (
        <div className="history-pages">
          <button
            className="btn"
            disabled={busy || !offset}
            onClick={() => setOffset((v) => Math.max(0, v - 20))}
          >
            Newer
          </button>
          <button
            className="btn"
            disabled={busy || rows.length < 20}
            onClick={() => setOffset((v) => v + 20)}
          >
            Older
          </button>
        </div>
      )}
      <p className="helper">
        Restoring requires preview and confirmation. A stale cloud version pauses saving and offers
        a separate copy.
      </p>
    </>
  );
}
