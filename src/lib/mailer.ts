/**
 * Send one email via Resend's HTTP API (port 443).
 *
 * The droplet blocks outbound SMTP (25/465/587), so nodemailer/SMTP can't be
 * used there — Resend goes over HTTPS. RESEND_API_KEY is a send-only key;
 * MAIL_FROM must be a Resend-verified sender (or onboarding@resend.dev).
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    throw new Error("RESEND_API_KEY and MAIL_FROM must be set to send email");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    throw new Error(`resend send failed: ${res.status} ${await res.text()}`);
  }
}
