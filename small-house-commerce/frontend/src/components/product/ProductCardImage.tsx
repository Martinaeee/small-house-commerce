"use client";

import Link from "next/link";
import { useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import type { ProductCardImage as CardImage, ProductCardMediaPair } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

export interface ProductCardImageProps {
  productName: string;
  media: ProductCardMediaPair;
  href: string | null;
  navigationTrackAttrs?: Readonly<Record<string, string>>;
  children?: ReactNode;
}

function ScenePreview({ image, active, productName }: { image: CardImage; active: boolean; productName: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = active && loaded && !failed;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.url} alt={image.altText || productName} aria-hidden data-card-scene="" data-visible={visible ? "true" : "false"}
      onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${visible ? "opacity-100 transition-opacity duration-200 motion-reduce:transition-none" : "opacity-0 transition-none"}`} />
  );
}

export function ProductCardImage({ productName, media, href, navigationTrackAttrs, children }: ProductCardImageProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [requestedUrl, setRequestedUrl] = useState<string | null>(null);
  const scene = media.cover && media.scene?.url !== media.cover.url ? media.scene : null;
  const active = hovered || focused;
  const interaction = {
    onPointerEnter(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      setHovered(true);
      setRequestedUrl(scene?.url ?? null);
    },
    onPointerLeave() { setHovered(false); },
    onFocus(event: FocusEvent<HTMLElement>) {
      if (!event.currentTarget.matches(":focus-visible")) return;
      setFocused(true);
      setRequestedUrl(scene?.url ?? null);
    },
    onBlur() { setFocused(false); },
  };
  const content = <>
    {media.cover ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={media.cover.url} alt={media.cover.altText ?? productName} className="h-full w-full object-contain" loading="lazy" />
    ) : <PlaceholderImage label={productName} className="h-full w-full" />}
    {scene && (active || requestedUrl === scene.url) ? <ScenePreview key={scene.url} image={scene} active={active} productName={productName} /> : null}
    {children}
  </>;
  const className = "relative block aspect-square w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta";
  return href === null
    ? <div className={className} {...interaction}>{content}</div>
    : <Link href={href} prefetch={false} className={className} aria-label={productName} {...navigationTrackAttrs} {...interaction}>{content}</Link>;
}
