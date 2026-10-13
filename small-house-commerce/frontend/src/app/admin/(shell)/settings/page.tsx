"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminSiteSettings } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

interface SettingsForm {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
  newsletterBandEnabled: boolean;
  newsletterPopupEnabled: boolean;
  newsletterPopupDelaySeconds: string;
  newsletterOfferTitle: string;
  newsletterOfferBody: string;
  newsletterEyebrow: string;
  newsletterFormTitle: string;
  newsletterEmailPlaceholder: string;
  newsletterConsentText: string;
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
  const delay = Number(values.newsletterPopupDelaySeconds);
  if (
    values.newsletterPopupDelaySeconds.trim() === "" ||
    !Number.isInteger(delay) ||
    delay < 0 ||
    delay > 120
  ) {
    errors.newsletterPopupDelaySeconds = "弹窗延迟需为 0–120 秒的整数。";
  }
  if (values.newsletterOfferTitle.trim().length > 120) {
    errors.newsletterOfferTitle = "优惠标题不能超过 120 个字符。";
  }
  if (values.newsletterOfferBody.trim().length > 500) {
    errors.newsletterOfferBody = "优惠正文不能超过 500 个字符。";
  }
  const eyebrow = values.newsletterEyebrow.trim();
  if (eyebrow.length < 1 || eyebrow.length > 80) {
    errors.newsletterEyebrow = "订阅区小标签需为 1–80 个字符。";
  }
  const formTitle = values.newsletterFormTitle.trim();
  if (formTitle.length < 1 || formTitle.length > 120) {
    errors.newsletterFormTitle = "表单标题需为 1–120 个字符。";
  }
  const placeholder = values.newsletterEmailPlaceholder.trim();
  if (placeholder.length < 1 || placeholder.length > 120) {
    errors.newsletterEmailPlaceholder = "邮箱占位文案需为 1–120 个字符。";
  }
  const consent = values.newsletterConsentText.trim();
  if (consent.length < 1 || consent.length > 500) {
    errors.newsletterConsentText = "同意与退订说明需为 1–500 个字符。";
  }
  return errors;
}

function toForm(row: AdminSiteSettings): SettingsForm {
  return {
    messengerUrl: row.messengerUrl,
    supportEmail: row.supportEmail,
    supportHours: row.supportHours,
    newsletterBandEnabled: row.newsletterBandEnabled,
    newsletterPopupEnabled: row.newsletterPopupEnabled,
    newsletterPopupDelaySeconds: String(row.newsletterPopupDelaySeconds),
    newsletterOfferTitle: row.newsletterOfferTitle,
    newsletterOfferBody: row.newsletterOfferBody,
    newsletterEyebrow: row.newsletterEyebrow,
    newsletterFormTitle: row.newsletterFormTitle,
    newsletterEmailPlaceholder: row.newsletterEmailPlaceholder,
    newsletterConsentText: row.newsletterConsentText,
  };
}

export default function SiteSettingsPage(): ReactNode {
  const { t } = useAdminI18n();
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

  function updateField<K extends keyof SettingsForm>(
    key: K,
    value: SettingsForm[K],
  ): void {
    setData((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

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
        newsletterBandEnabled: data.newsletterBandEnabled,
        newsletterPopupEnabled: data.newsletterPopupEnabled,
        newsletterPopupDelaySeconds: Number(data.newsletterPopupDelaySeconds),
        newsletterOfferTitle: data.newsletterOfferTitle.trim(),
        newsletterOfferBody: data.newsletterOfferBody.trim(),
        newsletterEyebrow: data.newsletterEyebrow.trim(),
        newsletterFormTitle: data.newsletterFormTitle.trim(),
        newsletterEmailPlaceholder: data.newsletterEmailPlaceholder.trim(),
        newsletterConsentText: data.newsletterConsentText.trim(),
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
      <PageHeader
        title={t("settings_title")}
        subtitle={t("settings_subtitle")}
      />

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

            <div className="border-t border-border pt-5">
              <h2 className="text-lg font-semibold text-ink">Newsletter 展示</h2>
              <p className="mt-1 text-sm text-ink-muted">
                这里只控制前台展示。真实优惠码、金额与次数在「邮件订阅」页面管理；没有有效活动时前台不会承诺优惠。
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={data.newsletterBandEnabled}
                onChange={(event) =>
                  updateField("newsletterBandEnabled", event.target.checked)
                }
                className="mt-0.5 h-4 w-4 rounded border-border text-cta"
              />
              <span>
                <span className="font-medium">启用页脚订阅区</span>
                <span className="mt-1 block text-ink-muted">
                  默认开启；关闭后只隐藏页脚 Newsletter 栏，页脚其他内容仍会保留。
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={data.newsletterPopupEnabled}
                onChange={(event) =>
                  updateField("newsletterPopupEnabled", event.target.checked)
                }
                className="mt-0.5 h-4 w-4 rounded border-border text-cta"
              />
              <span>
                <span className="font-medium">启用首访优惠弹窗</span>
                <span className="mt-1 block text-ink-muted">
                  只有当前存在生效中的优惠活动时才会弹出；同一浏览器只显示一次。
                </span>
              </span>
            </label>

            <Field
              label="弹窗延迟（秒）"
              htmlFor="settings-newsletter-delay"
              error={errors.newsletterPopupDelaySeconds}
              hint="访客进入页面后等待 0–120 秒再显示。"
            >
              <TextInput
                id="settings-newsletter-delay"
                type="number"
                min="0"
                max="120"
                step="1"
                value={data.newsletterPopupDelaySeconds}
                onChange={(event) =>
                  updateField("newsletterPopupDelaySeconds", event.target.value)
                }
              />
            </Field>

            <Field
              label="订阅区小标签"
              htmlFor="settings-newsletter-eyebrow"
              error={errors.newsletterEyebrow}
              hint="显示在页脚订阅区和弹窗主标题上方，不受优惠活动状态影响。"
            >
              <TextInput
                id="settings-newsletter-eyebrow"
                value={data.newsletterEyebrow}
                onChange={(event) =>
                  updateField("newsletterEyebrow", event.target.value)
                }
                maxLength={80}
              />
            </Field>

            <Field
              label="表单标题"
              htmlFor="settings-newsletter-form-title"
              error={errors.newsletterFormTitle}
              hint="显示在页脚邮箱表单上方，同时作为订阅弹窗主标题。"
            >
              <TextInput
                id="settings-newsletter-form-title"
                value={data.newsletterFormTitle}
                onChange={(event) =>
                  updateField("newsletterFormTitle", event.target.value)
                }
                maxLength={120}
              />
            </Field>

            <Field
              label="邮箱占位文案"
              htmlFor="settings-newsletter-email-placeholder"
              error={errors.newsletterEmailPlaceholder}
              hint="页脚与弹窗共用的邮箱输入框提示。"
            >
              <TextInput
                id="settings-newsletter-email-placeholder"
                value={data.newsletterEmailPlaceholder}
                onChange={(event) =>
                  updateField("newsletterEmailPlaceholder", event.target.value)
                }
                maxLength={120}
              />
            </Field>

            <Field
              label="同意与退订说明"
              htmlFor="settings-newsletter-consent"
              error={errors.newsletterConsentText}
              hint="显示在页脚与弹窗表单下方；建议明确说明可随时退订。"
            >
              <textarea
                id="settings-newsletter-consent"
                value={data.newsletterConsentText}
                onChange={(event) =>
                  updateField("newsletterConsentText", event.target.value)
                }
                maxLength={500}
                rows={3}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink focus:border-cta focus:outline-none"
              />
            </Field>

            <Field
              label="优惠标题"
              htmlFor="settings-newsletter-title"
              error={errors.newsletterOfferTitle}
              hint="最多 120 个字符；没有有效活动时不会作为优惠承诺展示。"
            >
              <TextInput
                id="settings-newsletter-title"
                value={data.newsletterOfferTitle}
                onChange={(event) =>
                  updateField("newsletterOfferTitle", event.target.value)
                }
                maxLength={120}
              />
            </Field>

            <Field
              label="优惠正文"
              htmlFor="settings-newsletter-body"
              error={errors.newsletterOfferBody}
              hint="最多 500 个字符。"
            >
              <textarea
                id="settings-newsletter-body"
                value={data.newsletterOfferBody}
                onChange={(event) =>
                  updateField("newsletterOfferBody", event.target.value)
                }
                maxLength={500}
                rows={4}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink focus:border-cta focus:outline-none"
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
