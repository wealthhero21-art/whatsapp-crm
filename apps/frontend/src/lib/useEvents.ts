import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken } from './api';

interface CrmEvent {
  type: string;
  contactId?: string;
  messageId?: string;
  waMessageId?: string;
  fileId?: string;
  status?: string;
}

export function useEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (e) => {
      let event: CrmEvent;
      try { event = JSON.parse(e.data); } catch { return; }
      if (event.type === 'message.new' && event.contactId) {
        qc.invalidateQueries({ queryKey: ['messages', event.contactId] });
        qc.invalidateQueries({ queryKey: ['contacts'] });
      }
      if (event.type === 'message.status') {
        qc.invalidateQueries({ queryKey: ['messages'] });
      }
      if (event.type === 'file.downloaded' && event.contactId) {
        qc.invalidateQueries({ queryKey: ['files', event.contactId] });
        qc.invalidateQueries({ queryKey: ['messages', event.contactId] });
      }
      if (event.type.startsWith('lead.')) {
        qc.invalidateQueries({ queryKey: ['leads'] });
      }
    };
    return () => es.close();
  }, [qc]);
}
