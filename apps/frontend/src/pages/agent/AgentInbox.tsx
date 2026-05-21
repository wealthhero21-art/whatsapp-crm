import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ContactList } from '../../components/ContactList';
import { ChatPane } from '../../components/ChatPane';
import { FilesPanel } from '../../components/FilesPanel';

export function AgentInbox() {
  const [search] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const c = search.get('contact');
    if (c) setSelectedId(c);
  }, [search]);

  return (
    <div className="inbox">
      <ContactList selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId ? (
        <ChatPane contactId={selectedId} />
      ) : (
        <main className="chat empty">Select a conversation</main>
      )}
      {selectedId && <FilesPanel contactId={selectedId} />}
    </div>
  );
}
