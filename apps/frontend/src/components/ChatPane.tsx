import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Message } from '../lib/api';
import {
  initials,
  formatTime,
  formatBytes,
  dayLabel,
  withinSessionWindow,
  mimeIcon,
} from '../lib/format';
import { TemplatePicker } from './TemplatePicker';

interface Props {
  contactId: string;
}

export function ChatPane({ contactId }: Props) {
  const qc = useQueryClient();
  const { data: contact } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => api.getContact(contactId),
  });
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', contactId],
    queryFn: () => api.listMessages(contactId),
  });

  useEffect(() => {
    if (contact && contact.unread_count > 0) {
      api.markRead(contactId).then(() => qc.invalidateQueries({ queryKey: ['contacts'] }));
    }
  }, [contactId, contact?.unread_count, qc]);

  const [draft, setDraft] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const sendMut = useMutation({
    mutationFn: (text: string) => api.sendText(contactId, text),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['messages', contactId] });
    },
  });

  const sendTemplate = useMutation({
    mutationFn: ({
      name,
      language,
      params,
    }: { name: string; language: string; params: string[] }) =>
      api.sendTemplate(contactId, name, language, params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', contactId] }),
  });

  const sessionOpen = withinSessionWindow(contact?.last_inbound_at ?? null);

  const grouped = useMemo(() => groupByDay(messages), [messages]);

  if (!contact) return <main className="chat empty">Loading…</main>;

  const name = contact.display_name || contact.profile_name || contact.phone_e164;

  return (
    <main className="chat">
      <header className="chat-header">
        <div className="avatar">{initials(name, contact.wa_id)}</div>
        <div>
          <div className="title">{name}</div>
          <div className="sub">
            {contact.phone_e164}
            {contact.external_lead_id ? `  ·  ${contact.external_lead_id}` : ''}
          </div>
        </div>
        <div className={`session-pill ${sessionOpen ? 'open' : 'closed'}`}>
          {sessionOpen ? '24-h window open' : '24-h window closed'}
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        {grouped.map((g) => (
          <div key={g.day}>
            <div className="day-divider">{g.day}</div>
            {g.items.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="empty">No messages yet</div>
        )}
      </div>

      <div className="composer">
        {!sessionOpen && (
          <div className="composer-banner">
            More than 24 hours since the customer's last message — freeform messaging is disabled. Use a template.
          </div>
        )}
        <div className="composer-row">
          <textarea
            placeholder={sessionOpen ? 'Type a reply…' : 'Click "Template" to send →'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!sessionOpen}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                e.preventDefault();
                sendMut.mutate(draft.trim());
              }
            }}
          />
          <button className="btn" onClick={() => setShowTemplates(true)}>
            Template
          </button>
          <button
            className="btn primary"
            onClick={() => draft.trim() && sendMut.mutate(draft.trim())}
            disabled={!sessionOpen || !draft.trim() || sendMut.isPending}
          >
            {sendMut.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>

      {showTemplates && (
        <TemplatePicker
          onClose={() => setShowTemplates(false)}
          onSend={async (name, language, params) => {
            await sendTemplate.mutateAsync({ name, language, params });
          }}
        />
      )}
    </main>
  );
}

function groupByDay(messages: Message[]): { day: string; items: Message[] }[] {
  const out: { day: string; items: Message[] }[] = [];
  for (const m of messages) {
    const d = dayLabel(m.created_at);
    const last = out[out.length - 1];
    if (last && last.day === d) last.items.push(m);
    else out.push({ day: d, items: [m] });
  }
  return out;
}

function MessageBubble({ m }: { m: Message }) {
  const isTemplate = m.msg_type === 'template';
  return (
    <div className={`bubble-row ${m.direction}`}>
      <div className={`bubble ${m.direction === 'out' ? 'out' : ''} ${isTemplate ? 'template-tag' : ''}`}>
        {m.file_id && (
          <div className="bubble-attachment">
            <div className="icon">{mimeIcon(m.file_mime || 'application/octet-stream')}</div>
            <div style={{ minWidth: 0 }}>
              <div className="fname">{m.file_name ?? 'attachment'}</div>
              <div className="fmeta">
                {formatBytes(m.file_size)}{' '}
                {m.download_status === 'pending'
                  ? '· downloading…'
                  : m.download_status === 'failed'
                    ? '· failed'
                    : (
                      <a
                        href={`/api/files/${m.file_id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent)' }}
                      >
                        open
                      </a>
                    )}
              </div>
            </div>
          </div>
        )}
        {m.body && <div>{m.body}</div>}
        {isTemplate && (
          <div className="fmeta" style={{ marginTop: 6, fontSize: 11 }}>
            template · {m.template_name}
          </div>
        )}
        <div className="meta">
          <span>{formatTime(m.created_at)}</span>
          {m.direction === 'out' && (
            <span className="status">{m.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}
