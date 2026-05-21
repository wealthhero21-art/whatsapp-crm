-- 0004 — Quick-reply snippets + per-conversation internal notes.

-- ---------------------------------------------------------------------------
-- quick_replies: a library of canned snippets the composer can insert.
-- user_id NULL  → team-wide (admin can publish; any agent sees them)
-- user_id NOT NULL → personal to that agent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quick_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,                  -- short keyword to type after `/`
  label       TEXT NOT NULL,                  -- shown in the picker
  body        TEXT NOT NULL,                  -- the actual text to insert
  language    TEXT NOT NULL DEFAULT 'en',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_user_slug_uniq
  ON quick_replies(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
CREATE INDEX IF NOT EXISTS quick_replies_user_idx ON quick_replies(user_id);

DROP TRIGGER IF EXISTS quick_replies_touch_updated_at ON quick_replies;
CREATE TRIGGER quick_replies_touch_updated_at
  BEFORE UPDATE ON quick_replies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_notes: agent-only context written on a contact.
-- NEVER sent to the customer. Visible to any user who can see the contact.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL CHECK (length(body) > 0),
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_notes_contact_idx
  ON conversation_notes(contact_id, created_at DESC);

DROP TRIGGER IF EXISTS conversation_notes_touch_updated_at ON conversation_notes;
CREATE TRIGGER conversation_notes_touch_updated_at
  BEFORE UPDATE ON conversation_notes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
