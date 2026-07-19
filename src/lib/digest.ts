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
 */
export function formatDigestAsText(digest: DigestData): string {
  const { dateRange, summary, invoices, payments, discrepancies } = digest;

  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════");
  lines.push("  Quiet Ledge — Weekly Finance Digest");
  lines.push("═══════════════════════════════════════════");
  lines.push("");
  lines.push(
    `Period: ${dateRange.start} → ${dateRange.end}`,
  );
  lines.push(`Generated: ${formatDate(digest.generatedAt)}`);
  lines.push("");

  // Summary section
  lines.push("─── Summary ───────────────────────────────");
  lines.push("");
  lines.push(
    `  Invoices: ${summary.invoiceCount} — Total ${formatCurrency(summary.totalInvoiced, summary.currency)}`,
  );
  lines.push(
    `  Payments:  ${summary.paymentCount} — Total ${formatCurrency(summary.totalPaid, summary.currency)}`,
  );
  lines.push(
    `  Outstanding balance: ${formatCurrency(summary.outstandingBalance, summary.currency)}`,
  );
  if (summary.discrepancyCount > 0) {
    lines.push(`  ⚠ Discrepancies: ${summary.discrepancyCount}`);
  }
  lines.push("");

  // Invoices section
  lines.push("─── Recent Invoices ───────────────────────");
  lines.push("");
  if (invoices.length === 0) {
    lines.push("  No invoices found this week.");
  } else {
    for (const inv of invoices) {
      const num = inv.invoiceNumber ? ` (#${inv.invoiceNumber})` : "";
      const amt = formatCurrency(inv.amount, inv.currency || summary.currency);
      const sender = inv.sender || "Unknown";
      lines.push(`  • ${sender} — ${amt}${num}`);
      lines.push(`    ${inv.subject}`);
      if (inv.dueDate) {
        lines.push(`    Due: ${inv.dueDate}`);
      }
    }
  }
  lines.push("");

  // Payments section
  lines.push("─── Recent Payments ───────────────────────");
  lines.push("");
  if (payments.length === 0) {
    lines.push("  No payments received this week.");
  } else {
    for (const pay of payments) {
      const amt = formatCurrency(pay.amount, pay.currency || summary.currency);
      const sender = pay.sender || "Unknown";
      lines.push(`  • ${sender} — ${amt}`);
      lines.push(`    ${pay.subject}`);
    }
  }
  lines.push("");

  // Discrepancies section
  if (discrepancies.length > 0) {
    lines.push("─── Discrepancies ⚠ ───────────────────────");
    lines.push("");
    for (const d of discrepancies) {
      const label = {
        underpayment: "UNDERPAID",
        overpayment: "OVERPAID",
        missing_payment: "MISSING",
        overdue: "OVERDUE",
      }[d.type] || d.type.toUpperCase();
      lines.push(`  [${label}] ${d.description}`);
      if (d.amountDiff !== null) {
        lines.push(
          `           Difference: ${summary.currency} ${d.amountDiff.toFixed(2)}`,
        );
      }
    }
    lines.push("");
  }

  lines.push("───────────────────────────────────────────");
  lines.push("  Powered by Quiet Ledge");
  lines.push("  https://quietledge.com");
  lines.push("───────────────────────────────────────────");

  return lines.join("\n");
}

/**
 * Convert a digest to a simple HTML email body.
 */
export function formatDigestAsHtml(digest: DigestData): string {
  const { dateRange, summary, invoices, payments, discrepancies } = digest;

  const discrepancyLabel = (type: string): string => {
    const map: Record<string, string> = {
      underpayment: "Underpaid",
      overpayment: "Overpaid",
      missing_payment: "Missing Payment",
      overdue: "Overdue",
    };
    return map[type] || type;
  };

  const discrepancyColor = (type: string): string => {
    const map: Record<string, string> = {
      underpayment: "#d97706",
      overpayment: "#2563eb",
      missing_payment: "#dc2626",
      overdue: "#991b1b",
    };
    return map[type] || "#6b7280";
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1f2937; line-height: 1.6;">
  <div style="text-align: center; padding: 24px 0; border-bottom: 2px solid #4f46e5;">
    <h1 style="font-size: 22px; color: #4f46e5; margin: 0;">📊 Quiet Ledge Weekly Digest</h1>
    <p style="color: #6b7280; margin: 8px 0 0; font-size: 14px;">
      ${dateRange.start} → ${dateRange.end}
    </p>
  </div>

  <!-- Summary -->
  <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin: 24px 0;">
    <h2 style="font-size: 16px; margin: 0 0 16px; color: #374151;">Summary</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Invoices</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.invoiceCount}</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.currency} ${summary.totalInvoiced.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Payments</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.paymentCount}</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${summary.currency} ${summary.totalPaid.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0 0; font-size: 14px; font-weight: 700; color: ${summary.outstandingBalance > 0 ? '#dc2626' : '#059669'};">
          Outstanding
        </td>
        <td colspan="2" style="padding: 8px 0 0; text-align: right; font-weight: 700; color: ${summary.outstandingBalance > 0 ? '#dc2626' : '#059669'};">
          ${summary.currency} ${summary.outstandingBalance.toFixed(2)}
        </td>
      </tr>
      ${summary.discrepancyCount > 0 ? `
      <tr>
        <td style="padding: 8px 0 0; font-size: 14px; font-weight: 700; color: #dc2626;">
          ⚠ Discrepancies
        </td>
        <td colspan="2" style="padding: 8px 0 0; text-align: right; font-weight: 700; color: #dc2626;">
          ${summary.discrepancyCount}
        </td>
      </tr>` : ""}
    </table>
  </div>

  <!-- Invoices -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 16px; margin: 0 0 12px; color: #374151;">📄 Recent Invoices</h2>
    ${invoices.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">No invoices found this week.</p>'
      : invoices.map((inv) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 14px;">${inv.sender || "Unknown"}</strong>
            <span style="font-weight: 600; color: #4f46e5;">${formatCurrency(inv.amount, inv.currency || summary.currency)}</span>
          </div>
          <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">${inv.subject}</p>
          ${inv.invoiceNumber ? `<span style="font-size: 12px; color: #9ca3af;">#${inv.invoiceNumber}</span>` : ""}
          ${inv.dueDate ? `<span style="font-size: 12px; color: #9ca3af; margin-left: 8px;">Due: ${inv.dueDate}</span>` : ""}
        </div>
      `).join("")}
  </div>

  <!-- Payments -->
  <div style="margin: 24px 0;">
    <h2 style="font-size: 16px; margin: 0 0 12px; color: #374151;">💰 Recent Payments</h2>
    ${payments.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">No payments received this week.</p>'
      : payments.map((pay) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 14px;">${pay.sender || "Unknown"}</strong>
            <span style="font-weight: 600; color: #059669;">${formatCurrency(pay.amount, pay.currency || summary.currency)}</span>
          </div>
          <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">${pay.subject}</p>
        </div>
      `).join("")}
  </div>

  <!-- Discrepancies -->
  ${discrepancies.length > 0 ? `
  <div style="margin: 24px 0;">
    <h2 style="font-size: 16px; margin: 0 0 12px; color: #dc2626;">⚠ Discrepancies</h2>
    ${discrepancies.map((d) => `
      <div style="border: 1px solid #fca5a5; border-radius: 8px; padding: 12px; margin-bottom: 8px; background: #fef2f2;">
        <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; color: white; background: ${discrepancyColor(d.type)};">
          ${discrepancyLabel(d.type)}
        </span>
        <p style="margin: 8px 0 0; font-size: 13px; color: #374151;">${d.description}</p>
        ${d.amountDiff !== null ? `<p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Difference: ${summary.currency} ${d.amountDiff.toFixed(2)}</p>` : ""}
      </div>
    `).join("")}
  </div>` : ""}

  <!-- Footer -->
  <div style="text-align: center; padding: 24px 0 8px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
    <p style="font-size: 12px; color: #9ca3af; margin: 0;">
      Powered by <strong>Quiet Ledge</strong> — Know what you're owed.
    </p>
    <p style="font-size: 11px; color: #d1d5db; margin: 4px 0 0;">
      Generated ${formatDate(digest.generatedAt)}
    </p>
  </div>
</body>
</html>`;
}
