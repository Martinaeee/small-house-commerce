import { Prisma } from '../../generated/prisma/client.js';
import {
  CUSTOMER_SCORE,
  ORDER_SCORE,
  PRODUCT_SCORE,
  SHIPMENT_SCORE,
  buildCustomerSearchQuery,
  buildOrderSearchQuery,
  buildProductSearchQuery,
  buildShipmentSearchQuery,
  normalizeSearchTerms,
} from './search.queries.js';

function flatValues(sql: Prisma.Sql): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown): void => {
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

describe('normalizeSearchTerms', () => {
  it('escapes LIKE wildcards as literal characters', () => {
    expect(normalizeSearchTerms('50%_OFF\\SKU')).toMatchObject({
      exact: '50%_off\\sku',
      prefix: '50\\%\\_off\\\\sku%',
      contains: '%50\\%\\_off\\\\sku%',
    });
  });

  it('withholds contains for two-character searches', () => {
    expect(normalizeSearchTerms('ab').contains).toBeNull();
    expect(normalizeSearchTerms('abc').contains).toBe('%abc%');
  });

  it('normalizes complete and partial Philippine phone input without inventing a number', () => {
    expect(normalizeSearchTerms('0917 123 4567')).toMatchObject({
      phoneExact: '+639171234567',
      phoneDigits: '09171234567',
      phonePrefix: '09171234567%',
      phoneContains: '%09171234567%',
    });
    expect(normalizeSearchTerms('0917-12')).toMatchObject({
      phoneExact: null,
      phoneDigits: '091712',
      phonePrefix: '091712%',
      phoneContains: '%091712%',
    });
    expect(normalizeSearchTerms('not-a-phone')).toMatchObject({
      phoneExact: null,
      phoneDigits: null,
      phonePrefix: null,
      phoneContains: null,
    });
  });
});

describe('search ranking scores', () => {
  it('pins Product field priority inside each tier', () => {
    expect(PRODUCT_SCORE).toEqual({
      PRODUCT_CODE_EXACT: 1000,
      SKU_CODE_EXACT: 950,
      NAME_EXACT: 900,
      SLUG_EXACT: 850,
      PRODUCT_CODE_PREFIX: 700,
      SKU_CODE_PREFIX: 675,
      NAME_PREFIX: 650,
      SLUG_PREFIX: 625,
      PRODUCT_CODE_CONTAINS: 400,
      SKU_CODE_CONTAINS: 375,
      NAME_CONTAINS: 350,
      SLUG_CONTAINS: 325,
    });
  });

  it('pins Order, Customer, and Shipment field priority', () => {
    expect(ORDER_SCORE).toEqual({
      ORDER_NUMBER_EXACT: 1000,
      PHONE_EXACT: 900,
      CUSTOMER_NAME_EXACT: 800,
      ORDER_NUMBER_PREFIX: 700,
      PHONE_PREFIX: 650,
      CUSTOMER_NAME_PREFIX: 600,
      ORDER_NUMBER_CONTAINS: 400,
      PHONE_CONTAINS: 350,
      CUSTOMER_NAME_CONTAINS: 300,
    });
    expect(CUSTOMER_SCORE).toEqual({
      PHONE_EXACT: 1000,
      EMAIL_EXACT: 900,
      NAME_EXACT: 800,
      PHONE_PREFIX: 700,
      EMAIL_PREFIX: 650,
      NAME_PREFIX: 600,
      PHONE_CONTAINS: 400,
      EMAIL_CONTAINS: 350,
      NAME_CONTAINS: 300,
    });
    expect(SHIPMENT_SCORE).toEqual({
      TRACKING_NUMBER_EXACT: 1000,
      TRACKING_NUMBER_PREFIX: 700,
      TRACKING_NUMBER_CONTAINS: 400,
    });
  });
});

describe('Product search SQL', () => {
  it('ranks and deduplicates before LIMIT while binding literal input', () => {
    const raw = "x%' OR TRUE --";
    const sql = buildProductSearchQuery(normalizeSearchTerms(raw), 6);

    expect(PRODUCT_SCORE.PRODUCT_CODE_EXACT).toBeGreaterThan(
      PRODUCT_SCORE.SKU_CODE_EXACT,
    );
    expect(sql.sql).toContain('WITH inventory_totals');
    expect(sql.sql).toContain('SUM(on_hand - reserved)');
    expect(sql.sql).toContain('PARTITION BY product_id');
    expect(sql.sql).toContain('WHERE product_rank = 1');
    expect(sql.sql).toContain('ORDER BY score DESC, updated_at DESC, product_id ASC');
    expect(sql.sql).toContain("ESCAPE '\\'");
    expect(sql.sql).not.toContain(raw);
    expect(flatValues(sql)).toContain(raw.toLocaleLowerCase('en-US'));
    expect(flatValues(sql)).toContain(6);
  });

  it('omits contains patterns for a two-character query', () => {
    const values = flatValues(buildProductSearchQuery(normalizeSearchTerms('ab'), 6));
    expect(values).toContain('ab');
    expect(values).toContain('ab%');
    expect(values).not.toContain('%ab%');
  });
});

describe('cross-domain search SQL', () => {
  it('builds Order phone matching against canonical and local digit forms', () => {
    const sql = buildOrderSearchQuery(normalizeSearchTerms('0917-12'), 6);
    expect(sql.sql).toContain('FROM orders o');
    expect(sql.sql).toContain("replace(c.normalized_phone, '+', '')");
    expect(sql.sql).toContain("'0' || substring(replace(c.normalized_phone, '+', '') from 3)");
    expect(flatValues(sql)).toContain('091712%');
    expect(flatValues(sql)).toContain('%091712%');
    expect(flatValues(sql)).toContain(6);
  });

  it('keeps Order phone contains ahead of customer-name contains', () => {
    const sql = buildOrderSearchQuery(normalizeSearchTerms('0917'), 6).sql;
    const matchedFieldCase = sql.slice(
      sql.indexOf('CASE'),
      sql.indexOf('END AS matched_field'),
    );
    const orderContains = matchedFieldCase.lastIndexOf('WHEN lower(o.order_number) LIKE');
    const phoneContains = matchedFieldCase.lastIndexOf("replace(c.normalized_phone, '+', '')");
    const nameContains = matchedFieldCase.lastIndexOf("WHEN lower(COALESCE(c.name, '')) LIKE");
    expect(orderContains).toBeGreaterThanOrEqual(0);
    expect(phoneContains).toBeGreaterThan(orderContains);
    expect(nameContains).toBeGreaterThan(phoneContains);
  });

  it('builds Customer email, name, and phone ranking without requiring email', () => {
    const sql = buildCustomerSearchQuery(normalizeSearchTerms('Jane'), 6);
    expect(sql.sql).toContain('FROM customers c');
    expect(sql.sql).toContain("lower(COALESCE(c.email, ''))");
    expect(sql.sql).toContain("lower(COALESCE(c.name, ''))");
    expect(sql.sql).toContain('c.normalized_phone');
    expect(flatValues(sql)).toContain('jane');
    expect(flatValues(sql)).toContain(6);
  });

  it('returns every matching non-null Shipment and binds the take', () => {
    const sql = buildShipmentSearchQuery(normalizeSearchTerms('trk-001'), 6);
    expect(sql.sql).toContain('FROM shipments s');
    expect(sql.sql).toContain('JOIN orders o ON o.id = s.order_id');
    expect(sql.sql).toContain('s.tracking_number IS NOT NULL');
    expect(sql.sql).toContain('ORDER BY score DESC, updated_at DESC, shipment_id ASC');
    expect(flatValues(sql)).toContain('trk-001');
    expect(flatValues(sql)).toContain(6);
  });
});
