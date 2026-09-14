import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Admin form primitives. Control class string mirrors the storefront
 * login inputCls (see src/app/(storefront)/login/page.tsx).
 */
export const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  // Operator-facing guidance (Chinese in the admin back office). Shown muted
  // under the control; validation errors render after it in red.
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-ink" htmlFor={htmlFor}>
      {label}
      <div>{children}</div>
      {hint ? <p className="text-xs font-normal leading-relaxed text-ink-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={`${inputCls} ${className}`.trim()} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }): ReactNode {
  return (
    <select className={`${inputCls} ${className}`.trim()} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={`${inputCls} ${className}`.trim()} {...props} />;
}
