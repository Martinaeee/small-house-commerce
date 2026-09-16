"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { adminApi, type AdminSiteSettings } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

interface SettingsForm {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}

type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Same rules as the backend Zod schema (backend trims before validating). */
function validateSettings(values: SettingsForm): SettingsErrors {
  const errors: SettingsErrors = {};
  const messengerUrl = values.messengerUrl.trim();
  if (
    messengerUrl.length > 500 ||
    (messengerUrl !== "" &&
      !(messengerUrl.startsWith("https://") && isHttpsUrl(messengerUrl)))
  ) {
    errors.messengerUrl =
      "Messenger 链接需留空，或以 https:// 开头的有效网址（不超过 500 个字符）。";
  }
  const email = values.supportEmail.trim();
  if (email.length === 0 || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.supportEmail = "请输入有效的客服邮箱（不超过 200 个字符）。";
  }
  const hours = values.supportHours.trim();
  if (hours.length < 1 || hours.length > 100) {
    errors.supportHours = "服务时间需为 1–100 个字符。";
  }
  return errors;
}

function toForm(row: AdminSiteSettings): SettingsForm {
  return {
    messengerUrl: row.messengerUrl,
    supportEmail: row.supportEmail,
    supportHours: row.supportHours,
  };
}

export default function SiteSettingsPage(): ReactNode {
  const [data, setData] = useState<SettingsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .getSettings()
      .then((row) => {
        if (!active) return;
        setData(toForm(row));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(
          errorStatus(err) === 403
            ? "没有系统设置权限。"
            : err instanceof Error
              ? err.message
              : "无法加载站点设置。",
        );
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const updateField = (key: keyof SettingsForm, value: string): void => {
    setData((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!data || pending) return;
    const found = validateSettings(data);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setPending(true);
    setError(null);
    setSaved(false);
    adminApi
      .updateSettings({
        messengerUrl: data.messengerUrl.trim(),
        supportEmail: data.supportEmail.trim(),
        supportHours: data.supportHours.trim(),
      })
      .then((row) => {
        setData(toForm(row));
        setSaved(true);
        setPending(false);
      })
      .catch((err: unknown) => {
        setError(
          errorStatus(err) === 403
            ? "没有系统设置权限。"
            : err instanceof Error
              ? err.message
              : "保存失败，请重试。",
        );
        setPending(false);
      });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader title="站点设置" />

      {loadError ? (
        <div role="alert" className="mt-4 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-ink">无法加载站点设置。</p>
          <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setLoadError(null);
              setNonce((n) => n + 1);
            }}
            className="mt-4"
          >
            重试
          </Button>
        </div>
      ) : data === null ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl border border-border bg-card" aria-hidden />
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mt-4 max-w-2xl rounded-xl border border-border bg-card p-6"
        >
          <div className="flex flex-col gap-5">
            <Field
              label="Messenger 链接"
              htmlFor="settings-messenger-url"
              error={errors.messengerUrl}
              hint={
                <>
                  留空则全站隐藏 Messenger 客服入口；需以 https:// 开头，例如
                  <span className="font-mono"> https://m.me/luwag</span>
                </>
              }
            >
              <TextInput
                id="settings-messenger-url"
                value={data.messengerUrl}
                onChange={(e) => updateField("messengerUrl", e.target.value)}
                placeholder="https://m.me/luwag"
                autoComplete="off"
              />
            </Field>

            <Field
              label="客服邮箱"
              htmlFor="settings-support-email"
              error={errors.supportEmail}
              hint="显示在结账页、页脚与产品详情页。"
            >
              <TextInput
                id="settings-support-email"
                type="email"
                value={data.supportEmail}
                onChange={(e) => updateField("supportEmail", e.target.value)}
                autoComplete="off"
              />
            </Field>

            <Field
              label="服务时间"
              htmlFor="settings-support-hours"
              error={errors.supportHours}
              hint="显示在结账页与页脚，例如 Mon–Sat, 9am–6pm (PHT)。"
            >
              <TextInput
                id="settings-support-hours"
                value={data.supportHours}
                onChange={(e) => updateField("supportHours", e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "保存中…" : "保存设置"}
            </Button>
            {saved ? (
              <p role="status" data-testid="settings-saved" className="text-sm font-medium text-cta">
                已保存
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
