import type { Metadata } from "next";
import Link from "next/link";
import { RoomSceneStack } from "@/components/home/RoomSceneStack";
import { parseScenes } from "@/components/home/room-scenes";
import { getHomepage } from "@/lib/api";

export const metadata: Metadata = {
  title: "Room Inspiration",
  description:
    "Three shoppable room scenes for small Philippine homes — tap a numbered marker to see the piece it points to, then shop the whole room.",
  alternates: { canonical: "/inspiration" },
};

/**
 * The Inspiration page: the same hotspot scenes the homepage shows, stacked
 * vertically so all three rooms read top to bottom on one page. The scenes
 * come from the published homepage document, so publishing a scene in the
 * homepage builder puts it here as well.
 */
export default async function InspirationPage() {
  let scenes: ReturnType<typeof parseScenes> = null;
  try {
    const response = await getHomepage();
    const section = response.sections.find(
      (entry) => entry.type === "ROOM_INSPIRATION",
    );
    const payload = (section?.payload ?? {}) as Record<string, unknown>;
    scenes = parseScenes(payload);
  } catch {
    scenes = null;
  }

  return (
    <div className="bg-background">
      <header className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cta">
          Inspiration
        </p>
        <h1 className="mt-3 text-[clamp(26px,5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          Rooms that work in small spaces
        </h1>
        <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-secondary">
          Three room scenes from real LUWAG homes. Tap a numbered marker to see
          the piece it points to, then shop the whole room.
        </p>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-14">
        {scenes && scenes.length > 0 ? (
          <RoomSceneStack
            section={{ id: "room-inspiration", title: "Room Inspiration" }}
            scenes={scenes}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-ink">
              Room scenes are on their way
            </h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-6 text-ink-secondary">
              Our room scenes are being photographed. In the meantime, browse
              the collections below — every piece shown here is the same one
              you can order today.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/collections/new-arrivals"
                className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground"
              >
                Shop new arrivals
              </Link>
              <Link
                href="/collections/small-space-solutions"
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink"
              >
                Small-space solutions
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
