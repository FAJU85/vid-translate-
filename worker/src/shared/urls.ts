/**
 * YouTube refuses downloads from the backend's servers (they are datacenter addresses), so
 * YouTube links are not supported: users are asked to upload the file instead.
 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host);
  } catch {
    return false;
  }
}

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
