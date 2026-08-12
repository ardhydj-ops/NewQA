import "server-only";
import { Resend } from "resend";

/**
 * Best-effort send: logs and returns on any failure (missing config or a
 * provider error) instead of throwing — a notification must never break
 * the submit/approve/reject action that triggered it.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("Email not sent — RESEND_API_KEY or RESEND_FROM_EMAIL is not configured:", input.subject);
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to: input.to, subject: input.subject, html: input.html });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
