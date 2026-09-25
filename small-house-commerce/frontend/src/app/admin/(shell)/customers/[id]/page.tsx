"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { adminApi, type AdminCustomerAddress, type AdminCustomerDetail } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

interface CustomerPageState {
  customerId: string | null;
  customer: AdminCustomerDetail | null;
  errorStatus: number | null;
  failed: boolean;
}

const INITIAL_STATE: CustomerPageState = {
  customerId: null,
  customer: null,
  errorStatus: null,
  failed: false,
};

function formatAddress(address: AdminCustomerAddress): string {
  const city = [address.barangay, address.city].filter(Boolean).join(", ");
  const province = [address.province, address.postalCode]
    .filter(Boolean)
    .join(" ");
  return [city, province].filter(Boolean).join(", ");
}

function CustomerPageSkeleton(): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader title={t("customer_detail_title_fallback")} />
      <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <TableSkeleton rows={4} cols={2} />
      </div>
    </div>
  );
}

function MessageState({ message }: { message: string }): ReactNode {
  return (
    <div role="status" className="mt-6">
      <EmptyState title={message} />
    </div>
  );
}

function CustomerPageContent(): ReactNode {
  const { t, lang } = useAdminI18n();
  const { hasPermission } = useAdminAuth();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const canManage = hasPermission("CUSTOMER_MANAGE");
  const [state, setState] = useState<CustomerPageState>(INITIAL_STATE);

  useEffect(() => {
    if (!canManage) return;
    let active = true;

    void adminApi
      .getCustomer(customerId)
      .then((customer) => {
        if (!active) return;
        setState({
          customerId,
          customer,
          errorStatus: null,
          failed: false,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          customerId,
          customer: null,
          errorStatus: errorStatus(error),
          failed: true,
        });
      });

    return () => {
      active = false;
    };
  }, [canManage, customerId]);

  if (!canManage) {
    return (
      <div className="w-full max-w-none px-4 py-6 md:px-8">
        <PageHeader title={t("customer_detail_title_fallback")} />
        <MessageState message={t("customer_detail_permission_denied")} />
      </div>
    );
  }

  if (state.customerId !== customerId) {
    return <CustomerPageSkeleton />;
  }

  if (state.failed) {
    const message =
      state.errorStatus === 403
        ? t("customer_detail_permission_denied")
        : state.errorStatus === 404
          ? t("customer_detail_not_found")
          : t("customer_detail_error");
    return (
      <div className="w-full max-w-none px-4 py-6 md:px-8">
        <PageHeader title={t("customer_detail_title_fallback")} />
        <MessageState message={message} />
      </div>
    );
  }

  const customer = state.customer;
  if (!customer) return <CustomerPageSkeleton />;
  const createdAt = new Date(customer.createdAt).toLocaleDateString(
    lang === "zh" ? "zh-CN" : "en-PH",
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={customer.name ?? t("customer_detail_title_fallback")}
        subtitle={t("customer_detail_identity")}
      />

      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          {t("customer_detail_identity")}
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t("customer_detail_phone")}
            </dt>
            <dd className="mt-1 text-sm text-ink">{customer.normalizedPhone}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t("customer_detail_email")}
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {customer.email ?? t("common_none")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t("customer_detail_risk")}
            </dt>
            <dd className="mt-1 text-sm text-ink">{customer.currentRiskLevel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t("customer_detail_created")}
            </dt>
            <dd className="mt-1 text-sm text-ink">{createdAt}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-ink">
          {t("customer_detail_addresses")}
        </h2>
        {customer.addresses.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={t("customer_detail_no_addresses")} />
          </div>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {customer.addresses.map((address) => (
              <article
                key={address.id}
                className="rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <h3 className="font-semibold text-ink">{address.fullName}</h3>
                <p className="mt-1 text-sm text-ink-secondary">{address.phone}</p>
                <p className="mt-3 text-sm text-ink">{address.streetAddress}</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {formatAddress(address)}
                </p>
                {address.landmark ? (
                  <p className="mt-1 text-sm text-ink-muted">{address.landmark}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminCustomerPage(): ReactNode {
  return (
    <Suspense fallback={<CustomerPageSkeleton />}>
      <CustomerPageContent />
    </Suspense>
  );
}
