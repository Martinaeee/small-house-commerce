function fallbackCopyText(text: string): boolean {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previouslyFocused?.focus({ preventScroll: true });
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined") {
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText === "function") {
        await clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the user-gesture-based path for HTTP and denied access.
    }
  }

  return fallbackCopyText(text);
}
