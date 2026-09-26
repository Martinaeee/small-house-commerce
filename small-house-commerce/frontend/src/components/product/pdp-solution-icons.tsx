import type { Solution } from "@/lib/api";

/**
 * Line icons for the PDP selling-point pills. One per admin 卖点标签, drawn on
 * the same 24px grid and 1.8 stroke as the other PDP glyphs so the row reads
 * as part of the page rather than as a second icon set.
 */
function FoldableIcon() {
  return (
    <>
      <path d="M4 6h16v12H4z" strokeLinejoin="round" />
      <path d="M12 6v12" strokeDasharray="2 2.4" />
    </>
  );
}

function NarrowSpaceIcon() {
  return (
    <>
      <path d="M3 12h5.5M15.5 12H21" strokeLinecap="round" />
      <path d="m9 8.5-3.5 3.5L9 15.5M15 8.5l3.5 3.5L15 15.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function MobileIcon() {
  return (
    <>
      <circle cx="12" cy="15" r="4" />
      <path d="M12 4v4M9 7.5h6" strokeLinecap="round" />
    </>
  );
}

function MultifunctionalIcon() {
  return (
    <>
      <path d="m12 3 8 4-8 4-8-4z" strokeLinejoin="round" />
      <path d="m4 12 8 4 8-4M4 16.5l8 4 8-4" strokeLinejoin="round" />
    </>
  );
}

function HiddenStorageIcon() {
  return (
    <>
      <path d="M2.5 4h19v3.5h-19z" strokeLinejoin="round" />
      <path d="M4.5 7.5V20h15V7.5" strokeLinejoin="round" />
      <path d="M10 12h4" strokeLinecap="round" />
    </>
  );
}

function RentalFriendlyIcon() {
  return (
    <>
      <path d="m3 10.5 9-6.5 9 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9.5V20h12V9.5" strokeLinejoin="round" />
      <path d="M10 20v-5.5h4V20" strokeLinejoin="round" />
    </>
  );
}

const ICONS: Record<Solution, () => React.JSX.Element> = {
  FOLDABLE: FoldableIcon,
  NARROW_SPACE: NarrowSpaceIcon,
  MOBILE: MobileIcon,
  MULTIFUNCTIONAL: MultifunctionalIcon,
  HIDDEN_STORAGE: HiddenStorageIcon,
  RENTAL_FRIENDLY: RentalFriendlyIcon,
};

export function SolutionIcon({ value }: { value: Solution }) {
  const Icon = ICONS[value];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4 shrink-0 text-ink-secondary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <Icon />
    </svg>
  );
}
