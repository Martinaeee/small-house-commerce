// Existing uploads were served immutable for a year; a versioned playback
// URL bypasses those original-file caches after the one-off transcode.
export function videoPlaybackUrl(src: string): string {
  if (!src.startsWith('/uploads/') || !/\.mp4(?:[?#]|$)/i.test(src)) return src;
  const [url, hash] = src.split('#', 2);
  if (/[?&]video=stream-v1(?:&|$)/.test(url)) return src;
  return `${url}${url.includes('?') ? '&' : '?'}video=stream-v1${hash === undefined ? '' : `#${hash}`}`;
}
