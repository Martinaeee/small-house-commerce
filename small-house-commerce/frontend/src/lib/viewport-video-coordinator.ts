export type ViewportPlaybackMode = "TEASER" | "CONTENT" | "HERO";

interface Candidate {
  id: string;
  element: HTMLVideoElement;
  mode: ViewportPlaybackMode;
  eligible: boolean;
  intersectionRatio: number;
  blocked: boolean;
  order: number;
}

export interface ViewportPlaybackRegistration {
  update(input: {
    eligible: boolean;
    intersectionRatio: number;
  }): void;
  unregister(): void;
}

export interface ViewportPlaybackCoordinator {
  register(input: {
    id: string;
    element: HTMLVideoElement;
    mode: ViewportPlaybackMode;
  }): ViewportPlaybackRegistration;
  setPageVisible(visible: boolean): void;
  suspend(): () => void;
}

const MODE_PRIORITY: Record<ViewportPlaybackMode, number> = {
  TEASER: 1,
  CONTENT: 2,
  HERO: 3,
};

class Coordinator implements ViewportPlaybackCoordinator {
  private readonly candidates = new Map<string, Candidate>();
  private winnerId: string | null = null;
  private pageVisible = true;
  private suspensionCount = 0;
  private nextOrder = 0;
  private playVersion = 0;

  register(input: {
    id: string;
    element: HTMLVideoElement;
    mode: ViewportPlaybackMode;
  }): ViewportPlaybackRegistration {
    const candidate: Candidate = {
      ...input,
      eligible: false,
      intersectionRatio: 0,
      blocked: false,
      order: this.nextOrder,
    };
    this.nextOrder += 1;
    this.candidates.set(input.id, candidate);
    let registered = true;

    return {
      update: (update) => {
        if (!registered) return;
        candidate.eligible = update.eligible;
        candidate.intersectionRatio = update.intersectionRatio;
        this.reconcile();
      },
      unregister: () => {
        if (!registered) return;
        registered = false;
        this.candidates.delete(candidate.id);
        if (this.winnerId === candidate.id) {
          candidate.element.pause();
          this.winnerId = null;
          this.playVersion += 1;
        }
        this.reconcile();
      },
    };
  }

  setPageVisible(visible: boolean): void {
    if (this.pageVisible === visible) return;
    this.pageVisible = visible;
    this.reconcile();
  }

  suspend(): () => void {
    this.suspensionCount += 1;
    this.reconcile();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.suspensionCount = Math.max(0, this.suspensionCount - 1);
      this.reconcile();
    };
  }

  private nextWinner(): Candidate | null {
    if (!this.pageVisible || this.suspensionCount > 0) return null;
    return (
      [...this.candidates.values()]
        .filter(
          (candidate) =>
            candidate.eligible &&
            candidate.intersectionRatio > 0 &&
            !candidate.blocked,
        )
        .sort(
          (left, right) =>
            MODE_PRIORITY[right.mode] - MODE_PRIORITY[left.mode] ||
            right.intersectionRatio - left.intersectionRatio ||
            left.order - right.order,
        )[0] ?? null
    );
  }

  private reconcile(): void {
    const next = this.nextWinner();
    if (next?.id === this.winnerId) return;

    const previous = this.winnerId
      ? this.candidates.get(this.winnerId)
      : undefined;
    previous?.element.pause();
    this.winnerId = next?.id ?? null;
    const version = this.playVersion + 1;
    this.playVersion = version;
    if (!next) return;

    let attempt: Promise<void> | void;
    try {
      attempt = next.element.play();
    } catch {
      this.rejectAutoplay(next.id, version);
      return;
    }
    Promise.resolve(attempt).then(
      () => {
        if (this.winnerId !== next.id || this.playVersion !== version) {
          next.element.pause();
        }
      },
      () => this.rejectAutoplay(next.id, version),
    );
  }

  private rejectAutoplay(id: string, version: number): void {
    const candidate = this.candidates.get(id);
    if (!candidate) return;
    candidate.blocked = true;
    if (this.winnerId === id && this.playVersion === version) {
      candidate.element.pause();
      this.winnerId = null;
    }
    this.reconcile();
  }
}

export function createViewportPlaybackCoordinator(): ViewportPlaybackCoordinator {
  return new Coordinator();
}

let sharedCoordinator = createViewportPlaybackCoordinator();
let sharedRegistrations = 0;
let removeVisibilityListener: (() => void) | null = null;

function startVisibilityTracking(): void {
  if (typeof document === "undefined" || removeVisibilityListener) return;
  const sync = () => {
    sharedCoordinator.setPageVisible(document.visibilityState !== "hidden");
  };
  sync();
  document.addEventListener("visibilitychange", sync);
  removeVisibilityListener = () => {
    document.removeEventListener("visibilitychange", sync);
    removeVisibilityListener = null;
  };
}

export function registerViewportPlayback(input: {
  id: string;
  element: HTMLVideoElement;
  mode: ViewportPlaybackMode;
}): ViewportPlaybackRegistration {
  startVisibilityTracking();
  sharedRegistrations += 1;
  const registration = sharedCoordinator.register(input);
  let registered = true;
  return {
    update: (update) => registration.update(update),
    unregister: () => {
      if (!registered) return;
      registered = false;
      registration.unregister();
      sharedRegistrations = Math.max(0, sharedRegistrations - 1);
      if (sharedRegistrations === 0) removeVisibilityListener?.();
    },
  };
}

export function suspendViewportPlayback(): () => void {
  return sharedCoordinator.suspend();
}

export function resetViewportPlaybackForTests(): void {
  removeVisibilityListener?.();
  sharedRegistrations = 0;
  sharedCoordinator = createViewportPlaybackCoordinator();
}
