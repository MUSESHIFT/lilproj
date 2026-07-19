import { getDb, generateId } from "./db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmailRow {
  id: string;
  user_id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  classified_as: string | null;
  extracted_amount: number | null;
  extracted_currency: string | null;
  extracted_invoice_number: string | null;
  extracted_due_date: string | null;
  extracted_sender_name: string | null;
}

export interface DiscrepancyResult {
  type: string;
  description: string;
  amountDiff: number | null;
  emailId: string;
  relatedEmailId: string | null;
}

export interface ReconciliationReport {
  invoicesFound: number;
  paymentsMatched: number;
  discrepancies: DiscrepancyResult[];
}

// ─── Amount normalization ────────────────────────────────────────────────────

function normalizeCurrency(currency: string | null): string {
  if (!currency) return "USD";
  const upper = currency.toUpperCase();
  // Map common variations
  if (["$", "USD", "US DOLLAR", "DOLLARS"].includes(upper)) return "USD";
  if (["€", "EUR", "EURO"].includes(upper)) return "EUR";
  if (["£", "GBP", "POUND", "POUNDS"].includes(upper)) return "GBP";
  return upper;
}

/**
 * Check if two amounts are "close enough" to be considered matching.
 * Uses a tolerance of $0.50 or 1% of the invoice amount, whichever is larger.
 */
function amountsCloseEnough(
  invoiceAmount: number,
  paymentAmount: number,
): boolean {
  const diff = Math.abs(invoiceAmount - paymentAmount);
  const tolerance = Math.max(0.5, invoiceAmount * 0.01);
  return diff <= tolerance;
}

// ─── Parse date string to a sortable value ───────────────────────────────────

function parseDateForComparison(dateStr: string): number {
  // Try ISO format first: 2026-01-15
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (iso) {
    return new Date(
      parseInt(iso[1]),
      parseInt(iso[2]) - 1,
      parseInt(iso[3]),
    ).getTime();
  }

  // Try US date: MM/DD/YYYY or M/D/YYYY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr);
  if (us) {
    return new Date(
      parseInt(us[3]),
      parseInt(us[1]) - 1,
      parseInt(us[2]),
    ).getTime();
  }

  // Try European dot: DD.MM.YYYY
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(dateStr);
  if (eu) {
    return new Date(
      parseInt(eu[3]),
      parseInt(eu[2]) - 1,
      parseInt(eu[1]),
    ).getTime();
  }

  // Try named month: Jan 15, 2026
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  const named = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(dateStr);
  if (named) {
    const monthIdx = months[named[1].toLowerCase()];
    if (monthIdx !== undefined) {
      return new Date(
        parseInt(named[3]),
        monthIdx,
        parseInt(named[2]),
      ).getTime();
    }
  }

  // Fallback: try native Date.parse
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Check if an invoice is past due (due date has passed and no payment found).
 */
function isOverdue(dueDateStr: string | null): boolean {
  if (!dueDateStr) return false;
  const dueMs = parseDateForComparison(dueDateStr);
  if (dueMs === 0) return false;
  return dueMs < Date.now();
}

// ─── Reconciliation logic ────────────────────────────────────────────────────

/**
 * Run reconciliation for a user's classified emails.
 * Matches invoices against payments and flags discrepancies.
 * Clears previous discrepancies for the user before re-running.
 */
export function runReconciliation(userId: string): ReconciliationReport {
  const db = getDb();

  // Clear previous discrepancies for this user
  db.prepare("DELETE FROM discrepancies WHERE user_id = ?").run(userId);

  // Fetch classified emails for this user
  const allEmails = db
    .prepare(
      `SELECT id, user_id, subject, sender, date, snippet,
              classified_as, extracted_amount, extracted_currency,
              extracted_invoice_number, extracted_due_date, extracted_sender_name
       FROM emails
       WHERE user_id = ? AND processed = 1 AND classified_as IS NOT NULL
       ORDER BY date DESC`,
    )
    .all(userId) as EmailRow[];

  // Separate into categories
  const invoices = allEmails.filter((e) => e.classified_as === "invoice");
  const payments = allEmails.filter(
    (e) => e.classified_as === "payment_received",
  );

  const discrepancies: DiscrepancyResult[] = [];
  const matchedPaymentIds = new Set<string>();

  // For each invoice, try to find a matching payment
  for (const invoice of invoices) {
    let bestMatch: EmailRow | null = null;
    let bestScore = 0;

    for (const payment of payments) {
      if (matchedPaymentIds.has(payment.id)) continue;

      let score = 0;

      // Same currency
      const invCurrency = normalizeCurrency(invoice.extracted_currency);
      const payCurrency = normalizeCurrency(payment.extracted_currency);
      if (invCurrency === payCurrency) {
        score += 30;
      } else {
        // Different currency — skip as a potential match
        continue;
      }

      // Amount match (exact or close)
      if (
        invoice.extracted_amount !== null &&
        payment.extracted_amount !== null
      ) {
        if (invoice.extracted_amount === payment.extracted_amount) {
          score += 50;
        } else if (
          amountsCloseEnough(
            invoice.extracted_amount,
            payment.extracted_amount,
          )
        ) {
          score += 40;
        } else {
          // Amounts differ significantly — not a good match
          continue;
        }
      }

      // Sender match (payment from same entity as invoice sender)
      if (
        invoice.extracted_sender_name &&
        payment.extracted_sender_name
      ) {
        const invSender = invoice.extracted_sender_name.toLowerCase();
        const paySender = payment.extracted_sender_name.toLowerCase();
        // Check if one contains the other or they share significant words
        if (invSender === paySender) {
          score += 20;
        } else if (
          invSender.includes(paySender) ||
          paySender.includes(invSender)
        ) {
          score += 10;
        } else {
          // Check shared words
          const invWords = new Set(invSender.split(/\s+/));
          const payWords = new Set(paySender.split(/\s+/));
          let sharedWords = 0;
          for (const w of invWords) {
            if (payWords.has(w) && w.length > 2) sharedWords++;
          }
          if (sharedWords >= 2) score += 10;
          else if (sharedWords === 1) score += 5;
        }
      }

      // Invoice number match in payment subject/body
      if (invoice.extracted_invoice_number) {
        const invNum = invoice.extracted_invoice_number.toLowerCase();
        const payText = [
          payment.subject,
          payment.snippet,
        ].join(" ").toLowerCase();
        if (payText.includes(invNum)) {
          score += 25;
        }
      }

      if (score > bestScore && score >= 60) {
        bestScore = score;
        bestMatch = payment;
      }
    }

    if (bestMatch) {
      matchedPaymentIds.add(bestMatch.id);

      // Check for underpayment / overpayment
      if (
        invoice.extracted_amount !== null &&
        bestMatch.extracted_amount !== null
      ) {
        const diff =
          invoice.extracted_amount - bestMatch.extracted_amount;

        if (!amountsCloseEnough(invoice.extracted_amount, bestMatch.extracted_amount)) {
          if (diff > 0.5) {
            // Underpayment
            const desc = `Invoice ${invoice.extracted_invoice_number || invoice.subject} for ${invoice.extracted_currency || "$"}${invoice.extracted_amount} was underpaid — received ${bestMatch.extracted_currency || "$"}${bestMatch.extracted_amount}`;
            discrepancies.push({
              type: "underpayment",
              description: desc,
              amountDiff: diff,
              emailId: invoice.id,
              relatedEmailId: bestMatch.id,
            });
          } else if (diff < -0.5) {
            // Overpayment
            const desc = `Invoice ${invoice.extracted_invoice_number || invoice.subject} for ${invoice.extracted_currency || "$"}${invoice.extracted_amount} was overpaid — received ${bestMatch.extracted_currency || "$"}${bestMatch.extracted_amount}`;
            discrepancies.push({
              type: "overpayment",
              description: desc,
              amountDiff: Math.abs(diff),
              emailId: invoice.id,
              relatedEmailId: bestMatch.id,
            });
          }
        }
      }
    } else {
      // No matching payment found — check if overdue
      if (isOverdue(invoice.extracted_due_date)) {
        const desc = `Invoice ${invoice.extracted_invoice_number || invoice.subject} for ${invoice.extracted_currency || "$"}${invoice.extracted_amount || "?"} is overdue (due ${invoice.extracted_due_date})`;
        discrepancies.push({
          type: "overdue",
          description: desc,
          amountDiff: null,
          emailId: invoice.id,
          relatedEmailId: null,
        });
      } else {
        // Missing payment (not yet due)
        const desc = `Invoice ${invoice.extracted_invoice_number || invoice.subject} for ${invoice.extracted_currency || "$"}${invoice.extracted_amount || "?"} has no matching payment`;
        discrepancies.push({
          type: "missing_payment",
          description: desc,
          amountDiff: null,
          emailId: invoice.id,
          relatedEmailId: null,
        });
      }
    }
  }

  // Insert discrepancies into DB
  const insertStmt = db.prepare(
    `INSERT INTO discrepancies (id, user_id, email_id, related_email_id, type, description, amount_diff)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const d of discrepancies) {
    insertStmt.run(
      generateId(),
      userId,
      d.emailId,
      d.relatedEmailId,
      d.type,
      d.description,
      d.amountDiff,
    );
  }

  return {
    invoicesFound: invoices.length,
    paymentsMatched: matchedPaymentIds.size,
    discrepancies,
  };
}

/**
 * Fetch existing discrepancies for a user from the DB.
 */
export function getDiscrepancies(userId: string): DiscrepancyResult[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT type, description, amount_diff, email_id, related_email_id
       FROM discrepancies
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(userId) as {
    type: string;
    description: string;
    amount_diff: number | null;
    email_id: string;
    related_email_id: string | null;
  }[];

  return rows.map((r) => ({
    type: r.type,
    description: r.description,
    amountDiff: r.amount_diff,
    emailId: r.email_id,
    relatedEmailId: r.related_email_id,
  }));
}
