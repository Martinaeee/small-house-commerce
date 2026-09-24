"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { TextInput } from "@/components/admin/Field";

const DECIMAL_INPUT = /^\d+(\.\d*)?$/;

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  onValidityChange?: (valid: boolean) => void;
};

type DecimalDraft = {
  observedValue: number | null;
  raw: string;
  hasPendingValue: boolean;
  pendingValue: number | null;
};

function formatValue(value: number | null): string {
  return value === null ? "" : String(value);
}

export function DecimalInput({
  value,
  onValueChange,
  onValidityChange,
  onBlur,
  ...props
}: DecimalInputProps): ReactNode {
  const [draft, setDraft] = useState<DecimalDraft>(() => ({
    observedValue: value,
    raw: formatValue(value),
    hasPendingValue: false,
    pendingValue: null,
  }));

  let raw = draft.raw;
  if (!Object.is(draft.observedValue, value)) {
    const keepLocalRaw =
      draft.hasPendingValue && Object.is(draft.pendingValue, value);
    raw = keepLocalRaw ? draft.raw : formatValue(value);
    setDraft({
      observedValue: value,
      raw,
      hasPendingValue: false,
      pendingValue: null,
    });
  }

  const commit = (nextRaw: string, nextValue: number | null): void => {
    setDraft({
      observedValue: value,
      raw: nextRaw,
      hasPendingValue: true,
      pendingValue: nextValue,
    });
    onValidityChange?.(true);
    onValueChange(nextValue);
  };

  return (
    <TextInput
      {...props}
      value={raw}
      onChange={(event) => {
        const next = event.target.value.trim();
        if (next === "") {
          commit("", null);
          return;
        }
        if (!DECIMAL_INPUT.test(next)) {
          onValidityChange?.(false);
          return;
        }
        commit(next, Number(next));
      }}
      onBlur={(event) => {
        if (raw.endsWith(".")) {
          const parsed = Number(raw);
          commit(String(parsed), parsed);
        }
        onBlur?.(event);
      }}
    />
  );
}
