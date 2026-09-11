import { Prisma } from '../../generated/prisma/client.js';
import {
  TRGM_MATCH_THRESHOLD,
  MAX_SEARCH_TOKENS,
  buildTrgmSearch,
  tokenizeSearch,
} from './product-search.js';

/** Flattens nested Prisma.Sql value arrays for assertion. */
function flatValues(sql: Prisma.Sql): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object' && 'sql' in value) {
      walk((value as Prisma.Sql).values);
    } else {
      out.push(value);
    }
  };
  walk(sql.values);
  return out;
}

describe('tokenizeSearch', () => {
  it('splits on whitespace, trims and drops empties', () => {
    expect(tokenizeSearch('  dining   chair ')).toEqual(['dining', 'chair']);
  });

  it(`caps at ${MAX_SEARCH_TOKENS} tokens and truncates each to 64 chars`, () => {
    expect(tokenizeSearch('a b c d e f g')).toHaveLength(6);
    const long = 'x'.repeat(80);
    expect(tokenizeSearch(long)[0]).toHaveLength(64);
  });
});

describe('buildTrgmSearch', () => {
  it('ANDs one parenthesized group per token', () => {
    const result = buildTrgmSearch(['dining', 'chair']);
    const ands = result.match.sql.match(/ AND /g) ?? [];
    expect(ands).toHaveLength(1);
    expect(result.match.sql).toContain('word_similarity');
  });

  it('uses trgm branches on 3+ char tokens and binds every token as a parameter', () => {
    const result = buildTrgmSearch(['chair']);
    expect(result.match.sql).toContain('word_similarity');
    expect(result.match.sql).toContain('ILIKE');
    // Prisma parameterizes: neither user input nor the threshold is inlined.
    expect(result.match.sql).not.toContain('chair');
    expect(flatValues(result.match)).toContain('chair');
    expect(flatValues(result.match)).toContain('%chair%');
    expect(flatValues(result.match)).toContain(TRGM_MATCH_THRESHOLD);
  });

  it('skips trigram branches for tokens shorter than 3 chars', () => {
    const result = buildTrgmSearch(['tb']);
    expect(result.match.sql).not.toContain('word_similarity');
    expect(result.match.sql).toContain('ILIKE');
    expect(flatValues(result.match)).toContain('%tb%');
  });

  it('ranks by the weakest token (LEAST of per-token GREATEST scores)', () => {
    const result = buildTrgmSearch(['dining', 'chair']);
    expect(result.rank.sql).toContain('LEAST');
    expect(result.rank.sql).toContain('GREATEST');
    const commas = result.rank.sql.match(/,/g) ?? [];
    expect(commas.length).toBeGreaterThan(0);
  });
});
