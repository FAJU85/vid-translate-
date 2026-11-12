/** Accepts http(s) links to public hostnames only. */
export function parseVideoUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
