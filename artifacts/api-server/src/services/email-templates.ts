/**
 * Branded HTML email templates for all SnapServe transactional emails.
 * All templates return a complete HTML document ready to pass to sendBrevoEmail().
 * Note: only ASCII + HTML entities used here to avoid TS lexer issues with Unicode.
 */

function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

function shell(body: string): string {
  const year = new Date().getFullYear();
  return (
    "<!DOCTYPE html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>SnapServe</title>" +
    "</head>" +
    '<body style="margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f6;padding:40px 16px">' +
    "<tr><td align=\"center\">" +
    '<table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%">' +
    '<tr><td style="background:#09090b;border-radius:12px 12px 0 0;padding:22px 32px">' +
    '<span style="font-size:1.2rem;font-weight:700;color:#ffffff;letter-spacing:-0.02em">Snap<span style="color:#10b981">Serve</span></span>' +
    "</td></tr>" +
    '<tr><td style="background:#ffffff;padding:36px 32px;border-radius:0 0 12px 12px">' +
    body +
    '<div style="margin-top:36px;padding-top:24px;border-top:1px solid #f0f0f0">' +
    '<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.7">' +
    "You received this from SnapServe &nbsp;&middot;&nbsp;" +
    '<a href="https://app.snapserve.ai" style="color:#6b7280;text-decoration:none">app.snapserve.ai</a><br>' +
    "&copy; " + year + " SnapServe. All rights reserved." +
    "</p></div>" +
    "</td></tr>" +
    "</table></td></tr></table>" +
    "</body></html>"
  );
}

function btn(label: string, url: string): string {
  return (
    '<a href="' + url + '" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#09090b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">' +
    label +
    "</a>"
  );
}

function h1(text: string): string {
  return '<h1 style="margin:0 0 12px;font-size:1.4rem;font-weight:700;color:#09090b;letter-spacing:-0.02em">' + text + "</h1>";
}

function p(text: string): string {
  return '<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7">' + text + "</p>";
}

function chip(label: string, value: string): string {
  return (
    '<div style="margin-bottom:8px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">' +
    '<span style="font-size:13px;color:#6b7280">' + label + "</span>" +
    '&nbsp;&nbsp;<strong style="font-size:13px;color:#09090b;float:right">' + value + "</strong>" +
    "</div>"
  );
}

// ── Welcome ───────────────────────────────────────────────────────────────────

export function welcomeEmail(name: string, creditCents: number): string {
  return shell(
    h1("Welcome to SnapServe, " + name + "!") +
    p("Your account is ready. We have added <strong>" + fmt(creditCents) + " free credit</strong> to your wallet so you can start making calls right away.") +
    '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin:20px 0">' +
    '<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em">Get started in 3 steps</p>' +
    '<p style="margin:0 0 8px;font-size:14px;color:#166534">1. <strong>Create a voice agent</strong> &mdash; give it a name, system prompt, and provider settings</p>' +
    '<p style="margin:0 0 8px;font-size:14px;color:#166534">2. <strong>Test it with a web call</strong> &mdash; talk to your agent live in the browser, no phone needed</p>' +
    '<p style="margin:0;font-size:14px;color:#166534">3. <strong>Launch a campaign</strong> &mdash; upload leads or connect your CRM and start dialling</p>' +
    "</div>" +
    '<div style="margin:24px 0">' + btn("Open SnapServe", "https://app.snapserve.ai") + "</div>" +
    p("If you have any questions, just reply to this email &mdash; we are happy to help.")
  );
}

// ── Password Reset OTP ────────────────────────────────────────────────────────

export function passwordResetOtpEmail(otp: string): string {
  return shell(
    h1("Reset your password") +
    p("Use the code below to reset your SnapServe password. It expires in <strong>10 minutes</strong>.") +
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;text-align:center;margin:24px 0">' +
    '<span style="font-size:2.4rem;font-weight:700;letter-spacing:0.3em;color:#09090b;font-variant-numeric:tabular-nums">' + otp + "</span>" +
    "</div>" +
    p('<span style="font-size:13px;color:#9ca3af">If you did not request a password reset, you can safely ignore this email. Your account is secure.</span>')
  );
}

// ── Password Changed ──────────────────────────────────────────────────────────

export function passwordChangedEmail(name: string): string {
  return shell(
    h1("Your password was changed") +
    p("Hi " + name + ", this is a confirmation that your SnapServe password was successfully updated.") +
    '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin:20px 0">' +
    '<p style="margin:0;font-size:14px;color:#92400e">' +
    "(!) If you did not make this change, please " +
    '<a href="https://app.snapserve.ai/forgot-password" style="color:#b45309;font-weight:600">reset your password immediately</a>' +
    " and contact us." +
    "</p></div>" +
    '<div style="margin:24px 0">' + btn("Sign in to SnapServe", "https://app.snapserve.ai") + "</div>"
  );
}

// ── Wallet Top-Up Receipt ─────────────────────────────────────────────────────

export function walletTopUpEmail(
  name: string,
  amountCents: number,
  newBalanceCents: number,
  paymentId: string,
): string {
  return shell(
    h1("Payment received") +
    p("Hi " + name + ", your SnapServe wallet has been topped up successfully.") +
    '<div style="margin:24px 0">' +
    chip("Amount added", fmt(amountCents)) +
    chip("New wallet balance", fmt(newBalanceCents)) +
    chip("Payment reference", paymentId) +
    "</div>" +
    p("Your balance is available immediately and will be deducted as calls are completed.") +
    '<div style="margin:24px 0">' + btn("View wallet", "https://app.snapserve.ai/settings/billing") + "</div>" +
    p('<span style="font-size:13px;color:#9ca3af">Keep this email as your payment receipt. If you have questions about this charge, reply here.</span>')
  );
}

// ── Onboarding Day 1 ──────────────────────────────────────────────────────────

export function onboardingDay1Email(name: string): string {
  return shell(
    h1("How is it going, " + name + "?") +
    p("It has been a day since you joined SnapServe. The quickest way to see what the platform can do is to create your first voice agent and make a test call.") +
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px 24px;margin:20px 0">' +
    '<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#09090b">Creating an agent takes about 3 minutes</p>' +
    '<p style="margin:0 0 6px;font-size:13px;color:#6b7280">- Pick a name and write a short system prompt</p>' +
    '<p style="margin:0 0 6px;font-size:13px;color:#6b7280">- Choose your ASR / LLM / TTS providers (or use SnapServe managed defaults)</p>' +
    '<p style="margin:0;font-size:13px;color:#6b7280">- Click &ldquo;Web Call&rdquo; to talk to your agent live in the browser &mdash; no phone needed</p>' +
    "</div>" +
    '<div style="margin:24px 0">' + btn("Create my first agent", "https://app.snapserve.ai/agents") + "</div>" +
    p('<span style="font-size:13px;color:#9ca3af">You have free credit in your wallet &mdash; your first calls will not cost you anything extra.</span>')
  );
}

// ── Onboarding Day 3 ──────────────────────────────────────────────────────────

export function onboardingDay3Email(name: string): string {
  return shell(
    h1("Ready to launch your first campaign?") +
    p("Hi " + name + ", you have had a few days to explore SnapServe. If you have created a voice agent, you are ready to run a real campaign.") +
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px 24px;margin:20px 0">' +
    '<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#09090b">Launch your first campaign in minutes</p>' +
    '<p style="margin:0 0 6px;font-size:13px;color:#6b7280">1. Go to <strong>Campaigns</strong> &rarr; <strong>New Campaign</strong></p>' +
    '<p style="margin:0 0 6px;font-size:13px;color:#6b7280">2. Upload a CSV of leads or connect your CRM</p>' +
    '<p style="margin:0;font-size:13px;color:#6b7280">3. Set your concurrency, calling hours, and retries &mdash; then hit Start</p>' +
    "</div>" +
    '<div style="margin:24px 0">' + btn("Launch a campaign", "https://app.snapserve.ai/campaigns") + "</div>" +
    p("Need help setting up? Just reply to this email and we will walk you through it.")
  );
}

// ── Monthly Summary ───────────────────────────────────────────────────────────

export interface MonthlySummaryStats {
  month: string;
  totalCalls: number;
  totalMinutes: number;
  totalCostCents: number;
  activeAgents: number;
  topAgentName?: string;
}

export function monthlySummaryEmail(name: string, stats: MonthlySummaryStats): string {
  const avgMin = stats.totalCalls > 0
    ? (stats.totalMinutes / stats.totalCalls).toFixed(1)
    : "0";

  const cta = stats.totalCalls === 0
    ? p('Looks like things were quiet last month. <a href="https://app.snapserve.ai/campaigns" style="color:#10b981;font-weight:600">Launch a campaign</a> to get calls flowing.')
    : p('Great work last month! Check your <a href="https://app.snapserve.ai/calls" style="color:#10b981;font-weight:600">call logs</a> for detailed outcomes and transcripts.');

  return shell(
    h1("Your " + stats.month + " summary") +
    p("Hi " + name + ", here is a quick look at how your SnapServe account performed last month.") +
    '<div style="margin:24px 0">' +
    chip("Total calls made", String(stats.totalCalls)) +
    chip("Total minutes used", stats.totalMinutes + " min") +
    chip("Avg duration per call", avgMin + " min") +
    chip("Total spend", fmt(stats.totalCostCents)) +
    chip("Active agents", String(stats.activeAgents)) +
    (stats.topAgentName ? chip("Top agent", stats.topAgentName) : "") +
    "</div>" +
    cta +
    '<div style="margin:24px 0">' + btn("Open Dashboard", "https://app.snapserve.ai") + "</div>"
  );
}
