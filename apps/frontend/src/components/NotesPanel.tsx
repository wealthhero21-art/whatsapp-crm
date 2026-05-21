// Agent-only notes against a contact. Notes are never sent to the customer.
// Pinned notes float to the top. Authors and admins can edit/delete.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Props { contactId: string }

export function NotesPanel({ contactId }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', contactId],
    queryFn: () => api.listNotes(contactId),
  });
  const [draft, setDraft] = useState('');

  const add = useMutation({
    mutationFn: (body: string) => api.addNote(contactId, body),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['notes', contactId] });
    },
  });
  const togglePin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.updateNote(id, { pinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', contactId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', contactId] }),
  });

  return (
    <section className="notes-panel">
      <h4 className="notes-head">Internal notes</h4>
      <p className="muted notes-sub">Visible to your team only. Not sent to the customer.</p>
      <form
        className="notes-compose"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) add.mutate(draft.trim()); }}
      >
        <textarea
          rows={2}
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim() || add.isPending}>Add</button>
      </form>
      <ul className="notes-list">
        {notes.map((n) => {
          const canEdit = user?.role === 'admin' || n.author_user_id === user?.id;
          return (
            <li key={n.id} className={`note ${n.pinned ? 'pinned' : ''}`}>
              <div className="note-meta">
                <strong>{n.author_name ?? 'system'}</strong>
                <span className="muted"> · {new Date(n.created_at).toLocaleString()}</span>
                {n.pinned && <span className="pill pill-team">pinned</span>}
              </div>
              <div className="note-body">{n.body}</div>
              {canEdit && (
                <div className="note-actions">
                  <button className="link" onClick={() => togglePin.mutate({ id: n.id, pinned: !n.pinned })}>
                    {n.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button className="link danger" onClick={() => remove.mutate(n.id)}>Delete</button>
                </div>
              )}
            </li>
          );
        })}
        {notes.length === 0 && <li className="muted">No notes yet.</li>}
      </ul>
    </section>
  );
}
