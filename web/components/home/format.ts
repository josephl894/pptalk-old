/**
 * Tiny formatting helpers for home-page rows. Kept framework-agnostic so they
 * can run on the server (rendering the initial list) or the client (live
 * updates, if those ever land).
 */

export function formatSourceKind(kind: 'pptx' | 'pdf'): string {
  return kind === 'pptx' ? 'pptx' : 'pdf';
}

const MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * Linear-style relative timestamps:
 *   - <60s        → "just now"
 *   - <60m        → "Nm ago"
 *   - <24h        → "Nh ago"
 *   - 1 day       → "yesterday"
 *   - <7 days     → "Nd ago"
 *   - older       → "Apr 28"
 */
export function formatRelativeTime(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  if (Number.isNaN(t)) return '';
  const now = Date.now();
  const diff = now - t;

  if (diff < MS.minute) return 'just now';
  if (diff < MS.hour) {
    const m = Math.floor(diff / MS.minute);
    return `${m}m ago`;
  }
  if (diff < MS.day) {
    const h = Math.floor(diff / MS.hour);
    return `${h}h ago`;
  }
  if (diff < MS.day * 2) return 'yesterday';
  if (diff < MS.day * 7) {
    const d = Math.floor(diff / MS.day);
    return `${d}d ago`;
  }
  // Older — month + day, no year (Linear doesn't show year for current-year
  // dates either; for cross-year we still keep it terse).
  const d = new Date(t);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
