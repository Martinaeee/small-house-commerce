const PREFIX = "admin:product-created:";

/** Carry a fully completed create across the client-side redirect to edit. */
export function rememberProductCreated(id: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${id}`, String(Date.now()));
  } catch {
    // A disabled browser storage must never turn a completed save into failure.
  }
}

export function consumeProductCreated(id: string): boolean {
  try {
    const key = `${PREFIX}${id}`;
    const savedAt = Number(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    const age = Date.now() - savedAt;
    return savedAt > 0 && age >= 0 && age < 60_000;
  } catch {
    return false;
  }
}
