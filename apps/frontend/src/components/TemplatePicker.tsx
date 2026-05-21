import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Template } from '../lib/api';

interface Props {
  onClose: () => void;
  onSend: (templateName: string, language: string, params: string[]) => Promise<void>;
}

function bodyText(t: Template): string {
  return t.components.find((c) => c.type === 'BODY')?.text ?? '';
}

function preview(text: string, params: string[]): string {
  let out = text;
  params.forEach((v, i) => {
    out = out.replaceAll(`{{${i + 1}}}`, v || `{{${i + 1}}}`);
  });
  return out;
}

export function TemplatePicker({ onClose, onSend }: Props) {
  const { data: templates = [], refetch, isFetching } = useQuery({
    queryKey: ['templates'],
    queryFn: api.listTemplates,
  });

  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const body = useMemo(() => (selected ? bodyText(selected) : ''), [selected]);

  function pick(t: Template) {
    setSelected(t);
    setParams(new Array(t.variable_count).fill(''));
  }

  async function send() {
    if (!selected) return;
    setSending(true);
    try {
      await onSend(selected.name, selected.language, params);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="template-picker-backdrop" onClick={onClose}>
      <div className="template-picker" onClick={(e) => e.stopPropagation()}>
        <div className="tp-header">
          <h3>{selected ? selected.name : 'Choose a template'}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => api.syncTemplates().then(() => refetch())}>
              {isFetching ? '…' : 'Sync from Meta'}
            </button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {!selected ? (
          <div className="tp-list">
            {templates.map((t) => (
              <div key={t.id} className="tp-item" onClick={() => pick(t)}>
                <div className="tp-name">
                  {t.name}
                  <span className="tp-cat">{t.category ?? 'TEMPLATE'}</span>
                  <span className="tp-cat">{t.language}</span>
                </div>
                <div className="tp-body">{bodyText(t)}</div>
              </div>
            ))}
            {templates.length === 0 && (
              <div className="empty" style={{ padding: 30 }}>
                No templates cached. Click "Sync from Meta" to pull approved templates.
              </div>
            )}
          </div>
        ) : (
          <div className="tp-detail">
            {params.map((v, i) => (
              <div key={i}>
                <label>Variable {`{{${i + 1}}}`}</label>
                <input
                  value={v}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={`Value for {{${i + 1}}}`}
                />
              </div>
            ))}
            <div>
              <label>Preview</label>
              <div className="tp-preview">{preview(body, params)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setSelected(null)}>Back</button>
              <button
                className="btn primary"
                onClick={send}
                disabled={sending || params.some((p) => !p)}
              >
                {sending ? 'Sending…' : 'Send template'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
