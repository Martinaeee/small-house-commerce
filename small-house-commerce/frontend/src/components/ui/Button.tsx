import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

/**
 * DESIGN_SYSTEM §10 buttons.
 * Primary: main conversion action (ORDER NOW / SHOP NOW / BUY NOW) —
 * 52px height mobile, 8px radius, 16px bold, CTA colour.
 * Secondary: ADD TO CART / VIEW DETAILS — transparent with border.
 * Text: VIEW MORE / LEARN MORE.
 */

type Variant = "primary" | "secondary" | "text";
type Size = "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "inline-flex items-center justify-center rounded-lg bg-cta text-white hover:bg-cta-hover active:bg-cta-hover disabled:bg-ink-muted disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center rounded-lg border border-cta/40 bg-transparent text-cta hover:bg-primary-light/40 disabled:text-ink-muted disabled:border-border disabled:cursor-not-allowed",
  text: "inline-flex items-center justify-center text-cta underline-offset-4 hover:underline disabled:text-ink-muted disabled:cursor-not-allowed",
};

const sizes: Record<Size, string> = {
  lg: "h-[52px] min-w-[160px] px-8 text-base font-bold",
  md: "h-12 min-w-[120px] px-6 text-base font-semibold",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "lg",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
}

export function ButtonLink({
  variant = "primary",
  size = "lg",
  className = "",
  ...props
}: ButtonLinkProps) {
  return (
    <a className={`${variants[variant]} ${sizes[size]} ${className}`} {...props} />
  );
}
