export function initials(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').trim();
  if (!n) return fallback.slice(-2);
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yest = new Date(today.getTime() - 86400000);
  if (
    d.getDate() === yest.getDate() &&
    d.getMonth() === yest.getMonth() &&
    d.getFullYear() === yest.getFullYear()
  ) {
    return 'yesterday';
  }
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export function formatBytes(b: number | null | undefined): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  if (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  ) return 'TODAY';
  if (
    d.getDate() === yest.getDate() &&
    d.getMonth() === yest.getMonth() &&
    d.getFullYear() === yest.getFullYear()
  ) return 'YESTERDAY';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function withinSessionWindow(lastInbound: string | null): boolean {
  if (!lastInbound) return false;
  return Date.now() - new Date(lastInbound).getTime() < 24 * 3600 * 1000;
}

export function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🔊';
  if (mime === 'application/pdf') return '📄';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📎';
}

export const DOC_CATEGORIES = [
  { value: 'unknown',     label: 'Unclassified' },
  { value: 'pan',         label: 'PAN' },
  { value: 'aadhaar',     label: 'Aadhaar' },
  { value: 'salary_slip', label: 'Salary Slip' },
  { value: 'bank_stmt',   label: 'Bank Statement' },
  { value: 'itr',         label: 'ITR' },
  { value: 'cheque',      label: 'Cancelled Cheque' },
  { value: 'photo',       label: 'Photo' },
  { value: 'other',       label: 'Other' },
];
