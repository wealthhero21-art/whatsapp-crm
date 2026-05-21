// Pops up over the composer. Triggered when the agent types "/" at the
// start of a draft. Filter by what they type, ↑/↓ to pick, Enter inserts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Props {
  query: string;                      // text after the leading "/"
  onPick: (body: string) => void;
  onDismiss: () => void;
}

export function SnippetPicker({ query, onPick, onDismiss }: Props) {
  const { data: all = [] } = useQuery({
    queryKey: ['snippets'],
    queryFn: api.listSnippets,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all
      .filter((s) =>
        s.slug.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [all, query]);

  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [query]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { setIdx((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setIdx((i) => Math.max(i - 1, 0)); e.preventDefault(); }
      else if (e.key === 'Enter' && filtered[idx]) { onPick(filtered[idx].body); e.preventDefault(); }
      else if (e.key === 'Escape') { onDismiss(); e.preventDefault(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, idx, onPick, onDismiss]);

  if (filtered.length === 0) return null;

  return (
    <div className="snippet-pop" ref={listRef}>
      <div className="snippet-pop-head muted">Quick replies — ↑/↓, Enter to insert</div>
      {filtered.map((s, i) => (
        <div
          key={s.id}
          className={`snippet-row ${i === idx ? 'active' : ''}`}
          onMouseEnter={() => setIdx(i)}
          onMouseDown={(e) => { e.preventDefault(); onPick(s.body); }}
        >
          <div className="snippet-row-head">
            <code>/{s.slug}</code>
            <span className="muted">{s.label}</span>
            {s.user_id === null && <span className="pill pill-team">team</span>}
          </div>
          <div className="snippet-body">{s.body.slice(0, 140)}{s.body.length > 140 ? '…' : ''}</div>
        </div>
      ))}
    </div>
  );
}
