"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Categories and collections now share one admin page (/admin/groupings).
 * This legacy route redirects so old bookmarks/links keep working.
 */
export default function AdminCollectionsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/groupings?tab=collections");
  }, [router]);
  return null;
}
