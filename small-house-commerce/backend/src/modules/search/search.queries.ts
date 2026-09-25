import { Prisma } from '../../generated/prisma/client.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';

export const PRODUCT_SCORE = {
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
} as const;

export const ORDER_SCORE = {
  ORDER_NUMBER_EXACT: 1000,
  PHONE_EXACT: 900,
  CUSTOMER_NAME_EXACT: 800,
  ORDER_NUMBER_PREFIX: 700,
  PHONE_PREFIX: 650,
  CUSTOMER_NAME_PREFIX: 600,
  ORDER_NUMBER_CONTAINS: 400,
  PHONE_CONTAINS: 350,
  CUSTOMER_NAME_CONTAINS: 300,
} as const;

export const CUSTOMER_SCORE = {
  PHONE_EXACT: 1000,
  EMAIL_EXACT: 900,
  NAME_EXACT: 800,
  PHONE_PREFIX: 700,
  EMAIL_PREFIX: 650,
  NAME_PREFIX: 600,
  PHONE_CONTAINS: 400,
  EMAIL_CONTAINS: 350,
  NAME_CONTAINS: 300,
} as const;

export const SHIPMENT_SCORE = {
  TRACKING_NUMBER_EXACT: 1000,
  TRACKING_NUMBER_PREFIX: 700,
  TRACKING_NUMBER_CONTAINS: 400,
} as const;

export interface SearchTerms {
  exact: string;
  prefix: string;
  contains: string | null;
  phoneExact: string | null;
  phoneDigits: string | null;
  phonePrefix: string | null;
  phoneContains: string | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function normalizeSearchTerms(query: string): SearchTerms {
  const normalized = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const escaped = escapeLike(normalized);
  const digits = /^[+\d()\-\s]+$/.test(query) ? query.replace(/\D/g, '') : '';
  const phoneDigits = digits.length >= 2 ? digits : null;

  return {
    exact: normalized,
    prefix: `${escaped}%`,
    contains: [...normalized].length >= 3 ? `%${escaped}%` : null,
    phoneExact: normalizePhilippinePhone(query),
    phoneDigits,
    phonePrefix: phoneDigits === null ? null : `${escapeLike(phoneDigits)}%`,
    phoneContains:
      phoneDigits === null || [...normalized].length < 3
        ? null
        : `%${escapeLike(phoneDigits)}%`,
  };
}

export function buildProductSearchQuery(terms: SearchTerms, take: number): Prisma.Sql {
  const productContainsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.PRODUCT_CODE_CONTAINS}
          WHEN lower(p.name) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.NAME_CONTAINS}
          WHEN lower(p.slug) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.SLUG_CONTAINS}`;
  const productContainsField =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.contains} ESCAPE '\\'
            THEN 'PRODUCT_CODE'
          WHEN lower(p.name) LIKE ${terms.contains} ESCAPE '\\' THEN 'NAME'
          WHEN lower(p.slug) LIKE ${terms.contains} ESCAPE '\\' THEN 'SLUG'`;
  const productContainsText =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.contains} ESCAPE '\\'
            THEN p.product_code
          WHEN lower(p.name) LIKE ${terms.contains} ESCAPE '\\' THEN p.name
          WHEN lower(p.slug) LIKE ${terms.contains} ESCAPE '\\' THEN p.slug`;
  const productContainsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          OR lower(COALESCE(p.product_code, '')) LIKE ${terms.contains} ESCAPE '\\'
          OR lower(p.name) LIKE ${terms.contains} ESCAPE '\\'
          OR lower(p.slug) LIKE ${terms.contains} ESCAPE '\\'`;

  const skuContainsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(s.sku_code) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.SKU_CODE_CONTAINS}`;
  const skuContainsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`OR lower(s.sku_code) LIKE ${terms.contains} ESCAPE '\\'`;

  return Prisma.sql`
    WITH inventory_totals AS (
      SELECT sku_id, COALESCE(SUM(on_hand - reserved), 0)::int AS available_inventory
      FROM inventory
      GROUP BY sku_id
    ), candidates AS (
      SELECT
        p.id AS product_id,
        p.name,
        p.product_code,
        p.slug,
        p.status::text AS product_status,
        p.updated_at,
        CASE
          WHEN lower(COALESCE(p.product_code, '')) = ${terms.exact} THEN 'PRODUCT_CODE'
          WHEN lower(p.name) = ${terms.exact} THEN 'NAME'
          WHEN lower(p.slug) = ${terms.exact} THEN 'SLUG'
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN 'PRODUCT_CODE'
          WHEN lower(p.name) LIKE ${terms.prefix} ESCAPE '\\' THEN 'NAME'
          WHEN lower(p.slug) LIKE ${terms.prefix} ESCAPE '\\' THEN 'SLUG'
          ${productContainsField}
        END AS matched_field,
        CASE
          WHEN lower(COALESCE(p.product_code, '')) = ${terms.exact} THEN p.product_code
          WHEN lower(p.name) = ${terms.exact} THEN p.name
          WHEN lower(p.slug) = ${terms.exact} THEN p.slug
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN p.product_code
          WHEN lower(p.name) LIKE ${terms.prefix} ESCAPE '\\' THEN p.name
          WHEN lower(p.slug) LIKE ${terms.prefix} ESCAPE '\\' THEN p.slug
          ${productContainsText}
        END AS matched_text,
        CASE
          WHEN lower(COALESCE(p.product_code, '')) = ${terms.exact}
            THEN ${PRODUCT_SCORE.PRODUCT_CODE_EXACT}
          WHEN lower(p.name) = ${terms.exact} THEN ${PRODUCT_SCORE.NAME_EXACT}
          WHEN lower(p.slug) = ${terms.exact} THEN ${PRODUCT_SCORE.SLUG_EXACT}
          WHEN lower(COALESCE(p.product_code, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.PRODUCT_CODE_PREFIX}
          WHEN lower(p.name) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.NAME_PREFIX}
          WHEN lower(p.slug) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.SLUG_PREFIX}
          ${productContainsScore}
        END AS score,
        NULL::uuid AS sku_id,
        NULL::text AS sku_code,
        NULL::text AS sku_status,
        NULL::uuid AS variant_id,
        NULL::text AS variant_name,
        NULL::numeric AS price,
        0::int AS available_inventory
      FROM products p
      WHERE
        lower(COALESCE(p.product_code, '')) = ${terms.exact}
        OR lower(p.name) = ${terms.exact}
        OR lower(p.slug) = ${terms.exact}
        OR lower(COALESCE(p.product_code, '')) LIKE ${terms.prefix} ESCAPE '\\'
        OR lower(p.name) LIKE ${terms.prefix} ESCAPE '\\'
        OR lower(p.slug) LIKE ${terms.prefix} ESCAPE '\\'
        ${productContainsPredicate}

      UNION ALL

      SELECT
        p.id AS product_id,
        p.name,
        p.product_code,
        p.slug,
        p.status::text AS product_status,
        p.updated_at,
        'SKU_CODE'::text AS matched_field,
        s.sku_code AS matched_text,
        CASE
          WHEN lower(s.sku_code) = ${terms.exact} THEN ${PRODUCT_SCORE.SKU_CODE_EXACT}
          WHEN lower(s.sku_code) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${PRODUCT_SCORE.SKU_CODE_PREFIX}
          ${skuContainsScore}
        END AS score,
        s.id AS sku_id,
        s.sku_code,
        s.status::text AS sku_status,
        v.id AS variant_id,
        v.name AS variant_name,
        s.price,
        COALESCE(it.available_inventory, 0)::int AS available_inventory
      FROM products p
      JOIN skus s ON s.product_id = p.id
      JOIN product_variants v ON v.id = s.variant_id
      LEFT JOIN inventory_totals it ON it.sku_id = s.id
      WHERE
        lower(s.sku_code) = ${terms.exact}
        OR lower(s.sku_code) LIKE ${terms.prefix} ESCAPE '\\'
        ${skuContainsPredicate}
    ), ranked AS (
      SELECT
        candidates.*,
        row_number() OVER (
          PARTITION BY product_id
          ORDER BY score DESC, sku_id NULLS LAST, product_id
        ) AS product_rank
      FROM candidates
    )
    SELECT
      product_id,
      name,
      product_code,
      slug,
      product_status,
      updated_at,
      matched_field,
      matched_text,
      score,
      sku_id,
      sku_code,
      sku_status,
      variant_id,
      variant_name,
      price,
      available_inventory
    FROM ranked
    WHERE product_rank = 1
    ORDER BY score DESC, updated_at DESC, product_id ASC
    LIMIT ${take}
  `;
}

export function buildOrderSearchQuery(terms: SearchTerms, take: number): Prisma.Sql {
  const phoneExactScore =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN ${ORDER_SCORE.PHONE_EXACT}`;
  const phoneExactField =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN 'PHONE'`;
  const phoneExactText =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN c.normalized_phone`;
  const phoneExactPredicate =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`OR c.normalized_phone = ${terms.phoneExact}`;

  const phonePrefixCondition =
    terms.phonePrefix === null
      ? null
      : Prisma.sql`(
          replace(c.normalized_phone, '+', '') LIKE ${terms.phonePrefix} ESCAPE '\\'
          OR '0' || substring(replace(c.normalized_phone, '+', '') from 3)
            LIKE ${terms.phonePrefix} ESCAPE '\\'
        )`;
  const phonePrefixScore =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN ${ORDER_SCORE.PHONE_PREFIX}`;
  const phonePrefixField =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN 'PHONE'`;
  const phonePrefixText =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN c.normalized_phone`;
  const phonePrefixPredicate =
    phonePrefixCondition === null ? Prisma.sql`` : Prisma.sql`OR ${phonePrefixCondition}`;

  const phoneContainsCondition =
    terms.phoneContains === null
      ? null
      : Prisma.sql`(
          replace(c.normalized_phone, '+', '') LIKE ${terms.phoneContains} ESCAPE '\\'
          OR '0' || substring(replace(c.normalized_phone, '+', '') from 3)
            LIKE ${terms.phoneContains} ESCAPE '\\'
        )`;
  const orderContainsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(o.order_number) LIKE ${terms.contains} ESCAPE '\\'
          THEN ${ORDER_SCORE.ORDER_NUMBER_CONTAINS}`;
  const orderContainsField =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(o.order_number) LIKE ${terms.contains} ESCAPE '\\'
          THEN 'ORDER_NUMBER'`;
  const orderContainsText =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(o.order_number) LIKE ${terms.contains} ESCAPE '\\'
          THEN o.order_number`;
  const orderContainsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`OR lower(o.order_number) LIKE ${terms.contains} ESCAPE '\\'`;
  const customerNameContainsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'
          THEN ${ORDER_SCORE.CUSTOMER_NAME_CONTAINS}`;
  const customerNameContainsField =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'
          THEN 'CUSTOMER_NAME'`;
  const customerNameContainsText =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'
          THEN c.name`;
  const customerNameContainsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`OR lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'`;
  const phoneContainsScore =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN ${ORDER_SCORE.PHONE_CONTAINS}`;
  const phoneContainsField =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN 'PHONE'`;
  const phoneContainsText =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN c.normalized_phone`;
  const phoneContainsPredicate =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`OR ${phoneContainsCondition}`;

  return Prisma.sql`
    SELECT *
    FROM (
      SELECT
        o.id AS order_id,
        o.order_number,
        o.order_status::text AS order_status,
        o.confirmation_status::text AS confirmation_status,
        c.name AS customer_name,
        c.normalized_phone,
        o.created_at,
        o.updated_at,
        CASE
          WHEN lower(o.order_number) = ${terms.exact} THEN 'ORDER_NUMBER'
          ${phoneExactField}
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact} THEN 'CUSTOMER_NAME'
          WHEN lower(o.order_number) LIKE ${terms.prefix} ESCAPE '\\' THEN 'ORDER_NUMBER'
          ${phonePrefixField}
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN 'CUSTOMER_NAME'
          ${orderContainsField}
          ${phoneContainsField}
          ${customerNameContainsField}
        END AS matched_field,
        CASE
          WHEN lower(o.order_number) = ${terms.exact} THEN o.order_number
          ${phoneExactText}
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact} THEN c.name
          WHEN lower(o.order_number) LIKE ${terms.prefix} ESCAPE '\\' THEN o.order_number
          ${phonePrefixText}
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\' THEN c.name
          ${orderContainsText}
          ${phoneContainsText}
          ${customerNameContainsText}
        END AS matched_text,
        CASE
          WHEN lower(o.order_number) = ${terms.exact} THEN ${ORDER_SCORE.ORDER_NUMBER_EXACT}
          ${phoneExactScore}
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact}
            THEN ${ORDER_SCORE.CUSTOMER_NAME_EXACT}
          WHEN lower(o.order_number) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${ORDER_SCORE.ORDER_NUMBER_PREFIX}
          ${phonePrefixScore}
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${ORDER_SCORE.CUSTOMER_NAME_PREFIX}
          ${orderContainsScore}
          ${phoneContainsScore}
          ${customerNameContainsScore}
        END AS score
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE
        lower(o.order_number) = ${terms.exact}
        OR lower(COALESCE(c.name, '')) = ${terms.exact}
        OR lower(o.order_number) LIKE ${terms.prefix} ESCAPE '\\'
        OR lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\'
        ${phoneExactPredicate}
        ${phonePrefixPredicate}
        ${orderContainsPredicate}
        ${phoneContainsPredicate}
        ${customerNameContainsPredicate}
    ) AS ranked_orders
    ORDER BY score DESC, updated_at DESC, order_id ASC
    LIMIT ${take}
  `;
}

export function buildCustomerSearchQuery(terms: SearchTerms, take: number): Prisma.Sql {
  const phoneExactScore =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN ${CUSTOMER_SCORE.PHONE_EXACT}`;
  const phoneExactField =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN 'PHONE'`;
  const phoneExactText =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`WHEN c.normalized_phone = ${terms.phoneExact} THEN c.normalized_phone`;
  const phoneExactPredicate =
    terms.phoneExact === null
      ? Prisma.sql``
      : Prisma.sql`OR c.normalized_phone = ${terms.phoneExact}`;
  const phonePrefixCondition =
    terms.phonePrefix === null
      ? null
      : Prisma.sql`(
          replace(c.normalized_phone, '+', '') LIKE ${terms.phonePrefix} ESCAPE '\\'
          OR '0' || substring(replace(c.normalized_phone, '+', '') from 3)
            LIKE ${terms.phonePrefix} ESCAPE '\\'
        )`;
  const phoneContainsCondition =
    terms.phoneContains === null
      ? null
      : Prisma.sql`(
          replace(c.normalized_phone, '+', '') LIKE ${terms.phoneContains} ESCAPE '\\'
          OR '0' || substring(replace(c.normalized_phone, '+', '') from 3)
            LIKE ${terms.phoneContains} ESCAPE '\\'
        )`;
  const phonePrefixScore =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN ${CUSTOMER_SCORE.PHONE_PREFIX}`;
  const phonePrefixField =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN 'PHONE'`;
  const phonePrefixText =
    phonePrefixCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phonePrefixCondition} THEN c.normalized_phone`;
  const phonePrefixPredicate =
    phonePrefixCondition === null ? Prisma.sql`` : Prisma.sql`OR ${phonePrefixCondition}`;
  const phoneContainsScore =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN ${CUSTOMER_SCORE.PHONE_CONTAINS}`;
  const phoneContainsField =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN 'PHONE'`;
  const phoneContainsText =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`WHEN ${phoneContainsCondition} THEN c.normalized_phone`;
  const phoneContainsPredicate =
    phoneContainsCondition === null
      ? Prisma.sql``
      : Prisma.sql`OR ${phoneContainsCondition}`;
  const containsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${CUSTOMER_SCORE.EMAIL_CONTAINS}
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${CUSTOMER_SCORE.NAME_CONTAINS}`;
  const containsField =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.contains} ESCAPE '\\' THEN 'EMAIL'
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\' THEN 'NAME'`;
  const containsText =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.contains} ESCAPE '\\' THEN c.email
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\' THEN c.name`;
  const containsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          OR lower(COALESCE(c.email, '')) LIKE ${terms.contains} ESCAPE '\\'
          OR lower(COALESCE(c.name, '')) LIKE ${terms.contains} ESCAPE '\\'`;

  return Prisma.sql`
    SELECT *
    FROM (
      SELECT
        c.id AS customer_id,
        c.name,
        c.normalized_phone,
        c.email,
        c.current_risk_level::text AS risk_level,
        c.updated_at,
        CASE
          ${phoneExactField}
          WHEN lower(COALESCE(c.email, '')) = ${terms.exact} THEN 'EMAIL'
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact} THEN 'NAME'
          ${phonePrefixField}
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.prefix} ESCAPE '\\' THEN 'EMAIL'
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\' THEN 'NAME'
          ${phoneContainsField}
          ${containsField}
        END AS matched_field,
        CASE
          ${phoneExactText}
          WHEN lower(COALESCE(c.email, '')) = ${terms.exact} THEN c.email
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact} THEN c.name
          ${phonePrefixText}
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.prefix} ESCAPE '\\' THEN c.email
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\' THEN c.name
          ${phoneContainsText}
          ${containsText}
        END AS matched_text,
        CASE
          ${phoneExactScore}
          WHEN lower(COALESCE(c.email, '')) = ${terms.exact} THEN ${CUSTOMER_SCORE.EMAIL_EXACT}
          WHEN lower(COALESCE(c.name, '')) = ${terms.exact} THEN ${CUSTOMER_SCORE.NAME_EXACT}
          ${phonePrefixScore}
          WHEN lower(COALESCE(c.email, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${CUSTOMER_SCORE.EMAIL_PREFIX}
          WHEN lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${CUSTOMER_SCORE.NAME_PREFIX}
          ${phoneContainsScore}
          ${containsScore}
        END AS score
      FROM customers c
      WHERE
        lower(COALESCE(c.email, '')) = ${terms.exact}
        OR lower(COALESCE(c.name, '')) = ${terms.exact}
        OR lower(COALESCE(c.email, '')) LIKE ${terms.prefix} ESCAPE '\\'
        OR lower(COALESCE(c.name, '')) LIKE ${terms.prefix} ESCAPE '\\'
        ${phoneExactPredicate}
        ${phonePrefixPredicate}
        ${phoneContainsPredicate}
        ${containsPredicate}
    ) AS ranked_customers
    ORDER BY score DESC, updated_at DESC, customer_id ASC
    LIMIT ${take}
  `;
}

export function buildShipmentSearchQuery(terms: SearchTerms, take: number): Prisma.Sql {
  const containsScore =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`
          WHEN lower(s.tracking_number) LIKE ${terms.contains} ESCAPE '\\'
            THEN ${SHIPMENT_SCORE.TRACKING_NUMBER_CONTAINS}`;
  const containsPredicate =
    terms.contains === null
      ? Prisma.sql``
      : Prisma.sql`OR lower(s.tracking_number) LIKE ${terms.contains} ESCAPE '\\'`;

  return Prisma.sql`
    SELECT *
    FROM (
      SELECT
        s.id AS shipment_id,
        s.tracking_number,
        s.carrier,
        s.status::text AS status,
        s.order_id,
        o.order_number,
        s.updated_at,
        'TRACKING_NUMBER'::text AS matched_field,
        s.tracking_number AS matched_text,
        CASE
          WHEN lower(s.tracking_number) = ${terms.exact}
            THEN ${SHIPMENT_SCORE.TRACKING_NUMBER_EXACT}
          WHEN lower(s.tracking_number) LIKE ${terms.prefix} ESCAPE '\\'
            THEN ${SHIPMENT_SCORE.TRACKING_NUMBER_PREFIX}
          ${containsScore}
        END AS score
      FROM shipments s
      JOIN orders o ON o.id = s.order_id
      WHERE
        s.tracking_number IS NOT NULL
        AND (
          lower(s.tracking_number) = ${terms.exact}
          OR lower(s.tracking_number) LIKE ${terms.prefix} ESCAPE '\\'
          ${containsPredicate}
        )
    ) AS ranked_shipments
    ORDER BY score DESC, updated_at DESC, shipment_id ASC
    LIMIT ${take}
  `;
}
