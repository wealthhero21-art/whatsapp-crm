import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Contact } from '../lib/api';
import { initials, formatTime } from '../lib/format';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ContactList({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => api.listContacts(search || undefined),
    refetchInterval: 15_000,
  });

  return (
    <aside className="contacts">
      <div className="brand">
        <div>
          <div className="brand-mark">Inbox</div>
          <div className="brand-sub">DSA · WhatsApp</div>
        </div>
      </div>
      <div className="search-wrap">
        <input
          className="search"
          placeholder="Search name, phone, or lead ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="contact-list">
        {contacts.map((c: Contact) => {
          const name = c.display_name || c.profile_name || c.phone_e164;
          const lastTs = c.last_inbound_at || c.last_outbound_at;
          return (
            <div
              key={c.id}
              className={`contact${selectedId === c.id ? ' active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="avatar">{initials(name, c.wa_id)}</div>
              <div className="contact-meta">
                <div className="contact-name">{name}</div>
                <div className="contact-sub">
                  {c.external_lead_id ? `🔗 ${c.external_lead_id}` : c.phone_e164}
                </div>
              </div>
              <div className="contact-right">
                <div>{formatTime(lastTs)}</div>
                {c.unread_count > 0 && <span className="unread">{c.unread_count}</span>}
              </div>
            </div>
          );
        })}
        {contacts.length === 0 && (
          <div className="empty" style={{ padding: 40 }}>No contacts yet</div>
        )}
      </div>
    </aside>
  );
}
