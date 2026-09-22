"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useAuth } from "@/components/auth/AuthProvider";
import { customerApi, type AccountOrder } from "@/lib/auth";
import { formatOrderOptionsFromSnapshot } from "@/lib/order-options";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

// Backend storefront default page size for the orders endpoint.
const ORDERS_PAGE_SIZE = 10;

const STATUS_LABELS: Record<string, string> = {
  NEW: "Order received",
  PENDING: "Pending",
  QUESTION: "Needs confirmation",
  CONFIRMED: "Confirmed",
  ABNORMAL: "Review needed",
  SHIPPING: "Shipping",
  SIGNED: "Delivered",
  CANCELLED: "Cancelled",
  DENIED: "Denied",
  AFTER_SALES: "After sales",
};

function OrdersPanel() {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    customerApi
      .listOrders(1)
      .then((page) => {
        if (alive) setOrders(page.items);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load orders");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Plain click handler (not an effect): append the next page on demand.
  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await customerApi.listOrders(page + 1);
      setOrders((prev) => [...(prev ?? []), ...next.items]);
      setPage(page + 1);
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : "Could not load more orders");
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) {
    return <p className="text-sm text-red-600" role="alert">{error}</p>;
  }
  if (!orders) {
    return <p className="text-sm text-ink-muted">Loading your orders…</p>;
  }
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-ink-secondary">No orders yet.</p>
        <Link href="/collections" className="mt-2 inline-block text-sm text-cta hover:underline">
          Start shopping
        </Link>
      </div>
    );
  }

  // Only a full final page can have a successor; a short page hides the
  // pager permanently (orders.length === fetched pages * page size).
  const hasMore = orders.length === page * ORDERS_PAGE_SIZE;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <li key={order.orderNumber}>
            <Link
              href={`/order-success/${order.orderNumber}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 hover:border-primary"
            >
              <div>
                <p className="font-semibold text-ink">{order.orderNumber}</p>
                <p className="text-xs text-ink-muted">
                  {new Date(order.createdAt).toLocaleDateString("en-PH", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  {" · "}
                  {order.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)
                  {" · "}
                  {STATUS_LABELS[order.orderStatus] ?? order.orderStatus}
                </p>
                {/* The order-time option snapshot is what the shopper actually
                    bought — shown verbatim; the legacy variant text covers
                    lines created before typed options. */}
                {order.items.map((item, index) => {
                  const optionsText = formatOrderOptionsFromSnapshot(
                    item.optionSnapshot,
                    item.variantSnapshot,
                  );
                  return (
                    <p
                      key={index}
                      className="mt-1 truncate text-xs text-ink-muted"
                    >
                      {item.quantity} × {item.productNameSnapshot}
                      {optionsText ? ` — ${optionsText}` : ""}
                    </p>
                  );
                })}
              </div>
              <span className="font-semibold text-ink">{formatPrice(order.grandTotal)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button size="md" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
          {moreError && (
            <p className="text-sm text-red-600" role="alert">
              {moreError}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export default function AccountPage() {
  const { status, account, saveProfile, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Account the form fields were last seeded from. React's documented
  // "adjust state while rendering" pattern (the repo's react-hooks config
  // rejects setState-in-effect); the adjustment happens before commit, so
  // there is no flash of empty fields when the session resolves.
  const [seedAccount, setSeedAccount] = useState<typeof account>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Render-phase redirect would fight hydration; gate after mount instead.
  useEffect(() => {
    if (status === "guest") router.replace("/login?next=/account");
  }, [status, router]);

  if (account && account !== seedAccount) {
    setSeedAccount(account);
    setName(account.name);
    setPhone(account.phone ?? "");
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const input = {
        ...(name.trim() !== account?.name ? { name: name.trim() } : {}),
        ...(phone.trim() && phone.trim() !== account?.phone ? { phone: phone.trim() } : {}),
      };
      if (Object.keys(input).length === 0) {
        setPending(false);
        return;
      }
      await saveProfile(input);
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  if (status === "loading" || status === "guest") {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-sm text-ink-muted">
        Loading your account…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">My account</h1>
        <Button
          variant="secondary"
          size="md"
          onClick={async () => {
            await logout();
            router.push("/");
          }}
        >
          Log out
        </Button>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-ink">Profile</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={onSaveProfile}>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Full name
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Email
            <input className={inputCls} value={account?.email ?? ""} disabled />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Mobile number
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0917 123 4567"
              inputMode="tel"
              autoComplete="tel"
            />
            <span className="text-xs font-normal text-ink-muted">
              Add the number you use for COD orders to see their history here.
            </span>
          </label>
          {message && <p className="text-sm text-cta">{message}</p>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div>
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">My orders</h2>
        <OrdersPanel />
      </section>
    </div>
  );
}
