-- Tencent COS is a third durable storage target for storefront shell assets
-- (header/footer artwork). Additive enum value; existing rows keep LOCAL/R2.
ALTER TYPE "StorefrontShellAssetStorage" ADD VALUE IF NOT EXISTS 'COS';
