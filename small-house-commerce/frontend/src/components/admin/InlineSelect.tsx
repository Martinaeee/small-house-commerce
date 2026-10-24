"use client";

import { useEffect, useRef, useState } from "react";
import { inputClsCompact } from "@/components/admin/Field";

export interface InlineSelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * An in-page select for admin dialogs. Native `<select>` popups are drawn by
 * the OS, which on macOS enlarges the options and anchors them away from the
 * field; this menu stays inside the dialog at the same width and font size.
 */
export function InlineSelect<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  id?: string;
  ariaLabel: string;
  value: T;
  options: InlineSelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(next: T) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id ?? "inline-select"}-options` : undefined}
        aria-activedescendant={
          open ? `${id ?? "inline-select"}-option-${options[activeIndex]?.value}` : undefined
        }
        className={`${inputClsCompact} flex items-center justify-between gap-2 text-left font-normal`}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex(
              open
                ? (activeIndex + step + options.length) % options.length
                : selectedIndex,
            );
            setOpen(true);
          } else if (open && (event.key === "Home" || event.key === "End")) {
            event.preventDefault();
            setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
          } else if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            choose(options[activeIndex]!.value);
          } else if (open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            // Next delegates at document, where the enclosing dialogs also
            // listen; one Esc must only dismiss the open options.
            event.nativeEvent.stopImmediatePropagation();
            setOpen(false);
          } else if (event.key === "Tab") {
            setOpen(false);
          }
        }}
      >
        {options[selectedIndex]?.label ?? ""}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open ? (
        <div
          id={`${id ?? "inline-select"}-options`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm font-normal text-ink shadow-lg"
        >
          {options.map((option, index) => (
            <div
              id={`${id ?? "inline-select"}-option-${option.value}`}
              key={option.value}
              role="option"
              aria-selected={value === option.value}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                activeIndex === index ? "bg-primary-light/40" : ""
              }`}
              onMouseMove={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                choose(option.value);
              }}
            >
              {option.label}
              {value === option.value ? (
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="m4 10 4 4 8-8" />
                </svg>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
