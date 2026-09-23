import nodemailer from "nodemailer";
import { APP_NAME } from "../constants/brand.js";

// Sending email from this app, and why it works the way it does.
//
// THE PROBLEM: Render's free tier blocks outbound traffic on the SMTP ports
// (25, 465, 587) — a change they made in September 2025. Gmail SMTP therefore
// cannot connect at all from the live backend. It doesn't fail fast either;
// the connection just hangs until it times out, which is why "Sending..."
// appeared to freeze and why password-reset emails silently never arrived
// even with EMAIL_USER and EMAIL_APP_PASSWORD set correctly.
//
// THE FIX: send over HTTPS instead. Brevo's transactional API is a plain POST
// to port 443, which no host blocks — 300 emails a day free, and a normal
// Gmail address can be the verified sender, so no domain is needed.
//
// SMTP is kept as a fallback because it works fine locally, where nothing is
// blocked. Set BREVO_API_KEY and the app uses the API; leave it unset and it
// falls back to Gmail SMTP.

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const FROM_NAME = APP_NAME;

const brevoKey = () => process.env.BREVO_API_KEY;
const senderAddress = () => process.env.EMAIL_USER;

let transporter = null;
let warnedMissingConfig = false;

const getTransporter = () => {
  if (transporter) return transporter;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    // Without these, a blocked SMTP port leaves the request hanging for
    // minutes. Ten seconds is long enough for a real connection and short
    // enough that a blocked one surfaces as an error the user can act on.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return transporter;
};

export const isEmailConfigured = () => {
  const ok = Boolean((brevoKey() && senderAddress()) || getTransporter());
  if (!ok && !warnedMissingConfig) {
    console.warn(
      "⚠️  Email isn't configured. Set BREVO_API_KEY + EMAIL_USER (recommended — works on Render's free tier), " +
        "or EMAIL_USER + EMAIL_APP_PASSWORD for local SMTP. See backend/.env.example."
    );
    warnedMissingConfig = true;
  }
  return ok;
};

const notConfigured = () =>
  new Error(
    "Email isn't set up on the server yet. It needs BREVO_API_KEY and EMAIL_USER — " +
      "Gmail SMTP alone does not work on Render's free tier, which blocks SMTP ports."
  );

// --- the two ways out -------------------------------------------------------

const sendViaBrevo = async ({ to, subject, html, attachment }) => {
  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": brevoKey(),
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: senderAddress() },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(attachment ? { attachment: [{ name: attachment.name, content: attachment.content }] } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 401 here almost always means the API key is wrong; a 400 mentioning the
    // sender means that address hasn't been verified in Brevo yet.
    if (res.status === 401) throw new Error("Brevo rejected the API key — check BREVO_API_KEY.");
    if (/sender/i.test(detail)) {
      throw new Error(
        `Brevo won't send from ${senderAddress()} — verify that address under Senders in the Brevo dashboard first.`
      );
    }
    throw new Error(`Brevo couldn't send the email (${res.status}): ${detail.slice(0, 160)}`);
  }
};

const sendViaSmtp = async ({ to, subject, html, attachment }) => {
  const t = getTransporter();
  if (!t) throw notConfigured();
  try {
    await t.sendMail({
      from: `"${FROM_NAME}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      ...(attachment
        ? {
            attachments: [
              {
                filename: attachment.name,
                content: Buffer.from(attachment.content, "base64"),
                contentType: attachment.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            ],
          }
        : {}),
    });
  } catch (error) {
    // A timeout here is the signature of a host blocking SMTP ports.
    if (/timeout|ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(error.message)) {
      throw new Error(
        "Couldn't reach the mail server — hosts like Render's free tier block SMTP ports. " +
          "Set BREVO_API_KEY to send over HTTPS instead."
      );
    }
    if (/invalid login|BadCredentials/i.test(error.message)) {
      throw new Error("Gmail rejected the login — check EMAIL_APP_PASSWORD (16 characters, no spaces).");
    }
    throw error;
  }
};

// Prefers the HTTPS API, because that's the one that works in production.
const send = async (payload) => {
  if (brevoKey() && senderAddress()) return sendViaBrevo(payload);
  if (getTransporter()) return sendViaSmtp(payload);
  throw notConfigured();
};

// --- what the app actually sends -------------------------------------------

export const sendPasswordResetEmail = async (toEmail, resetUrl) =>
  send({
    to: toEmail,
    subject: `Reset your password — ${APP_NAME}`,
    html: `
      <p>Someone (hopefully you) asked to reset the password for this account.</p>
      <p><a href="${resetUrl}">Click here to choose a new password</a>. This link works for 15 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `,
  });

// scopeLabel defaults to "expense sheet" so Expenses.jsx's existing calls are
// unchanged; Vehicles.jsx passes "vehicle expense sheet".
export const sendExpenseSheetEmail = async ({ toEmail, fileName, buffer, count, total, note, scopeLabel = "expense sheet" }) => {
  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(total || 0);

  return send({
    to: toEmail,
    subject: `${scopeLabel[0].toUpperCase()}${scopeLabel.slice(1)} — ${new Date().toLocaleDateString("en-IN")}`,
    html: `
      <p>Here is the current ${scopeLabel}.</p>
      <p><strong>${count}</strong> ${count === 1 ? "entry" : "entries"}, totalling <strong>${money}</strong>.</p>
      ${note ? `<p style="white-space:pre-wrap">${note}</p>` : ""}
      <p style="color:#666;font-size:13px">
        The attached file opens in Excel, or in Google Sheets — from Gmail, click the attachment
        and choose "Open with Google Sheets".
      </p>
    `,
    attachment: { name: fileName, content: buffer.toString("base64") },
  });
};

// Labor Wages equivalent — Work Log has no meaningful single "total" the way
// expenses/payments do (it's CFT * rate per row, already summed into
// `total`), so this shares the same shape but a type-aware subject/label.
export const sendLabourSheetEmail = async ({ toEmail, fileName, buffer, count, total, note, type }) => {
  const label = type === "payments" ? "payments sheet" : "work log";
  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(total || 0);

  return send({
    to: toEmail,
    subject: `${label[0].toUpperCase()}${label.slice(1)} — ${new Date().toLocaleDateString("en-IN")}`,
    html: `
      <p>Here is the current ${label}.</p>
      <p><strong>${count}</strong> ${count === 1 ? "entry" : "entries"}, totalling <strong>${money}</strong>.</p>
      ${note ? `<p style="white-space:pre-wrap">${note}</p>` : ""}
      <p style="color:#666;font-size:13px">
        The attached file opens in Excel, or in Google Sheets — from Gmail, click the attachment
        and choose "Open with Google Sheets".
      </p>
    `,
    attachment: { name: fileName, content: buffer.toString("base64") },
  });
};

// Daily backup email (23 Sep, backup system) — the JSON snapshot from
// utils/backup.js as an attachment. Keep these emails: each one is a full
// restorable copy of the account's data as of that day.
export const sendBackupEmail = async ({ toEmail, companyName, fileName, json, totalDocs }) =>
  send({
    to: toEmail,
    subject: `Daily data backup — ${companyName || APP_NAME} — ${new Date().toLocaleDateString("en-IN")}`,
    html: `
      <p>Attached is today's automatic backup of your ${APP_NAME} data (${totalDocs} records).</p>
      <p>Keep this email. If data is ever lost, this file can be used to restore it.</p>
    `,
    attachment: { name: fileName, content: Buffer.from(json).toString("base64"), contentType: "application/json" },
  });
