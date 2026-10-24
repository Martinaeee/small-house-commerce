import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { AdminHelpTip } from "./AdminHelpTip";

/**
 * Admin form primitives. Control class string mirrors the storefront
 * login inputCls (see src/app/(storefront)/login/page.tsx).
 */
export const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

/**
 * Compact admin density (~38px tall, 14px text) for the back-office
 * workbench. `inputCls` stays the larger storefront-sized control for the
 * checkout/login/account importers.
 */
export const inputClsCompact =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

export function Field({
  label,
  error,
  hint,
  hintDisplay = "tooltip",
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  // Operator-facing guidance (Chinese in the admin back office). By default it
  // moves behind the label's question mark; pass "inline" for guidance the
  // operator must read before filling the control (formats, blocking rules).
  hint?: ReactNode;
  hintDisplay?: "tooltip" | "inline";
  children: ReactNode;
  htmlFor?: string;
}): ReactNode {
  return (
    <div className="relative">
      <label className="flex flex-col gap-1 pr-6 text-sm font-medium text-ink" htmlFor={htmlFor}>
        {label}
        <div>{children}</div>
        {hint && hintDisplay === "inline" ? (
          <p className="text-xs font-normal leading-relaxed text-ink-muted">{hint}</p>
        ) : null}
        {error ? (
          <p className="text-xs text-admin-error" role="alert">
            {error}
          </p>
        ) : null}
      </label>
      {hint && hintDisplay === "tooltip" ? (
        <span className="absolute right-0 top-0">
          <AdminHelpTip text={hint} />
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({
  className = "",
  inputRef,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: Ref<HTMLInputElement>;
}): ReactNode {
  return (
    <input
      ref={inputRef}
      className={`${inputClsCompact} ${className}`.trim()}
      {...props}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }): ReactNode {
  return (
    <select className={`${inputClsCompact} ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={`${inputClsCompact} ${className}`.trim()} {...props} />;
}
