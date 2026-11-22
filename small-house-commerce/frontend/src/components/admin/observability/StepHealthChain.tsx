"use client";

import type { ObsStatus } from "./StatusBadge";
import { StatusBadge } from "./StatusBadge";

export interface HealthStep {
  key: string;
  label: string;
  state: ObsStatus;
  detail?: string;
}

/**
 * Generic technical step chain (P1R): replaces the attribution-specific
 * layer component. Used by Journey/Checkout diagnostics in later phases.
 */
export function StepHealthChain({ steps }: { steps: HealthStep[] }) {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-1">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 flex-col gap-1 rounded-lg border border-admin-border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-admin-muted">
              {index + 1}. {step.label}
            </span>
            <StatusBadge status={step.state} />
          </div>
          {step.detail ? <p className="text-[11px] text-admin-muted">{step.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
