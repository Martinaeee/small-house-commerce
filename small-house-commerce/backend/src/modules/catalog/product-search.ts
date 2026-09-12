import { Prisma } from '../../generated/prisma/client.js';

/**
 * Typo-tolerant product search on the bundled pg_trgm extension
 * (spec §3.3). word_similarity scores a token against the best matching
 * word inside a column, so "chari" matches the word "chair" inside
 * "Dining Chair". ILIKE branches keep exact/prefix matches working and
 * cover tokens shorter than 3 characters (trigrams are unstable there).
 */

export const TRGM_MATCH_THRESHOLD = 0.25;
export const MAX_SEARCH_TOKENS = 6;
const MAX_TOKEN_LENGTH = 64;

export function tokenizeSearch(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((token) => token.trim().slice(0, MAX_TOKEN_LENGTH))
    .filter((token) => token.length > 0)
    .slice(0, MAX_SEARCH_TOKENS);
}

/** Escapes LIKE meta-characters; callers append `ESCAPE '\'` to the predicate. */
function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, '\\$&');
}

function likePattern(token: string): string {
  return `%${escapeLike(token)}%`;
}

/** Boolean group: this single token matches via trgm OR substring. */
function tokenCondition(token: string): Prisma.Sql {
  const pattern = likePattern(token);
  if (token.length < 3) {
    return Prisma.sql`(
      products.name ILIKE ${pattern} ESCAPE '\\'
      OR products.slug ILIKE ${pattern} ESCAPE '\\'
    )`;
  }
  return Prisma.sql`(
    word_similarity(${token}, products.name) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR word_similarity(${token}, products.slug) >= ${TRGM_MATCH_THRESHOLD}::double precision
    OR products.name ILIKE ${pattern} ESCAPE '\\'
    OR products.slug ILIKE ${pattern} ESCAPE '\\'
  )`;
}

/** Per-token relevance: best name/slug similarity, with an exact-prefix boost. */
function tokenScore(token: string): Prisma.Sql {
  const pattern = likePattern(token);
  const exact = Prisma.sql`CASE
      WHEN products.name ILIKE ${pattern} ESCAPE '\\'
        OR products.slug ILIKE ${pattern} ESCAPE '\\'
      THEN 0.9 ELSE 0 END`;
  if (token.length < 3) {
    return exact;
  }
  return Prisma.sql`GREATEST(
    word_similarity(${token}, products.name),
    word_similarity(${token}, products.slug),
    ${exact}
  )`;
}

export interface TrgmSearchSql {
  /** True iff the row matches every token. */
  match: Prisma.Sql;
  /** 0..1 score; the weakest token decides (all tokens must be relevant). */
  rank: Prisma.Sql;
}

export function buildTrgmSearch(tokens: string[]): TrgmSearchSql {
  if (tokens.length === 0) {
    throw new Error('buildTrgmSearch requires at least one token');
  }
  const conditions = tokens.map(tokenCondition);
  const scores = tokens.map(tokenScore);
  return {
    match: Prisma.join(conditions, ' AND '),
    rank: Prisma.sql`LEAST(${Prisma.join(scores, ', ')})`,
  };
}
