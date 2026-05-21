// Internal event bus. Anywhere in the codebase that mutates a domain
// object (lead, message, file) calls emit(); subscribers handle it
// out-of-band so call sites stay clean.
//
// Subscribers can be:
//   - in-process listeners (e.g. SSE broadcast)
//   - the outbound webhook dispatcher (queues delivery jobs)
//   - adapters under src/integrations/* (one-shot push to an external system)

import type { CrmEvent, EventType } from '@crm/shared';

type Handler = (event: CrmEvent) => void | Promise<void>;

const handlers = new Map<EventType | '*', Set<Handler>>();

export function on(eventType: EventType | '*', handler: Handler) {
  let set = handlers.get(eventType);
  if (!set) {
    set = new Set();
    handlers.set(eventType, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function emit<T>(type: EventType, payload: T): void {
  const event: CrmEvent<T> = {
    type,
    occurred_at: new Date().toISOString(),
    payload,
  };
  const specific = handlers.get(type) ?? new Set();
  const wildcard = handlers.get('*') ?? new Set();
  for (const h of [...specific, ...wildcard]) {
    // Fire and forget; never let one handler block the caller or take down the others.
    Promise.resolve()
      .then(() => h(event))
      .catch((err) => console.error(`[bus] handler for ${type} failed:`, err));
  }
}
