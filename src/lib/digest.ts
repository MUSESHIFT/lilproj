import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DigestInvoice {
  sender: string;
  amount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  date: string;
  subject: string;
}

export interface DigestPayment {
  sender: string;
  amount: number | null;
  currency: string | null;
  date: string;
  subject: string;
}

export interface DigestDiscrepancy {
  type: string;
  description: string;
  amountDiff: number | null;
}

export interface DigestSummary {
  totalInvoiced: number;
  totalPaid: number;
  outstandingBalance: number;
  invoiceCount: number;
  paymentCount: number;
  discrepancyCount: number;
  currency: string;
}

export interface DigestData {
  dateRange: { start: string; end: string };
  generatedAt: string;
  summary: DigestSummary;
  invoices: DigestInvoice[];
  payments: DigestPayment[];
  discrepancies: DigestDiscrepancy[];
}

// ─── Session helper ──────────────────────────────────────────────────────────

const SESSION_COOKIE = "is_session";

async function getUserIdFromSession(): Promise<string | null> {
  const { getCookie } = await import("@tanstack/react-start/server");
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')",
    )
    .get(token) as { user_id: string } | undefined;

  return row?.user_id ?? null;
}

// ─── Helper: extract most-used currency ──────────────────────────────────────

function dominantCurrency(
  items: { currency: string | null }[],
): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const cur = (item.currency || "USD").toUpperCase();
    counts[cur] = (counts[cur] || 0) + 1;
  }
  let best = "USD";
  let bestCount = 0;
  for (const [cur, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = cur;
      bestCount = count;
    }
  }
  return best;
}

// ─── Digest generator (server function) ─────────────────────────────────────

export const generateDigest = createServerFn({ method: "GET" }).handler(
  async (): Promise<DigestData | { error: string }> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { error: "Not authenticated" };

    const db = getDb();

    // Date range: last 7 days
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch processed invoices from the last 7 days
    const invoiceRows = db
      .prepare(
        `SELECT id, subject, sender, date, snippet,
                classified_as, extracted_amount, extracted_currency,
                extracted_invoice_number, extracted_due_date, extracted_sender_name
         FROM emails
         WHERE user_id = ?
           AND processed = 1
           AND classified_as = 'invoice'
           AND created_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(userId, startDate) as {
      id: string;
      subject: string;
      sender: string;
      date: string;
      extracted_amount: number | null;
      extracted_currency: string | null;
      extracted_invoice_number: string | null;
      extracted_due_date: string | null;
      extracted_sender_name: string | null;
    }[];

    // Fetch processed payments from the last 7 days
    const paymentRows = db
      .prepare(
        `SELECT id, subject, sender, date,
                classified_as, extracted_amount, extracted_currency
         FROM emails
         WHERE user_id = ?
           AND processed = 1
           AND classified_as = 'payment_received'
           AND created_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(userId, startDate) as {
      id: string;
      subject: string;
      sender: string;
      date: string;
      extracted_amount: number | null;
      extracted_currency: string | null;
    }[];

    // Fetch discrepancies from the last 7 days
    const discrepancyRows = db
      .prepare(
        `SELECT type, description, amount_diff
         FROM discrepancies
         WHERE user_id = ?
           AND created_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(userId, startDate) as {
      type: string;
      description: string;
      amount_diff: number | null;
    }[];

    // Build invoice list
    const invoices: DigestInvoice[] = invoiceRows.map((r) => ({
      sender: r.extracted_sender_name || r.sender,
      amount: r.extracted_amount,
      currency: r.extracted_currency,
      invoiceNumber: r.extracted_invoice_number,
      dueDate: r.extracted_due_date,
      date: r.date,
      subject: r.subject,
    }));

    // Build payment list
    const payments: DigestPayment[] = paymentRows.map((r) => ({
      sender: r.sender,
      amount: r.extracted_amount,
      currency: r.extracted_currency,
      date: r.date,
      subject: r.subject,
    }));

    // Build discrepancy list
    const discrepancies: DigestDiscrepancy[] = discrepancyRows.map((r) => ({
      type: r.type,
      description: r.description,
      amountDiff: r.amount_diff,
    }));

    // Calculate totals
    const totalInvoiced = invoices.reduce(
      (sum, inv) => sum + (inv.amount || 0),
      0,
    );
    const totalPaid = payments.reduce(
      (sum, pay) => sum + (pay.amount || 0),
      0,
    );
    const outstandingBalance = totalInvoiced - totalPaid;

    // Determine dominant currency
    const allAmountItems = [
      ...invoices.map((i) => ({ currency: i.currency })),
      ...payments.map((p) => ({ currency: p.currency })),
    ];
    const currency = dominantCurrency(allAmountItems);

    const summary: DigestSummary = {
      totalInvoiced,
      totalPaid,
      outstandingBalance,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      discrepancyCount: discrepancies.length,
      currency,
    };

    return {
      dateRange: {
        start: startDate.split("T")[0],
        end: endDate.split("T")[0],
      },
      generatedAt: new Date().toISOString(),
      summary,
      invoices,
      payments,
      discrepancies,
    };
  },
);

// ─── Email formatting helpers ────────────────────────────────────────────────

function formatCurrency(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${currency} ${amount.toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Convert a digest to a plain-text email body.
 * money rundown voice: lowercase-leaning, calm, no alarm. flags "worth a look",
 * never accuses.
 */
export function formatDigestAsText(digest: DigestData): string {
  const { dateRange, summary, invoices, payments, discrepancies } = digest;

  // "overdue" items live in the same discrepancies list; split them out so the
  // remaining items render under "worth a look" (mismatches, duplicates, etc.).
  const overdue = discrepancies.filter((d) => d.type === "overdue");
  const worthALook = discrepancies.filter((d) => d.type !== "overdue");

  const lines: string[] = [];

  // 1. header / date anchor
  lines.push(`money rundown · week of ${dateRange.start}`);
  lines.push("here's where your money is.");
  lines.push("");

  // 2. what arrived (paid)
  lines.push("what arrived");
  lines.push("");
  if (payments.length === 0) {
    lines.push("  nothing arrived this week.");
  } else {
    for (const pay of payments) {
      const amt = formatCurrency(pay.amount, pay.currency || summary.currency);
      const sender = pay.sender || "unknown";
      lines.push(`  ${sender} · ${amt} · received ${formatDate(pay.date)}`);
    }
  }
  lines.push("");

  // 3. what you're owed (outstanding)
  lines.push("what you're owed");
  lines.push("");
  if (invoices.length === 0) {
    lines.push("  nothing outstanding this week.");
  } else {
    for (const inv of invoices) {
      const num = inv.invoiceNumber ? ` · #${inv.invoiceNumber}` : "";
      const amt = formatCurrency(inv.amount, inv.currency || summary.currency);
      const sender = inv.sender || "unknown";
      const due = inv.dueDate ? ` · due ${inv.dueDate}` : "";
      lines.push(`  ${sender} · ${amt} · sent ${formatDate(inv.date)}${due}${num}`);
    }
    lines.push("");
    lines.push(
      `  you have ${formatCurrency(summary.outstandingBalance, summary.currency)} outstanding across ${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? "" : "s"}.`,
    );
  }
  lines.push("");

  // 4. overdue
  lines.push("overdue");
  lines.push("");
  if (overdue.length === 0) {
    lines.push("  nothing overdue this week.");
  } else {
    for (const d of overdue) {
      lines.push(`  ${d.description}`);
      if (d.amountDiff !== null) {
        lines.push(
          `    amount: ${summary.currency} ${d.amountDiff.toFixed(2)}`,
        );
      }
    }
  }
  lines.push("");

  // 5. worth a look (flagged)
  lines.push("worth a look");
  lines.push("");
  if (worthALook.length === 0) {
    lines.push("  nothing flagged this week.");
  } else {
    for (const d of worthALook) {
      // NOTE: d.description strings can read accusatory — they originate in
      // reconciliation.ts. softening them there is a follow-up; the framing
      // around them here stays calm.
      lines.push(`  worth a look · ${d.description}`);
      if (d.amountDiff !== null) {
        lines.push(
          `    the numbers were off by ${summary.currency} ${d.amountDiff.toFixed(2)}.`,
        );
      }
    }
    lines.push("");
    lines.push(
      "  this doesn't mean something's wrong. it means the numbers didn't match cleanly.",
    );
  }
  lines.push("");

  // 6. weekly snapshot
  lines.push("this week");
  lines.push("");
  lines.push(
    `  paid · ${formatCurrency(summary.totalPaid, summary.currency)}`,
  );
  lines.push(`  outstanding · ${summary.invoiceCount}`);
  lines.push(`  overdue · ${overdue.length}`);
  lines.push(`  flagged · ${worthALook.length}`);
  lines.push("");

  // 7. footer / controls
  lines.push("─────────────────────────────");
  lines.push("money rundown reads your gmail · read-only, always");
  lines.push("your data doesn't train anything · deletes on cancel");
  lines.push("adjust settings · change tier · pause digest · cancel");

  return lines.join("\n");
}

/**
 * Convert a digest to a simple HTML email body.
 * money rundown voice: calm, lowercase-leaning, no alarm. flags "worth a look",
 * never accuses.
 */
export function formatDigestAsHtml(digest: DigestData): string {
  const { dateRange, summary, invoices, payments, discrepancies } = digest;

  // "overdue" items share the discrepancies list; split them out so the rest
  // render under "worth a look" (mismatches, duplicates, unmatched charges).
  const overdue = discrepancies.filter((d) => d.type === "overdue");
  const worthALook = discrepancies.filter((d) => d.type !== "overdue");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1f2937; line-height: 1.6;">
  <!-- 1. header / date anchor -->
  <div style="padding: 24px 0; border-bottom: 1px solid #e5e7eb;">
    <h1 style="font-size: 18px; color: #374151; margin: 0; font-weight: 600;">money rundown · week of ${dateRange.start}</h1>
    <p style="color: #6b7280; margin: 8px 0 0; font-size: 15px;">
      here's where your money is.
    </p>
  </div>

  <!-- 2. what arrived -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 15px; margin: 0 0 12px; color: #374151; font-weight: 600;">what arrived</h2>
    ${payments.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">nothing arrived this week.</p>'
      : payments.map((pay) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 14px;">${pay.sender || "unknown"}</strong>
            <span style="font-weight: 600; color: #374151;">${formatCurrency(pay.amount, pay.currency || summary.currency)}</span>
          </div>
          <p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">received ${formatDate(pay.date)}</p>
        </div>
      `).join("")}
  </div>

  <!-- 3. what you're owed -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 15px; margin: 0 0 12px; color: #374151; font-weight: 600;">what you're owed</h2>
    ${invoices.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">nothing outstanding this week.</p>'
      : invoices.map((inv) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 14px;">${inv.sender || "unknown"}</strong>
            <span style="font-weight: 600; color: #374151;">${formatCurrency(inv.amount, inv.currency || summary.currency)}</span>
          </div>
          <p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">sent ${formatDate(inv.date)}${inv.invoiceNumber ? ` · #${inv.invoiceNumber}` : ""}${inv.dueDate ? ` · due ${inv.dueDate}` : ""}</p>
        </div>
      `).join("")}
    ${invoices.length === 0 ? "" : `<p style="margin: 12px 0 0; font-size: 14px; color: #6b7280;">you have <strong>${summary.currency} ${summary.outstandingBalance.toFixed(2)}</strong> outstanding across ${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? "" : "s"}.</p>`}
  </div>

  <!-- 4. overdue -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 15px; margin: 0 0 12px; color: #374151; font-weight: 600;">overdue</h2>
    ${overdue.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">nothing overdue this week.</p>'
      : overdue.map((d) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <p style="margin: 0; font-size: 13px; color: #374151;">${d.description}</p>
          ${d.amountDiff !== null ? `<p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">amount: ${summary.currency} ${d.amountDiff.toFixed(2)}</p>` : ""}
        </div>
      `).join("")}
  </div>

  <!-- 5. worth a look -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 15px; margin: 0 0 12px; color: #374151; font-weight: 600;">worth a look</h2>
    ${worthALook.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">nothing flagged this week.</p>'
      : worthALook.map((d) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px; background: #fafafa;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #6b7280; background: #f3f4f6;">
            worth a look
          </span>
          <!-- NOTE: d.description strings can read accusatory — they originate in
               reconciliation.ts. softening them there is a follow-up; the framing
               here stays calm. -->
          <p style="margin: 8px 0 0; font-size: 13px; color: #374151;">${d.description}</p>
          ${d.amountDiff !== null ? `<p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">the numbers were off by ${summary.currency} ${d.amountDiff.toFixed(2)}.</p>` : ""}
        </div>
      `).join("")}
    ${worthALook.length === 0 ? "" : `<p style="margin: 12px 0 0; font-size: 13px; color: #9ca3af;">this doesn't mean something's wrong. it means the numbers didn't match cleanly.</p>`}
  </div>

  <!-- 6. weekly snapshot -->
  <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin: 24px 0;">
    <h2 style="font-size: 15px; margin: 0 0 16px; color: #374151; font-weight: 600;">this week</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">paid</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.currency} ${summary.totalPaid.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">outstanding</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.invoiceCount}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">overdue</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${overdue.length}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">flagged</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${worthALook.length}</td>
      </tr>
    </table>
  </div>

  <!-- 7. footer / controls -->
  <div style="text-align: center; padding: 24px 0 8px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
    <p style="font-size: 12px; color: #9ca3af; margin: 0;">
      money rundown reads your gmail · read-only, always
    </p>
    <p style="font-size: 12px; color: #9ca3af; margin: 4px 0 0;">
      your data doesn't train anything · deletes on cancel
    </p>
    <p style="font-size: 12px; color: #b0b6bf; margin: 12px 0 0;">
      adjust settings · change tier · pause digest · cancel
    </p>
  </div>
</body>
</html>`;
}
