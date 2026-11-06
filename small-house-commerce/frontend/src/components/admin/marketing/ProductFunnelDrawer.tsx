"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  funnelApi,
  type FunnelDetail,
  type FunnelDiagnostic,
  type FunnelFilters,
  type FunnelRow,
  type FunnelSession,
} from "@/lib/funnel-api";
import { funnelButton, funnelField, funnelPercent } from "./funnel-display";

const reasons = [
  "VALIDATION",
  "STOCK",
  "NETWORK",
  "SERVER",
  "UNKNOWN",
] as const;
const sourceKeys = ["FACEBOOK_POST", "META_AD", "OTHER", "ORGANIC"] as const;
const customerKeys = [
  "name",
  "phone",
  "province",
  "city",
  "barangay",
  "postalCode",
  "streetAddress",
  "landmark",
  "note",
] as const;
const eventKeys = [
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "CHECKOUT_SUBMIT_ATTEMPT",
  "CHECKOUT_SUBMIT_FAILED",
  "ORDER",
] as const;
const time = (s: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(s));

function Diagnostic({ value }: { value: FunnelDiagnostic }) {
  const { t } = useAdminI18n(),
    [revealed, setRevealed] = useState(false);
  const customer = value.customer;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-admin-border bg-slate-50 p-3 text-xs">
      <div className="flex flex-wrap gap-3">
        <span>
          {t("funnel_step")}: {value.step ? t(`funnel_${value.step}`) : "—"}
        </span>
        <span>
          {t("funnel_retry_number")}: {value.retry ?? "—"}
        </span>
        <span>HTTP: {value.httpStatus ?? "—"}</span>
        {value.field && (
          <span>
            {t("funnel_field")}: {value.field}
          </span>
        )}
      </div>
      {value.reason && (
        <p className="font-medium text-red-700">
          {t(`funnel_reason_${value.reason}`)}
        </p>
      )}
      {value.message && <p className="break-words">{value.message}</p>}
      <p className="break-all text-admin-muted">
        {t("funnel_attempt_id")}: {value.attemptId ?? "—"}
      </p>
      {value.skuIds?.length ? (
        <div>
          <p className="font-medium">{t("funnel_basket")}</p>
          <ul>
            {value.skuIds.map((id, i) => (
              <li key={`${id}-${i}`} className="break-all">
                {id} · {value.variantNames?.[i] ?? ""} ×{" "}
                {value.quantities?.[i] ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {customer && (
        <>
          <p className="font-medium">{t("funnel_customer")}</p>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            {customerKeys
              .filter((k) => customer[k])
              .map((k) => (
                <div key={k} className="contents">
                  <dt className="text-admin-muted">
                    {t(`funnel_customer_${k}`)}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {revealed || k === "province" || k === "city"
                      ? customer[k]
                      : k === "phone"
                        ? `***${customer[k]!.slice(-4)}`
                        : "***"}
                  </dd>
                </div>
              ))}
          </dl>
        </>
      )}
      {(customer || value.idempotencyKey) && (
        <>
          <p className="text-admin-muted">{t("funnel_private_hint")}</p>
          <button
            className={funnelButton}
            onClick={() => setRevealed((v) => !v)}
          >
            {t(revealed ? "funnel_hide" : "funnel_reveal")}
          </button>
          {revealed && (
            <div>
              <p className="font-medium">{t("funnel_key")}</p>
              <p className="break-all">
                {value.idempotencyKey || t("funnel_key_absent")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function ProductFunnelDrawer({
  row,
  filters,
  onClose,
}: {
  row: FunnelRow;
  filters: FunnelFilters;
  onClose: () => void;
}) {
  const { t } = useAdminI18n();
  const [tab, setTab] = useState<"steps" | "reasons" | "sessions">("steps");
  const [detail, setDetail] = useState<FunnelDetail | null>(null),
    [detailError, setDetailError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState({
    reason: "",
    device: "",
    source: "",
    onlyFailures: false,
  });
  const [sessions, setSessions] = useState<{
      key: string;
      items: FunnelSession[];
      nextCursor: string | null;
    } | null>(null),
    [sessionError, setSessionError] = useState<string | null>(null),
    [moreBusy, setMoreBusy] = useState(false);
  const panel = useRef<HTMLElement>(null),
    close = useRef(onClose);
  const filterJSON = JSON.stringify(filters),
    sessionKey = JSON.stringify([filters, selection, revision]);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null,
      previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,summary,[href]",
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keydown);
      trigger?.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    funnelApi
      .detail(row.productId, JSON.parse(filterJSON))
      .then((data) => {
        if (alive) {
          setDetail(data);
          setDetailError(null);
        }
      })
      .catch((e) => {
        if (alive) setDetailError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [row.productId, filterJSON, revision]);
  const sessionQuery = {
    ...filters,
    productId: row.productId,
    reason: selection.reason || undefined,
    device: selection.device || undefined,
    source: selection.source || undefined,
    onlyFailures: String(selection.onlyFailures),
  };
  const sessionJSON = JSON.stringify(sessionQuery);
  useEffect(() => {
    if (tab !== "sessions") return;
    let alive = true;
    funnelApi
      .sessions(JSON.parse(sessionJSON))
      .then((data) => {
        if (alive) {
          setSessions({ key: sessionKey, ...data });
          setSessionError(null);
        }
      })
      .catch((e) => {
        if (alive) setSessionError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [tab, sessionKey, sessionJSON]);
  async function loadMore() {
    if (!sessions?.nextCursor || moreBusy) return;
    const previous = sessions;
    setMoreBusy(true);
    try {
      const next = await funnelApi.sessions({
        ...sessionQuery,
        cursor: previous.nextCursor!,
      });
      setSessions((current) =>
        current?.key === previous.key
          ? {
              key: previous.key,
              items: [
                ...current.items,
                ...next.items.filter(
                  (n) =>
                    !current.items.some((c) => c.sessionId === n.sessionId),
                ),
              ],
              nextCursor: next.nextCursor,
            }
          : current,
      );
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoreBusy(false);
    }
  }
  const display = sessions?.key === sessionKey ? sessions : null;
  const label = (prefix: "source" | "device", v: string) =>
    t(`funnel_${prefix}_${v}` as TKey);
  const breakdown = (key: "devices" | "sources" | "messages") => (
    <section key={key} className="space-y-2">
      <h3 className="font-semibold">
        {t(
          key === "devices"
            ? "funnel_device"
            : key === "sources"
              ? "funnel_source"
              : "funnel_messages",
        )}
      </h3>
      <ul className="space-y-1">
        {detail?.[key].map((item) => (
          <li
            key={item.label}
            className="flex items-start justify-between gap-3 border-b border-admin-border py-2 text-sm"
          >
            <span className="min-w-0 break-words">
              {key === "messages"
                ? item.label
                : label(key === "devices" ? "device" : "source", item.label)}
            </span>
            <span>{item.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40"
        aria-hidden
        onClick={onClose}
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={row.productName}
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-admin-border bg-white p-4 shadow-xl sm:w-[min(70rem,92vw)] sm:p-6"
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{row.productName}</h2>
            <p className="text-xs text-admin-muted">
              {filters.from} – {filters.to} · Asia/Manila
            </p>
          </div>
          <button className={funnelButton} onClick={onClose}>
            {t("funnel_close")}
          </button>
        </header>
        <div
          className="my-4 flex gap-1 overflow-x-auto border-b border-admin-border"
          role="tablist"
        >
          {(["steps", "reasons", "sessions"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              aria-controls={`funnel-panel-${v}`}
              id={`funnel-tab-${v}`}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${tab === v ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`}
              onClick={() => setTab(v)}
            >
              {t(`funnel_${v}`)}
            </button>
          ))}
        </div>
        <section
          role="tabpanel"
          id={`funnel-panel-${tab}`}
          aria-labelledby={`funnel-tab-${tab}`}
        >
          {tab !== "sessions" &&
            (detailError ? (
              <p role="alert">
                {detailError}
                <button
                  className={funnelButton}
                  onClick={() => setRevision((v) => v + 1)}
                >
                  {t("funnel_retry")}
                </button>
              </p>
            ) : !detail ? (
              <p role="status">{t("funnel_loading")}</p>
            ) : tab === "steps" ? (
              <div className="space-y-5">
                <p className="text-xs text-admin-muted">
                  {t("funnel_baseline")}: {detail.baselineFrom} –{" "}
                  {detail.baselineTo}
                </p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">{t("funnel_step")}</th>
                      <th>{t("funnel_current")}</th>
                      <th>{t("funnel_baseline")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.product.steps.map((step) => (
                      <tr
                        key={step.key}
                        className="border-t border-admin-border"
                      >
                        <th className="p-2 text-left font-normal">
                          {t(`funnel_step_${step.key}`)}
                        </th>
                        <td
                          className={
                            step.flagged ? "font-semibold text-red-700" : ""
                          }
                        >
                          {step.flagged ? "! " : ""}
                          {funnelPercent(step.rate)}{" "}
                          <span className="text-xs text-admin-muted">
                            ({step.hits}/{step.base})
                          </span>
                        </td>
                        <td>
                          {funnelPercent(step.baselineRate)}
                          {step.sampleSmall && (
                            <span className="block text-xs text-admin-muted">
                              {t("funnel_sample")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="font-semibold">{t("funnel_daily")}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr>
                        <th className="p-2 text-left">{t("funnel_day")}</th>
                        {(
                          [
                            "visits",
                            "views",
                            "addToCarts",
                            "checkouts",
                            "attempts",
                            "failures",
                            "orders",
                          ] as const
                        ).map((c) => (
                          <th key={c} className="whitespace-nowrap p-2">
                            {t(`funnel_${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.daily.map((d) => (
                        <tr
                          key={d.day}
                          className="border-t border-admin-border"
                        >
                          <th className="whitespace-nowrap p-2 text-left font-normal">
                            {d.day}
                          </th>
                          {(
                            [
                              "visits",
                              "views",
                              "addToCarts",
                              "checkouts",
                              "attempts",
                              "failures",
                              "orders",
                            ] as const
                          ).map((c) => (
                            <td key={c} className="p-2">
                              {d[c]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-xs text-admin-muted">
                  {t("funnel_reason_note")}
                </p>
                <table className="w-full text-left text-sm">
                  <tbody>
                    {reasons.map((reason) => {
                      const n = detail.product.failureReasons[reason] ?? 0;
                      return (
                        <tr
                          key={reason}
                          className="border-b border-admin-border"
                        >
                          <th className="p-2 text-left font-normal">
                            {t(`funnel_reason_${reason}`)}
                          </th>
                          <td>{n}</td>
                          <td>
                            {funnelPercent(
                              detail.product.failures
                                ? n / detail.product.failures
                                : null,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {breakdown("devices")}
                {breakdown("sources")}
                {breakdown("messages")}
              </div>
            ))}
          {tab === "sessions" && (
            <div className="space-y-3" key={sessionKey}>
              <div className="flex flex-wrap items-end gap-2">
                {(["reason", "device", "source"] as const).map((filter) => (
                  <label
                    key={filter}
                    className="grid gap-1 text-xs text-admin-muted"
                  >
                    {t(`funnel_${filter}`)}
                    <select
                      className={`${funnelField} max-w-48`}
                      value={selection[filter]}
                      onChange={(e) =>
                        setSelection((v) => ({
                          ...v,
                          [filter]: e.target.value,
                        }))
                      }
                    >
                      <option value="">{t("funnel_all")}</option>
                      {filter === "reason"
                        ? reasons.map((v) => (
                            <option key={v} value={v}>
                              {t(`funnel_reason_${v}`)}
                            </option>
                          ))
                        : filter === "source"
                          ? sourceKeys.map((v) => (
                              <option key={v} value={v}>
                                {t(`funnel_source_${v}`)}
                              </option>
                            ))
                          : (["mobile", "tablet", "desktop"] as const).map(
                              (v) => (
                                <option key={v} value={v}>
                                  {t(`funnel_device_${v}`)}
                                </option>
                              ),
                            )}
                    </select>
                  </label>
                ))}
                <label className="flex items-center gap-2 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selection.onlyFailures}
                    onChange={(e) =>
                      setSelection((v) => ({
                        ...v,
                        onlyFailures: e.target.checked,
                      }))
                    }
                  />
                  {t("funnel_only_failures")}
                </label>
              </div>
              {sessionError && (
                <p role="alert">
                  {sessionError}
                  <button
                    className={funnelButton}
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    {t("funnel_retry")}
                  </button>
                </p>
              )}
              {!display && !sessionError ? (
                <p role="status">{t("funnel_loading")}</p>
              ) : display?.items.length ? (
                display.items.map((s) => (
                  <details
                    key={s.sessionId}
                    className="rounded-lg border border-admin-border p-3"
                  >
                    <summary className="cursor-pointer">
                      <span className="font-medium">{s.sessionId}</span>
                      <span className="ml-3 text-xs text-admin-muted">
                        {label("device", s.device)} ·{" "}
                        {label("source", s.source)} · {time(s.startedAt)}
                      </span>
                      <p className="break-all pt-1 text-xs text-admin-muted">
                        {s.entryPath}
                      </p>
                    </summary>
                    <ol className="ml-2 mt-3 space-y-3 border-l border-admin-border pl-4">
                      {s.events.map((e, i) => (
                        <li key={`${s.sessionId}-${i}`}>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <time className="text-admin-muted">
                              {time(e.at)}
                            </time>
                            <strong>
                              {eventKeys.includes(
                                e.eventName as (typeof eventKeys)[number],
                              )
                                ? t(`funnel_event_${e.eventName}` as TKey)
                                : e.eventName}
                            </strong>
                            <span className="break-all text-admin-muted">
                              {e.pagePath}
                            </span>
                          </div>
                          {e.diagnostic && <Diagnostic value={e.diagnostic} />}
                        </li>
                      ))}
                    </ol>
                  </details>
                ))
              ) : (
                <p className="p-4 text-center text-admin-muted">
                  {t("funnel_empty")}
                </p>
              )}
              {display?.nextCursor && (
                <button
                  className={funnelButton}
                  disabled={moreBusy}
                  onClick={() => void loadMore()}
                >
                  {t("funnel_more")}
                </button>
              )}
            </div>
          )}
        </section>
      </aside>
    </>
  );
}
