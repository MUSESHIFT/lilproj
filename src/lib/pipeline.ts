import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./db";
import { classifyEmail } from "./classifier";
import type { PipelineEmailRecord } from "./classifier";
import { runReconciliation, getDiscrepancies } from "./reconciliation";
import type { ReconciliationReport, DiscrepancyResult } from "./reconciliation";

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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessInboxResult {
  success: boolean;
  classified: number;
  invoices: number;
  billsSent: number;
  paymentsReceived: number;
  paymentsMade: number;
  other: number;
  discrepancies: DiscrepancyResult[];
  error?: string;
}

export interface PipelineStats {
  totalEmails: number;
  processedEmails: number;
  unprocessedEmails: number;
  invoicesFound: number;
  paymentsMatched: number;
  discrepanciesCount: number;
  discrepancies: DiscrepancyResult[];
}

// ─── Process inbox server function ───────────────────────────────────────────

/**
 * Run the full processing pipeline on unprocessed emails for the current user:
 * 1. Fetch unprocessed emails
 * 2. Classify each one
 * 3. Store results
 * 4. Run reconciliation
 */
export const processInbox = createServerFn({ method: "POST" }).handler(
  async (): Promise<ProcessInboxResult> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { success: false, classified: 0, invoices: 0, billsSent: 0, paymentsReceived: 0, paymentsMade: 0, other: 0, discrepancies: [], error: "Not authenticated" };

    const db = getDb();

    // Fetch unprocessed emails that have body text
    const unprocessed = db
      .prepare(
        `SELECT id, subject, sender, snippet, body_text
         FROM emails
         WHERE user_id = ? AND processed = 0
         ORDER BY date ASC`,
      )
      .all(userId) as { id: string; subject: string; sender: string; snippet: string; body_text: string }[];

    if (unprocessed.length === 0) {
      // Still run reconciliation on previously classified emails
      const report = runReconciliation(userId);
      return {
        success: true,
        classified: 0,
        invoices: 0,
        billsSent: 0,
        paymentsReceived: 0,
        paymentsMade: 0,
        other: 0,
        discrepancies: report.discrepancies,
      };
    }

    // Prepare update statement
    const updateStmt = db.prepare(
      `UPDATE emails
       SET classified_as = ?,
           extracted_amount = ?,
           extracted_currency = ?,
           extracted_invoice_number = ?,
           extracted_due_date = ?,
           extracted_sender_name = ?,
           processed = 1
       WHERE id = ?`,
    );

    let invoices = 0;
    let billsSent = 0;
    let paymentsReceived = 0;
    let paymentsMade = 0;
    let other = 0;

    // Classify each email
    const classifyMany = db.transaction(() => {
      for (const email of unprocessed) {
        const record: PipelineEmailRecord = {
          id: email.id,
          subject: email.subject,
          sender: email.sender,
          snippet: email.snippet,
          bodyText: email.body_text,
        };

        const result = classifyEmail(record);

        // Count
        switch (result.classification) {
          case "invoice":
            invoices++;
            break;
          case "bill_sent":
            billsSent++;
            break;
          case "payment_received":
            paymentsReceived++;
            break;
          case "payment_made":
            paymentsMade++;
            break;
          default:
            other++;
        }

        updateStmt.run(
          result.classification,
          result.extractedAmount,
          result.extractedCurrency,
          result.extractedInvoiceNumber,
          result.extractedDueDate,
          result.extractedSenderName,
          email.id,
        );
      }
    });

    classifyMany();

    // Run reconciliation
    const report = runReconciliation(userId);

    return {
      success: true,
      classified: unprocessed.length,
      invoices,
      billsSent,
      paymentsReceived,
      paymentsMade,
      other,
      discrepancies: report.discrepancies,
    };
  },
);

/**
 * Get processing statistics for the current user.
 */
export const getPipelineStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<PipelineStats> => {
    const userId = await getUserIdFromSession();
    if (!userId) {
      return {
        totalEmails: 0,
        processedEmails: 0,
        unprocessedEmails: 0,
        invoicesFound: 0,
        paymentsMatched: 0,
        discrepanciesCount: 0,
        discrepancies: [],
      };
    }

    const db = getDb();

    // Total counts
    const total = db
      .prepare("SELECT COUNT(*) as c FROM emails WHERE user_id = ?")
      .get(userId) as { c: number };

    const processed = db
      .prepare(
        "SELECT COUNT(*) as c FROM emails WHERE user_id = ? AND processed = 1",
      )
      .get(userId) as { c: number };

    const invoicesFound = db
      .prepare(
        "SELECT COUNT(*) as c FROM emails WHERE user_id = ? AND classified_as = 'invoice'",
      )
      .get(userId) as { c: number };

    const paymentsMatched = db
      .prepare(
        "SELECT COUNT(*) as c FROM emails WHERE user_id = ? AND classified_as = 'payment_received'",
      )
      .get(userId) as { c: number };

    // Discrepancies
    const disc = getDiscrepancies(userId);

    return {
      totalEmails: total.c,
      processedEmails: processed.c,
      unprocessedEmails: total.c - processed.c,
      invoicesFound: invoicesFound.c,
      paymentsMatched: paymentsMatched.c,
      discrepanciesCount: disc.length,
      discrepancies: disc,
    };
  },
);
