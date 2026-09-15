import { ButtonLink } from "@/components/ui/Button";
import { poppins } from "@/lib/fonts";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Highlight the "luwag" word in the seeded headline; other titles render as-is. */
function renderTitle(title: string) {
  return title.split(/(Luwag\.?)/g).map((part, i) =>
    /^Luwag/.test(part) ? (
      <span key={i} className={`${poppins.className} lowercase text-cta`}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function HeroSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const desktop = str(p.desktopImage);
  const mobile = str(p.mobileImage);
  const video = str(p.videoUrl);
  const poster = str(p.posterImage);
  const primary = {
    text: str(p.ctaPrimaryText) || "Shop Small-Space Picks",
    href: str(p.ctaPrimaryLink) || "/collections",
  };
  const secondary = {
    text: str(p.ctaSecondaryText) || "Explore Solutions",
    href: str(p.ctaSecondaryLink) || "#solutions",
  };

  const ctas = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ButtonLink href={primary.href} size="lg" {...trackAttrs("HeroClick", section, 1)}>
        {primary.text}
      </ButtonLink>
      <ButtonLink href={secondary.href} variant="secondary" size="lg" {...trackAttrs("HeroClick", section, 2)}>
        {secondary.text}
      </ButtonLink>
    </div>
  );

  if (video || desktop) {
    return (
      <section className="relative">
        {video ? (
          <>
            <div className="relative hidden h-[520px] w-full md:block">
              <video
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                controls={false}
                poster={poster || desktop || undefined}
              >
                <source src={video} type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-gradient-to-r from-ink/60 via-ink/25 to-transparent" />
            </div>
            <div className="relative aspect-[4/5] w-full md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mobile || poster || desktop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink/40 to-ink/50" />
            </div>
          </>
        ) : (
          <>
            <div className="relative hidden aspect-[16/7] w-full md:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={desktop} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-ink/55 via-ink/20 to-transparent" />
            </div>
            <div className="relative aspect-[4/5] w-full md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mobile || desktop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink/40 to-ink/50" />
            </div>
          </>
        )}
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-5 px-4 sm:px-6">
            <h1 className="max-w-xl text-4xl font-semibold text-white sm:text-5xl">{section.title}</h1>
            {section.subtitle ? (
              <p className="max-w-lg text-base text-white/90">{section.subtitle}</p>
            ) : null}
            {ctas}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-b from-primary-light/50 to-background">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-semibold text-ink sm:text-5xl">
          {section.title ? renderTitle(section.title) : null}
        </h1>
        {section.subtitle ? (
          <p className="max-w-xl text-base text-ink-secondary">{section.subtitle}</p>
        ) : null}
        {ctas}
      </div>
    </section>
  );
}
