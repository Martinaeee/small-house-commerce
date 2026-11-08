const ORDER_KEY = "luwag_support_order_completed";
export const ORDER_COMPLETED_EVENT = "luwag:order-completed";
let completedInMemory = false;

export function recordSupportOrderCompleted(): void {
  completedInMemory = true;
  try { sessionStorage.setItem(ORDER_KEY, "1"); } catch { /* Private-mode fallback. */ }
  window.dispatchEvent(new Event(ORDER_COMPLETED_EVENT));
}

function orderCompleted(): boolean {
  try { return completedInMemory || sessionStorage.getItem(ORDER_KEY) === "1"; }
  catch { return completedInMemory; }
}

/** Foreground time, not inactivity. Horizontal media scrolling is not page-bottom intent. */
export function startMobileSupportReminder({ onShow, onHide, isDismissed, isBlocked }: {
  onShow(): void;
  onHide(): void;
  isDismissed(): boolean;
  isBlocked(): boolean;
}): () => void {
  let last = Date.now();
  let foreground = !document.hidden;
  let elapsed = 0;
  let bottomSince: number | null = null;
  let verticallyScrolled = window.scrollY > 0;
  let lastScrollY = window.scrollY;
  let fired = false;
  let shown = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { if (shown) onHide(); shown = false; clearTimeout(hideTimer); };
  const tick = () => {
    const now = Date.now();
    if (foreground) elapsed += Math.max(0, now - last);
    last = now;
    foreground = !document.hidden;
    if (orderCompleted()) { fired = true; hide(); return; }
    const blocked = isBlocked();
    if (shown) { if (!foreground || blocked) hide(); return; }
    if (fired || isDismissed()) return;
    if (!foreground || blocked) { bottomSince = null; return; }
    const atBottom = verticallyScrolled && document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 96;
    if (elapsed >= 30_000 && atBottom) bottomSince ??= now;
    else bottomSince = null;
    if (elapsed < 90_000 && (bottomSince === null || now - bottomSince < 3_000)) return;
    fired = true;
    shown = true;
    onShow();
    hideTimer = setTimeout(hide, 15_000);
  };
  const onScroll = () => {
    const y = window.scrollY;
    if (y === lastScrollY) return;
    lastScrollY = y;
    verticallyScrolled ||= y > 0;
    tick();
  };
  const interval = setInterval(tick, 1_000);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", tick);
  window.addEventListener(ORDER_COMPLETED_EVENT, tick);
  return () => {
    clearInterval(interval);
    clearTimeout(hideTimer);
    window.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener(ORDER_COMPLETED_EVENT, tick);
    hide();
  };
}
