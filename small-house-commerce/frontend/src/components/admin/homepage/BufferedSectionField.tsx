"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useBufferedValue } from "@/components/admin/homepage/AnnouncementSettings";
import {
  ImageUrlInput,
  type ImageUrlInputLabels,
} from "@/components/admin/ImageUrlInput";

export function BufferedTextInput({
  value,
  onCommit,
  isValid = () => true,
  commitValidImmediately = false,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
  isValid?: (value: string) => boolean;
  commitValidImmediately?: boolean;
}) {
  const field = useBufferedValue(value, onCommit, isValid);
  return (
    <input
      {...props}
      value={field.value}
      onChange={(event) => {
        const next = event.target.value;
        field.change(next);
        if (commitValidImmediately && isValid(next)) field.flush(next);
      }}
      onBlur={field.blur}
    />
  );
}

export function BufferedTextarea({
  value,
  onCommit,
  isValid = () => true,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
  isValid?: (value: string) => boolean;
}) {
  const field = useBufferedValue(value, onCommit, isValid);
  return (
    <textarea
      {...props}
      value={field.value}
      onChange={(event) => field.change(event.target.value)}
      onBlur={field.blur}
    />
  );
}

export function BufferedImageUrlInput({
  value,
  onCommit,
  isValid,
  labels,
  ...props
}: Omit<React.ComponentProps<typeof ImageUrlInput>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (value: string) => void;
  isValid: (value: string) => boolean;
  labels?: Partial<ImageUrlInputLabels>;
}) {
  const field = useBufferedValue(value, onCommit, isValid);
  return (
    <ImageUrlInput
      {...props}
      value={field.value}
      labels={labels}
      onChange={(next) => field.flush(next)}
      onBlur={field.blur}
    />
  );
}
