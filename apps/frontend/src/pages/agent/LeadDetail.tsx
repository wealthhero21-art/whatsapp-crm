import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { LeadDocSlot, LeadStatus } from '@crm/shared';

const STATUSES: LeadStatus[] = ['new','contacted','qualified','docs_pending','docs_received','submitted','approved','rejected','dropped'];

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const leadQ = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.getLead(id!),
    enabled: !!id,
  });
  const slotsQ = useQuery({
    queryKey: ['lead-docs', id],
    queryFn: () => api.listLeadDocs(id!),
    enabled: !!id,
  });

  const setStatus = useMutation({
    mutationFn: (status: LeadStatus) => api.patchLead(id!, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  if (!id) return <div>Bad URL</div>;
  if (leadQ.isLoading) return <div>Loading…</div>;
  if (!leadQ.data) return <div>Lead not found</div>;

  const lead = leadQ.data;
  const slots = slotsQ.data ?? [];
  const requiredSlots = slots.filter((s) => !s.optional);
  const completed = requiredSlots.filter((s) => s.status === 'verified').length;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <button className="link" onClick={() => navigate(-1)}>← Back</button>
          <h1 style={{ margin: '4px 0' }}>{lead.contact_name ?? lead.contact_phone}</h1>
          <div className="muted">
            {lead.contact_phone} · {lead.source_name ?? 'no source'} · {lead.product ?? 'no product'}
          </div>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="muted">Status</span>
          <select
            value={lead.status}
            onChange={(e) => setStatus.mutate(e.target.value as LeadStatus)}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => navigate(`/agent/inbox?contact=${lead.contact_id}`)}>
            Open chat →
          </button>
        </div>
      </header>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Documents</h3>
          <span className="muted">{completed} of {requiredSlots.length} verified</span>
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${requiredSlots.length ? (completed / requiredSlots.length) * 100 : 0}%` }} />
        </div>
      </div>

      {slots.length === 0 && (
        <div className="card empty">
          No document checklist configured for this source yet. Ask an admin to add doc requirements.
        </div>
      )}

      {slots.map((slot) => (
        <SlotCard key={slot.id} slot={slot} contactId={lead.contact_id} leadId={id} />
      ))}
    </section>
  );
}

function SlotCard({
  slot, contactId, leadId,
}: { slot: LeadDocSlot; contactId: string; leadId: string }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['lead-docs', leadId] });
    qc.invalidateQueries({ queryKey: ['lead', leadId] });
    qc.invalidateQueries({ queryKey: ['files', contactId] });
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { id: fileId } = await api.uploadFile(contactId, file);
      await api.attachToSlot(slot.id, fileId);
      invalidate();
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className={`card slot slot-${slot.status}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ margin: 0 }}>
            {slot.label ?? slot.doc_category.replace(/_/g, ' ')}
            {slot.optional && <span className="muted"> · optional</span>}
          </h4>
          {slot.description && <div className="muted">{slot.description}</div>}
          <div className="muted" style={{ marginTop: 4 }}>
            {slot.files?.length ?? 0} of {slot.required_count} file{slot.required_count > 1 ? 's' : ''} attached
          </div>
        </div>
        <span className={`pill pill-${slot.status}`}>{slot.status}</span>
      </div>

      {slot.status === 'rejected' && slot.rejection_reason && (
        <div className="callout">Rejected: {slot.rejection_reason}</div>
      )}

      {slot.files && slot.files.length > 0 && (
        <ul className="file-list">
          {slot.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/files/${f.id}/download`} target="_blank" rel="noreferrer">
                📎 {f.filename ?? f.mime_type}
              </a>
              <span className="muted"> · {f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <input ref={fileInput} type="file" onChange={onUpload} disabled={busy} />
        {slot.status === 'received' && (
          <>
            <button onClick={async () => { await api.verifySlot(slot.id); invalidate(); }}>
              Verify
            </button>
            <button className="danger" onClick={() => setRejecting(!rejecting)}>
              Reject
            </button>
          </>
        )}
        {slot.status === 'verified' && (
          <button className="link" onClick={async () => { await api.rejectSlot(slot.id, 'Re-verification needed'); invalidate(); }}>
            Mark for re-review
          </button>
        )}
      </div>

      {rejecting && (
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          await api.rejectSlot(slot.id, reason);
          setRejecting(false); setReason('');
          invalidate();
        }}>
          <input placeholder="Reason (shown to agent + customer)" value={reason}
            onChange={(e) => setReason(e.target.value)} required minLength={3} />
          <button type="submit">Confirm reject</button>
          <button type="button" className="link" onClick={() => setRejecting(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}
