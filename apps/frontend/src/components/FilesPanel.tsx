import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FileRow } from '../lib/api';
import { formatBytes, formatTime, mimeIcon, DOC_CATEGORIES } from '../lib/format';
import { NotesPanel } from './NotesPanel';

interface Props {
  contactId: string;
}

export function FilesPanel({ contactId }: Props) {
  const qc = useQueryClient();
  const { data: contact } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => api.getContact(contactId),
  });
  const { data: files = [] } = useQuery({
    queryKey: ['files', contactId],
    queryFn: () => api.listFiles(contactId),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, doc_category }: { id: string; doc_category: string }) =>
      api.patchFile(id, { doc_category }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', contactId] }),
  });

  const enrich = useMutation({
    mutationFn: () => api.enrichContact(contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contact', contactId] }),
  });

  const grouped = useMemo(() => groupByCategory(files), [files]);

  if (!contact) return <aside className="files-panel" />;

  return (
    <aside className="files-panel">
      <div className="fp-header">
        <div className="fp-title">
          {contact.display_name || contact.profile_name || contact.phone_e164}
        </div>
        <div className="fp-id">
          {contact.phone_e164}
          {contact.external_lead_id ? ` · ${contact.external_lead_id}` : ''}
        </div>
        <div className="fp-tags">
          {(contact.tags ?? []).map((t) => (
            <span key={t} className="fp-tag">{t}</span>
          ))}
          {contact.external_app_id && (
            <span className="fp-tag" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              app: {contact.external_app_id}
            </span>
          )}
        </div>
      </div>

      <CustomerDetails
        enrichment={contact.enrichment ?? {}}
        enrichedAt={contact.enriched_at ?? null}
        onRefresh={() => enrich.mutate()}
        refreshing={enrich.isPending}
      />

      <div className="fp-section">Documents · {files.length}</div>

      <div className="fp-list">
        {grouped.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {DOC_CATEGORIES.find((d) => d.value === cat)?.label ?? cat}
            </div>
            {items.map((f) => (
              <div key={f.id} className="fp-file">
                <div className="icon">{mimeIcon(f.mime_type)}</div>
                <div style={{ minWidth: 0 }}>
                  <a
                    className="name"
                    href={`/api/files/${f.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {f.filename || `file-${f.id.slice(0, 6)}`}
                  </a>
                  <div className="meta">
                    <span>{formatBytes(f.size_bytes)}</span>
                    <span>·</span>
                    <span>{formatTime(f.created_at)}</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <select
                      className="cat-select"
                      value={f.doc_category ?? 'unknown'}
                      onChange={(e) =>
                        updateCategory.mutate({ id: f.id, doc_category: e.target.value })
                      }
                    >
                      {DOC_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {files.length === 0 && (
          <div className="empty" style={{ padding: '30px 0', fontSize: 13 }}>
            No documents shared yet
          </div>
        )}
      </div>
      <NotesPanel contactId={contactId} />
    </aside>
  );
}

function CustomerDetails({
  enrichment, enrichedAt, onRefresh, refreshing,
}: {
  enrichment: Record<string, unknown>;
  enrichedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const entries = Object.entries(enrichment ?? {}).filter(([, v]) => v !== null && v !== '');
  return (
    <>
      <div className="fp-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Customer details</span>
        <button className="link" onClick={onRefresh} disabled={refreshing} style={{ fontSize: 11 }}>
          {refreshing ? 'Fetching…' : '⟳ Refresh'}
        </button>
      </div>
      <div className="fp-enrich">
        {entries.length === 0 ? (
          <div className="empty" style={{ padding: '10px 0', fontSize: 12 }}>
            No external details yet. Configure a customer-lookup integration, or your app can push them.
          </div>
        ) : (
          <table className="enrich-table">
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td className="ek">{k.replace(/_/g, ' ')}</td>
                  <td className="ev">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {enrichedAt && (
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
            updated {formatTime(enrichedAt)}
          </div>
        )}
      </div>
    </>
  );
}

function groupByCategory(files: FileRow[]): Array<[string, FileRow[]]> {
  const order = DOC_CATEGORIES.map((c) => c.value);
  const map = new Map<string, FileRow[]>();
  for (const f of files) {
    const k = f.doc_category ?? 'unknown';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(f);
  }
  return [...map.entries()].sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
  );
}
