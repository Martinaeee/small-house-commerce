export const POST_NAME_MAX = 120;

export function isFacebookPostUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
}

export function postDateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function postDateFromDb(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function autoPostName(postDate: string, productName: string, code: string): string {
  const prefix = `${postDate.slice(5)}｜`;
  const suffix = `｜帖子 ${code.slice(-6)}`;
  const room = Math.max(1, POST_NAME_MAX - prefix.length - suffix.length);
  return `${prefix}${productName.slice(0, room)}${suffix}`.slice(0, POST_NAME_MAX);
}
