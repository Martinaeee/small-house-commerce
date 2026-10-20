import type { ReactNode } from "react";
import type { ProductFaqAnswerBlock, ProductFaqItem } from "@/lib/api";

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function safeLinkTarget(value: string): string | null {
  return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : null;
}

function renderInline(
  text: string,
  supportEmail?: string,
  supportHours?: string,
): ReactNode[] {
  const token = /\{\{(supportEmail|supportHours)\}\}|\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    if (match[1] === "supportEmail" && supportEmail) {
      nodes.push(
        <a
          key={`${match.index}:email`}
          href={`mailto:${supportEmail}`}
          className="font-medium text-cta underline-offset-2 hover:underline"
        >
          {supportEmail}
        </a>,
      );
    } else if (match[1] === "supportHours" && supportHours) {
      nodes.push(supportHours);
    } else if (match[2] && match[3]) {
      const href = safeLinkTarget(match[3]);
      nodes.push(
        href ? (
          <a
            key={`${match.index}:link`}
            href={href}
            className="font-medium text-cta underline-offset-2 hover:underline"
          >
            {match[2]}
          </a>
        ) : (
          match[2]
        ),
      );
    } else {
      nodes.push(match[0]);
    }
    cursor = token.lastIndex;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function AnswerBlock({
  block,
  supportEmail,
  supportHours,
}: {
  block: ProductFaqAnswerBlock;
  supportEmail?: string;
  supportHours?: string;
}): ReactNode {
  if (block.kind === "paragraph") {
    return (
      <p>
        {renderInline(block.text, supportEmail, supportHours)}
      </p>
    );
  }

  return (
    <ul className="flex list-disc flex-col gap-2 pl-4">
      {block.items.map((item, index) => (
        <li key={`${index}:${item}`}>
          {renderInline(item, supportEmail, supportHours)}
        </li>
      ))}
    </ul>
  );
}

export function hasFaqContent(items: ProductFaqItem[]): boolean {
  return items.some((item) => item.enabled);
}

/**
 * Renders one FAQ answer. Shared by the landing-page FAQ accordion and the PDP
 * Q&A tab so both apply the same inline-link and support-placeholder rules.
 */
export function ProductFaqAnswer({
  blocks,
  supportEmail,
  supportHours,
  idPrefix,
}: {
  blocks: ProductFaqItem["answer"];
  supportEmail?: string;
  supportHours?: string;
  idPrefix?: string;
}): ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <AnswerBlock
          key={`${idPrefix ?? "faq"}:${index}`}
          block={block}
          supportEmail={supportEmail}
          supportHours={supportHours}
        />
      ))}
    </>
  );
}

export function ProductFaqSection({
  items,
  supportEmail,
  supportHours,
}: {
  items: ProductFaqItem[];
  supportEmail?: string;
  supportHours?: string;
}): ReactNode {
  const visibleItems = items
    .filter((item) => item.enabled)
    .sort((left, right) => left.position - right.position);

  if (visibleItems.length === 0) return null;

  return (
    <section
      id="shipping-faq"
      aria-labelledby="shipping-faq-title"
      className="scroll-mt-28 overflow-hidden rounded-lg border border-border bg-card"
    >
      <h2
        id="shipping-faq-title"
        className="border-b border-border px-5 py-4 text-2xl font-semibold text-ink"
      >
        Delivery, Returns &amp; FAQs
      </h2>
      {visibleItems.map((item) => (
        <details
          key={item.id}
          role="group"
          open={item.defaultOpen}
          className="group border-b border-border px-5 last:border-0"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {item.title}
            <Chevron />
          </summary>
          <div className="pb-5 text-sm leading-relaxed text-ink-secondary">
            <ProductFaqAnswer
              blocks={item.answer}
              idPrefix={item.id}
              supportEmail={supportEmail}
              supportHours={supportHours}
            />
          </div>
        </details>
      ))}
    </section>
  );
}
