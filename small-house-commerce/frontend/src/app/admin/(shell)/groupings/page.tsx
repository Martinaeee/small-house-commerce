"use client";

import { CategoriesPanel } from "@/components/admin/CategoriesPanel";
import { CollectionsPanel } from "@/components/admin/CollectionsPanel";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAdminI18n } from "@/lib/admin-i18n";

/**
 * 商品分组 — one page, both grouping kinds fully manageable (user ruling:
 * "all functions of one page, no tab switching"). Categories and collections
 * remain two data models (single-ownership tree vs many-to-many promos) but
 * the UI presents them as two stacked sections of the same page with anchor
 * jumps, so nothing is managed in "another place" any more.
 */
export default function AdminGroupingsPage() {
  const { t } = useAdminI18n();

  return (
    <div className="flex flex-col gap-8 py-6">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8">
        <PageHeader
          title={t("groupings_title")}
          subtitle={t("groupings_subtitle")}
        />

        {/* Jump links: instant anchor navigation between the two sections */}
        <nav aria-label="分组跳转" className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href="#groupings-categories"
            className="inline-flex items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:text-cta"
          >
            ↓ 分类（商品的固定归属 · 导航菜单）
          </a>
          <a
            href="#groupings-collections"
            className="inline-flex items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:text-cta"
          >
            ↓ 集合（营销专题 · 首页区块/角标）
          </a>
        </nav>
      </div>

      <section id="groupings-categories" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8">
          <h2 className="text-lg font-semibold text-ink">分类</h2>
          <p className="mt-0.5 text-sm text-ink-secondary">
            商品的固定归属（一个商品只属于一个分类），带层级——决定前台导航菜单、面包屑和分类页。
          </p>
        </div>
        <CategoriesPanel />
      </section>

      <section id="groupings-collections" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8">
          <h2 className="text-lg font-semibold text-ink">集合</h2>
          <p className="mt-0.5 text-sm text-ink-secondary">
            营销专题（一个商品可进多个集合）——驱动首页的 New Arrivals / Best
            Sellers 等区块和商品角标，可单独配置页面横幅。
          </p>
        </div>
        <CollectionsPanel />
      </section>
    </div>
  );
}
