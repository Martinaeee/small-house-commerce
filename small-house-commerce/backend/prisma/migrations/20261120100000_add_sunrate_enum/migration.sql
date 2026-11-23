-- SUNRATE online payments (design 2026-11-20). Additive: the enum value is
-- added in its own migration because rows using the new value cannot be
-- written in the same PostgreSQL transaction that introduces it.
ALTER TYPE "PaymentMethod" ADD VALUE 'SUNRATE';
