// One-tap voice note recorder for the composer.
//   - Press once: starts recording (MediaRecorder, ogg/opus where available)
//   - Press again: stops + uploads + sends
//   - Press × to cancel mid-recording
//
// Falls back to a disabled button if the browser doesn't expose MediaRecorder
// or microphone permission is denied.

import { useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/api';

interface Props {
  contactId: string;
  onSent: () => void;
}

export function VoiceRecorder({ contactId, onSent }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (state !== 'recording') return;
    const i = setInterval(() => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => clearInterval(i);
  }, [state]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('This browser does not support voice recording.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) { setState('idle'); setElapsed(0); return; }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/ogg' });
        await upload(blob);
      };
      rec.start();
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState('recording');
    } catch (err) {
      console.error('mic denied', err);
      alert('Microphone permission denied.');
    }
  }

  function cancel() {
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }

  function stopAndSend() {
    recorderRef.current?.stop();
    setState('uploading');
  }

  async function upload(blob: Blob) {
    const token = getToken();
    const fd = new FormData();
    fd.append('contact_id', contactId);
    fd.append('file', blob, blob.type.includes('webm') ? 'voice.webm' : 'voice.ogg');
    try {
      const res = await fetch('/api/messages/voice', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        alert(`Voice send failed: ${res.status} ${text.slice(0, 120)}`);
      } else {
        onSent();
      }
    } finally {
      setState('idle');
      setElapsed(0);
    }
  }

  if (state === 'idle') {
    return (
      <button type="button" className="btn" title="Record a voice note" onClick={start}>
        🎙
      </button>
    );
  }
  if (state === 'recording') {
    return (
      <span className="voice-recording">
        <button type="button" className="btn danger" onClick={cancel} title="Cancel">×</button>
        <span className="voice-elapsed">● {String(Math.floor(elapsed / 60)).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')}</span>
        <button type="button" className="btn primary" onClick={stopAndSend}>Send</button>
      </span>
    );
  }
  return <span className="muted">Uploading…</span>;
}
