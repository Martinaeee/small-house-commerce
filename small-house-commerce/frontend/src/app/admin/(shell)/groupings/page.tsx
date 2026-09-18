"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CategoriesPanel } from "@/components/admin/CategoriesPanel";
import { CollectionsPanel } from "@/components/admin/CollectionsPanel";

/**
 * Categories and collections in one admin page (user ruling: merge the two
 * entries — same "group products" mental model). Tab is URL-driven so the
 * active tab survives reloads.
 */
function GroupingsTabs() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tab = searchParams.get("tab") === "collections" ? "collections" : "categories";

  const tabCls = (active: boolean) =>
    `inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
      active ? "bg-cta text-white" : "border border-border bg-card text-ink-secondary hover:text-cta"
    }`;

  return (
    <div>
      <div className="flex items-center gap-2" role="tablist" aria-label="Grouping tabs">
        <Link role="tab" aria-selected={tab === "categories"} href={`${pathname}?tab=categories`} className={tabCls(tab === "categories")}>
          分类
        </Link>
        <Link role="tab" aria-selected={tab === "collections"} href={`${pathname}?tab=collections`} className={tabCls(tab === "collections")}>
          集合
        </Link>
      </div>

      <div className="mt-4">
        {tab === "categories" ? (
          <Suspense fallback={null}>
            <CategoriesPanel />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <CollectionsPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default function AdminGroupingsPage() {
  return (
    <Suspense fallback={null}>
      <GroupingsTabs />
    </Suspense>
  );
}
