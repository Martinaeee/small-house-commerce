import { describe, expect, it, vi } from "vitest";
import { createViewportPlaybackCoordinator } from "./viewport-video-coordinator";

function video(playResult: Promise<void> = Promise.resolve()) {
  const element = document.createElement("video");
  const play = vi.fn(() => playResult);
  const pause = vi.fn();
  Object.defineProperties(element, {
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
  });
  return { element, play, pause };
}

async function settlePlayback(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ViewportPlaybackCoordinator", () => {
  it("keeps one autoplay winner and lets CONTENT preempt TEASER", async () => {
    const coordinator = createViewportPlaybackCoordinator();
    const teaser = video();
    const content = video();
    const teaserRegistration = coordinator.register({
      id: "teaser",
      element: teaser.element,
      mode: "TEASER",
    });
    const contentRegistration = coordinator.register({
      id: "content",
      element: content.element,
      mode: "CONTENT",
    });

    teaserRegistration.update({ eligible: true, intersectionRatio: 0.9 });
    await settlePlayback();
    expect(teaser.play).toHaveBeenCalledTimes(1);
    expect(content.play).not.toHaveBeenCalled();

    contentRegistration.update({ eligible: true, intersectionRatio: 0.3 });
    await settlePlayback();
    expect(teaser.pause).toHaveBeenCalledTimes(1);
    expect(content.play).toHaveBeenCalledTimes(1);
  });

  it("pauses a video that leaves and promotes the next visible candidate", async () => {
    const coordinator = createViewportPlaybackCoordinator();
    const first = video();
    const second = video();
    const firstRegistration = coordinator.register({
      id: "first",
      element: first.element,
      mode: "CONTENT",
    });
    const secondRegistration = coordinator.register({
      id: "second",
      element: second.element,
      mode: "CONTENT",
    });

    firstRegistration.update({ eligible: true, intersectionRatio: 0.8 });
    secondRegistration.update({ eligible: true, intersectionRatio: 0.4 });
    await settlePlayback();
    expect(first.play).toHaveBeenCalledTimes(1);

    firstRegistration.update({ eligible: true, intersectionRatio: 0 });
    await settlePlayback();
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(second.play).toHaveBeenCalledTimes(1);
  });

  it("pauses for page visibility and lightbox suspension, then resumes once", async () => {
    const coordinator = createViewportPlaybackCoordinator();
    const candidate = video();
    const registration = coordinator.register({
      id: "detail",
      element: candidate.element,
      mode: "CONTENT",
    });
    registration.update({ eligible: true, intersectionRatio: 0.8 });
    await settlePlayback();

    coordinator.setPageVisible(false);
    expect(candidate.pause).toHaveBeenCalledTimes(1);
    coordinator.setPageVisible(true);
    await settlePlayback();
    expect(candidate.play).toHaveBeenCalledTimes(2);

    const release = coordinator.suspend();
    expect(candidate.pause).toHaveBeenCalledTimes(2);
    release();
    await settlePlayback();
    expect(candidate.play).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rejected autoplay and lets another candidate win", async () => {
    const coordinator = createViewportPlaybackCoordinator();
    const rejected = video(Promise.reject(new DOMException("Blocked", "NotAllowedError")));
    const fallback = video();
    const rejectedRegistration = coordinator.register({
      id: "blocked",
      element: rejected.element,
      mode: "CONTENT",
    });
    const fallbackRegistration = coordinator.register({
      id: "fallback",
      element: fallback.element,
      mode: "TEASER",
    });

    rejectedRegistration.update({ eligible: true, intersectionRatio: 0.8 });
    fallbackRegistration.update({ eligible: true, intersectionRatio: 0.7 });
    await settlePlayback();
    await settlePlayback();

    expect(rejected.play).toHaveBeenCalledTimes(1);
    expect(fallback.play).toHaveBeenCalledTimes(1);

    rejectedRegistration.update({ eligible: true, intersectionRatio: 0.9 });
    await settlePlayback();
    expect(rejected.play).toHaveBeenCalledTimes(1);
  });
});
