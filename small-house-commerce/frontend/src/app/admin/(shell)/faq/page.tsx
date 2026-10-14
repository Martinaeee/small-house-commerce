"use client";

import { Suspense, type ReactNode } from "react";
import { FaqWorkspace } from "@/components/admin/FaqWorkspace";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";

export default function FaqPage(): ReactNode {
  const { hasPermission } = useAdminAuth();

  return (
    // useSearchParams (filters live in the URL) requires a Suspense boundary
    // for the static-build prerender.
    <Suspense fallback={null}>
      <FaqWorkspace
        canEditShared={hasPermission("PRODUCT_FAQ_SHARED_MANAGE")}
        canEditProducts={hasPermission("PRODUCT_MANAGE")}
      />
    </Suspense>
  );
}
