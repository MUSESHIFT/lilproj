/**
 * cron worker — email every connected user their weekly money rundown.
 *
 * Standalone. Schedule weekly with:  bun run scripts/cron-weekly-digest.ts
 * Reuses the calm formatters from src/lib/digest.ts so the email matches the
 * in-app digest exactly.
 */
import { getDb } from "../src/lib/db";
import { formatDigestAsText, formatDigestAsHtml } from "../src/lib/digest";
import type {
  DigestData,
  DigestInvoice,
  DigestPayment,
  DigestDiscrepancy,
} from "../src/lib/digest";
import { sendMail } from "../src/lib/mailer";

type DB = ReturnType<typeof getDb>;

function dominantCurrency(items: { currency: string | null }[]): string {
  const counts: Record<string, number> = {};
  for (const it of items) {
    const cur = (it.currency || "USD").toUpperCase();
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

/** Assemble the same DigestData shape generateDigest builds, but by userId. */
function buildDigest(db: DB, userId: string): DigestData {
  const endDate = new Date().toISOString();
  const startDate = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const invoiceRows = db
    .prepare(
      `SELECT subject, sender, date, extracted_amount, extracted_currency,
              extracted_invoice_number, extracted_due_date, extracted_sender_name
       FROM emails
       WHERE user_id = ? AND processed = 1 AND classified_as = 'invoice' AND created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(userId, startDate) as {
    subject: string;
    sender: string;
    date: string;
    extracted_amount: number | null;
    extracted_currency: string | null;
    extracted_invoice_number: string | null;
    extracted_due_date: string | null;
    extracted_sender_name: string | null;
  }[];

  const paymentRows = db
    .prepare(
      `SELECT subject, sender, date, extracted_amount, extracted_currency
       FROM emails
       WHERE user_id = ? AND processed = 1 AND classified_as = 'payment_received' AND created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(userId, startDate) as {
    subject: string;
    sender: string;
    date: string;
    extracted_amount: number | null;
    extracted_currency: string | null;
  }[];

  const discrepancyRows = db
    .prepare(
      `SELECT type, description, amount_diff FROM discrepancies
       WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC`,
    )
    .all(userId, startDate) as {
    type: string;
    description: string;
    amount_diff: number | null;
  }[];

  const invoices: DigestInvoice[] = invoiceRows.map((r) => ({
    sender: r.extracted_sender_name || r.sender,
    amount: r.extracted_amount,
    currency: r.extracted_currency,
    invoiceNumber: r.extracted_invoice_number,
    dueDate: r.extracted_due_date,
    date: r.date,
    subject: r.subject,
  }));
  const payments: DigestPayment[] = paymentRows.map((r) => ({
    sender: r.sender,
    amount: r.extracted_amount,
    currency: r.extracted_currency,
    date: r.date,
    subject: r.subject,
  }));
  const discrepancies: DigestDiscrepancy[] = discrepancyRows.map((r) => ({
    type: r.type,
    description: r.description,
    amountDiff: r.amount_diff,
  }));

  const totalInvoiced = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const currency = dominantCurrency([
    ...invoices.map((i) => ({ currency: i.currency })),
    ...payments.map((p) => ({ currency: p.currency })),
  ]);

  return {
    dateRange: { start: startDate.split("T")[0], end: endDate.split("T")[0] },
    generatedAt: endDate,
    summary: {
      totalInvoiced,
      totalPaid,
      outstandingBalance: totalInvoiced - totalPaid,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      discrepancyCount: discrepancies.length,
      currency,
    },
    invoices,
    payments,
    discrepancies,
  };
}

async function main(): Promise<void> {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT u.id, u.email FROM users u JOIN gmail_tokens g ON g.user_id = u.id`,
    )
    .all() as { id: string; email: string }[];
  console.log(`[weekly-digest] ${users.length} connected user(s)`);

  for (const user of users) {
    try {
      const digest = buildDigest(db, user.id);
      const s = digest.summary;
      if (
        s.invoiceCount === 0 &&
        s.paymentCount === 0 &&
        s.discrepancyCount === 0
      ) {
        console.log(`[weekly-digest] user ${user.id}: nothing to send, skipped`);
        continue;
      }
      await sendMail({
        to: user.email,
        subject: `your money rundown — week of ${digest.dateRange.start}`,
        text: formatDigestAsText(digest),
        html: formatDigestAsHtml(digest),
      });
      console.log(`[weekly-digest] user ${user.id}: sent to ${user.email}`);
    } catch (e) {
      console.error(
        `[weekly-digest] user ${user.id} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  console.log("[weekly-digest] done");
}

main();
