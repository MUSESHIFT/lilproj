// ─── Types ───────────────────────────────────────────────────────────────────

export type Classification =
  | "invoice"
  | "bill_sent"
  | "payment_received"
  | "payment_made"
  | "other";

export interface ClassifiedEmail {
  classification: Classification;
  extractedAmount: number | null;
  extractedCurrency: string | null;
  extractedInvoiceNumber: string | null;
  extractedDueDate: string | null;
  extractedSenderName: string | null;
}

export interface PipelineEmailRecord {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  bodyText: string;
}

// ─── Amount patterns ─────────────────────────────────────────────────────────

// Currencies with both symbol and code forms
const AMOUNT_PATTERNS: { regex: RegExp; currency: string }[] = [
  // $1,234.56 or $1,234 or $500.00 USD
  {
    regex: /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b\s*(USD)?/gi,
    currency: "USD",
  },
  // €1.234,56 or €500 or 1.200,00€
  {
    regex: /(?:€\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\b|(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*€)/gi,
    currency: "EUR",
  },
  // £1,234.56 or £500
  {
    regex: /£\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/gi,
    currency: "GBP",
  },
  // 1,234.56 USD or 500 EUR or $1,234.56 USD (handled above, but catch explicit codes)
  {
    regex:
      /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(USD|EUR|GBP)\b/gi,
    currency: "USD", // placeholder — overridden by capture group
  },
  // Plain $500 without cents (more lenient)
  {
    regex: /\$\s*(\d{1,3}(?:,\d{3})*)\b(?!\d|\.\d)/gi,
    currency: "USD",
  },
  // Plain €500 without cents
  {
    regex: /€\s*(\d{1,3}(?:\.\d{3})*)\b(?!\d|,\d)/gi,
    currency: "EUR",
  },
  // Plain £500 without cents
  {
    regex: /£\s*(\d{1,3}(?:,\d{3})*)\b(?!\d|\.\d)/gi,
    currency: "GBP",
  },
];

// ─── Invoice number patterns ──────────────────────────────────────────────────

const INVOICE_NUMBER_PATTERNS = [
  /INV[OICE]*\s*[#:]?\s*(\d{2,}[-\w]*)/gi,
  /Invoice\s*(?:No|Number|#)[.:]?\s*(\d{2,}[-\w]*)/gi,
  /Bill\s*(?:No|Number|#)[.:]?\s*(\d{2,}[-\w]*)/gi,
  /Reference\s*[#:]?\s*(INV[-\w]*\d+)/gi,
  /Reference\s*[#:]?\s*(\d{3,}[-\w]*)/gi,
  /Order\s*(?:No|Number|#)[.:]?\s*(\d{2,}[-\w]*)/gi,
  // Catch standalone INV-XXX pattern
  /\b(INV[-\s]?\d{2,}[-\w]*)\b/gi,
  // Catch #12345 pattern (common for invoice refs)
  /#(\d{4,})\b/g,
];

// ─── Date patterns ────────────────────────────────────────────────────────────

const DATE_PATTERNS: { regex: RegExp; context: RegExp | null }[] = [
  // "Due date: Jan 15, 2026" or "Due: 01/15/2026"
  {
    regex:
      /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}/gi,
    context: /due\s*(?:date)?[:\s]*/i,
  },
  // ISO dates: 2026-01-15
  { regex: /\d{4}-\d{2}-\d{2}/g, context: null },
  // US dates: 01/15/2026 or 1/15/2026
  { regex: /\d{1,2}\/\d{1,2}\/\d{4}/g, context: null },
  // European dates: 15.01.2026
  { regex: /\d{1,2}\.\d{1,2}\.\d{4}/g, context: null },
];

// ─── Sender extraction from "From" header ─────────────────────────────────────

function extractSenderName(fromHeader: string): string {
  // Format: "Name <email>" or just "email"
  const nameMatch = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    return nameMatch[1].trim();
  }
  // Fallback: just return the email part
  const emailMatch = fromHeader.match(/<?([^\s>]+@[^\s>]+)>?/);
  return emailMatch ? emailMatch[1] : fromHeader.trim();
}

// ─── Parse amount from matched text ───────────────────────────────────────────

function parseAmount(text: string): number | null {
  // Remove currency symbols and whitespace
  let cleaned = text.replace(/[$€£]/g, "").trim();

  // Detect European format: 1.200,50 → remove thousand separators (dots), convert comma to decimal
  if (/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US/UK format: 1,200.50 → remove commas
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Classification logic ─────────────────────────────────────────────────────

function classifyText(
  subject: string,
  bodyText: string,
  snippet: string,
): Classification {
  const combined = [subject, snippet, bodyText].join(" ").toLowerCase();

  // Strong payment received signals
  const paymentReceivedSignals = [
    "thank you for your payment",
    "payment received",
    "payment confirmed",
    "your payment has been",
    "we have received your payment",
    "payment successful",
    "received your payment",
    "your payment of",
    "receipt for your payment",
    "this is your receipt",
    "payment confirmation",
  ];

  // Payment made signals (receipt for something the user bought)
  const paymentMadeSignals = [
    "your receipt",
    "thank you for your order",
    "thank you for your purchase",
    "order confirmed",
    "billed to",
    "charged to",
    "your subscription",
    "payment method charged",
  ];

  // Invoice received signals (someone billing the user)
  const invoiceReceivedSignals = [
    "invoice",
    "amount due",
    "due date",
    "overdue",
    "outstanding invoice",
    "payment overdue",
    "past due",
    "balance due",
    "statement of account",
    "amount owed",
  ];

  // Bill sent signals (user sent an invoice)
  const billSentSignals = [
    "your invoice is ready",
    "here's your invoice",
    "invoice from", // ambiguous, but combined with other signals
    "new invoice",
    "invoice attached",
  ];

  // Score each category
  let paymentReceivedScore = 0;
  let paymentMadeScore = 0;
  let invoiceScore = 0;
  let billSentScore = 0;

  for (const signal of paymentReceivedSignals) {
    if (combined.includes(signal)) paymentReceivedScore += 2;
  }
  for (const signal of paymentMadeSignals) {
    if (combined.includes(signal)) paymentMadeScore += 2;
  }
  for (const signal of invoiceReceivedSignals) {
    if (combined.includes(signal)) invoiceScore += 1;
  }
  for (const signal of billSentSignals) {
    if (combined.includes(signal)) billSentScore += 1;
  }

  // Additional heuristics
  // "Receipt" word alone is weak — check context
  if (/\breceipt\b/.test(combined)) {
    paymentMadeScore += 1;
  }
  // "Paid" alone
  if (/\bpaid\b/.test(combined)) {
    // Could be either direction, slight lean toward payment_received
    paymentReceivedScore += 0.5;
  }
  // "Amount due" and "Invoice" are strong signals
  if (/\bamount\s+due\b/i.test(combined)) invoiceScore += 2;
  if (/\binvoice\b/i.test(combined)) invoiceScore += 1;

  // Determine classification
  const scores: [Classification, number][] = [
    ["payment_received", paymentReceivedScore],
    ["payment_made", paymentMadeScore],
    ["invoice", invoiceScore],
    ["bill_sent", billSentScore],
  ];

  scores.sort((a, b) => b[1] - a[1]);

  const [top, topScore] = scores[0];

  // If the top score is zero or very low, mark as "other"
  if (topScore < 1) return "other";

  // If clear winner
  if (topScore > scores[1][1] + 1) return top;

  // Tie-breaking with hierarchy: invoice > payment_received > payment_made > bill_sent
  const hierarchy: Classification[] = [
    "invoice",
    "payment_received",
    "payment_made",
    "bill_sent",
  ];

  for (const cat of hierarchy) {
    if (scores.find((s) => s[0] === cat)?.[1] === topScore) return cat;
  }

  return top;
}

// ─── Extract amount ───────────────────────────────────────────────────────────

function extractAmount(text: string): {
  amount: number | null;
  currency: string | null;
} {
  let bestAmount: number | null = null;
  let bestCurrency: string | null = null;
  let bestPriority = 999;

  const combined = text;
  // Look for amount near keywords like "total", "amount due", "paid", "sum"
  const contextPatterns = [
    { regex: /total\s*(?:amount|due)?[:\s]*/gi, priority: 0 },
    { regex: /amount\s*(?:due|paid)?[:\s]*/gi, priority: 1 },
    { regex: /grand\s*total[:\s]*/gi, priority: 0 },
    { regex: /(?:you\s+)?paid[:\s]*/gi, priority: 2 },
    { regex: /sum\s*(?:of|total)?[:\s]*/gi, priority: 3 },
    { regex: /balance\s*due[:\s]*/gi, priority: 3 },
  ];

  for (const ctx of contextPatterns) {
    const ctxMatch = ctx.regex.exec(combined);
    if (ctxMatch) {
      const startFrom = ctxMatch.index + ctxMatch[0].length;
      const nearby = combined.slice(startFrom, startFrom + 60);

      for (const pat of AMOUNT_PATTERNS) {
        const m = pat.regex.exec(nearby);
        pat.regex.lastIndex = 0;
        if (m) {
          const amtStr = m[1] || m[2];
          if (amtStr) {
            const parsed = parseAmount(amtStr);
            if (parsed !== null && ctx.priority < bestPriority) {
              bestAmount = parsed;
              bestCurrency = pat.currency === "USD" && m[2]
                ? m[2].toUpperCase()
                : pat.currency;
              bestPriority = ctx.priority;
            }
          }
        }
      }
    }
    ctx.regex.lastIndex = 0;
  }

  // Fallback: find the largest amount in the text
  if (bestAmount === null) {
    let maxAmount = 0;
    for (const pat of AMOUNT_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = pat.regex.exec(combined)) !== null) {
        const amtStr = m[1] || m[2];
        if (amtStr) {
          const parsed = parseAmount(amtStr);
          if (parsed !== null && parsed > maxAmount) {
            maxAmount = parsed;
            bestAmount = parsed;
            bestCurrency =
              pat.currency === "USD" && m[2]
                ? m[2].toUpperCase()
                : pat.currency;
          }
        }
      }
      pat.regex.lastIndex = 0;
    }
  }

  return { amount: bestAmount, currency: bestCurrency };
}

// ─── Extract invoice number ───────────────────────────────────────────────────

function extractInvoiceNumber(text: string): string | null {
  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const extracted = (m[1] || m[0]).trim();
      pattern.lastIndex = 0;
      // Filter out false positives (pure numbers that look like amounts or dates)
      if (/^\d{4}$/.test(extracted)) continue; // likely a year
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(extracted)) continue; // a date
      return extracted;
    }
    pattern.lastIndex = 0;
  }
  return null;
}

// ─── Extract due date ─────────────────────────────────────────────────────────

function extractDueDate(text: string): string | null {
  // First, look for "due date" or "due" near a date
  const dueContext =
    /(?:due\s*(?:date)?|payment\s*(?:due|deadline)|pay\s*(?:by|before))\s*[:\s]*/gi;

  let m: RegExpExecArray | null;
  while ((m = dueContext.exec(text)) !== null) {
    const startFrom = m.index + m[0].length;
    const nearby = text.slice(startFrom, startFrom + 40);

    for (const pat of DATE_PATTERNS) {
      const dm = pat.regex.exec(nearby);
      if (dm) {
        pat.regex.lastIndex = 0;
        dueContext.lastIndex = 0;
        return dm[0];
      }
      pat.regex.lastIndex = 0;
    }
  }
  dueContext.lastIndex = 0;

  // Fallback: find any date in the text (first match)
  for (const pat of DATE_PATTERNS) {
    const dm = pat.regex.exec(text);
    if (dm) {
      pat.regex.lastIndex = 0;
      return dm[0];
    }
    pat.regex.lastIndex = 0;
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a single email and extract structured data.
 * Pure function — no DB or side effects.
 */
export function classifyEmail(
  email: PipelineEmailRecord,
): ClassifiedEmail {
  const fullText = [email.subject, email.snippet, email.bodyText].join("\n");

  const classification = classifyText(
    email.subject,
    email.bodyText,
    email.snippet,
  );

  const { amount, currency } = extractAmount(fullText);
  const invoiceNumber = extractInvoiceNumber(fullText);
  const dueDate = extractDueDate(fullText);
  const senderName = extractSenderName(email.sender);

  return {
    classification,
    extractedAmount: amount,
    extractedCurrency: currency,
    extractedInvoiceNumber: invoiceNumber,
    extractedDueDate: dueDate,
    extractedSenderName: senderName,
  };
}
