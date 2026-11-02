import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Short links exist only so an operator can trim a storefront URL before pasting
 * it into an ad. There is deliberately no list, no click tracking and no custom
 * code: the row maps a hashed target to a random code and nothing more.
 */
const PUBLIC_ORIGIN = 'https://luwag.shop';
const ALLOWED_HOSTS = new Set(['luwag.shop', 'www.luwag.shop']);
/** Internal surfaces must never be reachable through a public short link. */
const BLOCKED_PATHS = ['/admin', '/api', '/preview', '/s'];
const MAX_TARGET_LENGTH = 1024;
const CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;
const CODE_ATTEMPTS = 3;

export interface ShortLinkResult {
  code: string;
  path: string;
  target: string;
}

@Injectable()
export class ShortLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async createLink(url: string): Promise<ShortLinkResult> {
    const target = normalizeTarget(url);
    const targetHash = createHash('sha256').update(target).digest('hex');

    const existing = await this.prisma.shortLink.findUnique({ where: { targetHash } });
    if (existing) return present(existing);

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = randomBytes(6).toString('base64url');
      try {
        const created = await this.prisma.shortLink.create({
          data: { code, target, targetHash },
        });
        return present(created);
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        // A concurrent request may have inserted the same target first; its row
        // is the one both requests should share. Otherwise the code collided and
        // the next attempt draws a new one.
        const raced = await this.prisma.shortLink.findUnique({ where: { targetHash } });
        if (raced) return present(raced);
      }
    }

    throw new ServiceUnavailableException('Could not allocate a short link code.');
  }

  async resolve(code: string): Promise<{ target: string } | null> {
    if (!CODE_PATTERN.test(code)) return null;
    const row = await this.prisma.shortLink.findUnique({ where: { code } });
    return row ? { target: row.target } : null;
  }
}

function present(row: { code: string; target: string }): ShortLinkResult {
  return { code: row.code, path: `/s/${row.code}`, target: row.target };
}

/**
 * Accepts an absolute luwag.shop URL or a root-relative path, and returns the
 * stored `path + query`. Host checks run after parsing so tricks like
 * `//evil.com` and `/\evil.com` cannot slip through as "relative" paths.
 */
export function normalizeTarget(raw: string): string {
  const input = raw.trim();
  if (!input) throw invalidLink();

  let parsed: URL;
  if (/^https?:\/\//i.test(input)) {
    try {
      parsed = new URL(input);
    } catch {
      throw invalidLink();
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) throw invalidLink();
  } else if (input.startsWith('/') && !input.startsWith('//')) {
    try {
      parsed = new URL(input, PUBLIC_ORIGIN);
    } catch {
      throw invalidLink();
    }
  } else {
    throw invalidLink();
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    throw invalidLink();
  }

  const target = `${parsed.pathname}${parsed.search}`;
  if (target.length > MAX_TARGET_LENGTH) throw invalidLink();
  if (BLOCKED_PATHS.some((path) => target === path || target.startsWith(`${path}/`))) {
    throw invalidLink();
  }
  return target;
}

function invalidLink(): BadRequestException {
  return new BadRequestException(
    'Only luwag.shop storefront links can be shortened.',
  );
}
