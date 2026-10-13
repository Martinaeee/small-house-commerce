SET lock_timeout = '5s';

ALTER TABLE "site_settings"
  ADD COLUMN "newsletter_eyebrow" TEXT NOT NULL DEFAULT 'The LUWAG edit',
  ADD COLUMN "newsletter_form_title" TEXT NOT NULL DEFAULT 'Subscribe by email',
  ADD COLUMN "newsletter_email_placeholder" TEXT NOT NULL DEFAULT 'Your email address',
  ADD COLUMN "newsletter_consent_text" TEXT NOT NULL DEFAULT 'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.';
