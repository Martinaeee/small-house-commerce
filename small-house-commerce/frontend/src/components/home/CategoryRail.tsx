import type { CSSProperties, ReactNode } from "react";

/**
 * A plain swipe surface. The rail scrolls natively — touch, trackpad and
 * shift-wheel — and stays focusable so a keyboard can scroll it too. There are
 * deliberately no pan buttons: the overflowing next item is the affordance.
 */
export function CategoryRail({ className, style, label, children }: {
  className: string;
  style?: CSSProperties;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      style={style}
      data-homepage-category-rail
      role="group"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
