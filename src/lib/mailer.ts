import nodemailer from "nodemailer";

/**
 * Send one email over SMTP. Zero-cost path: free Gmail SMTP with an app
 * password (SMTP_PASS is a Gmail app password, never the login password).
 * Configured entirely from env so no secrets live in the repo.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;

  if (!host || !user || !pass || !from) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM must be set to send email",
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
