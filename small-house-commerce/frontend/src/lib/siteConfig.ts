/**
 * Storefront-wide site configuration.
 *
 * MESSENGER_URL — the business Facebook Page's Messenger chat link,
 * e.g. "https://m.me/smallhouse.ph". The floating chat widget renders only
 * when this is set; leaving it empty keeps the widget hidden until the
 * business Page exists. Fill it in (one line) to launch the widget.
 */
export const MESSENGER_URL = process.env.NEXT_PUBLIC_MESSENGER_URL ?? "";
