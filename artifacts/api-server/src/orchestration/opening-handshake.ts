/**
 * Outbound opening handshake.
 *
 * Campaign transcripts (M R Finserv, agent Malar, Sep 2026): the first line was
 * either "hello" or a full scripted introduction, and the caller's pickup
 * "ஹலோ" / "சரி" was treated as permission to start the funding question.
 * Interruptions and "என்னது?" pile up in that first half-minute.
 *
 * The opener stays a human hello (who is calling, can we talk). The offer
 * waits until they have actually answered.
 */

import { isBareAcknowledgement, isHoldRequest } from "./conversationDiscipline.js";

/** How long after the opener we still treat hello/okay as not-the-script. */
export const OPENING_HANDSHAKE_MS = 30_000;

const PITCH_IN_LINE =
  /\b(?:check[-\s]?based|cheque|loan|two minutes|2 minutes|(?:business\s+)?fund(?:ing|s)?)\b|கடன்|நிதி|ஃபண்ட்/iu;

const HELLO_ONLY =
  /^(?:hello+|hi+|hey+|halo+|வணக்கம்(?:ங்க)?|ஹலோ+)[!.?\s]*$/iu;

function looksLikeIdentityClause(text: string): boolean {
  return /வணக்கம்|ஹலோ|hello|hi\b|hey\b|பேசு|this is|i am|i'm|my name|என் பேர்|நான் /iu.test(text);
}

/**
 * Drop product / funding clauses from the first spoken outbound line.
 * Identity before the pitch is kept. A pitch-only fragment is dropped when
 * `dropPitchOnly` is set (the caller already heard the hello).
 */
export function humanizeOutboundOpener(text: string, opts?: { dropPitchOnly?: boolean }): string {
  const raw = text.trim();
  if (!raw || !PITCH_IN_LINE.test(raw)) return raw;

  const parts = raw.split(/(?<=[.!?।,])\s+/u).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    if (PITCH_IN_LINE.test(part)) break;
    kept.push(part);
  }
  if (kept.length > 0) return kept.join(" ").replace(/[,;:\s]+$/u, "").trim();

  const match = PITCH_IN_LINE.exec(raw);
  if (match && match.index >= 8) {
    const cut = raw.slice(0, match.index).replace(/[\s,;:–—-]+$/u, "").trim();
    if (cut.length >= 8 && looksLikeIdentityClause(cut)) return cut;
  }
  return opts?.dropPitchOnly ? "" : raw;
}

function callerUtterance(text: string): string {
  return (text.split(/\n\n\[/)[0] ?? text).trim();
}

function isHelloOnly(text: string): boolean {
  return HELLO_ONLY.test(text.trim());
}

function isYesAck(text: string): boolean {
  if (isHelloOnly(text)) return false;
  if (isBareAcknowledgement(text)) return true;
  // "ஆ சரி" is a yes on Tamil calls; "ஆ" alone is not in the shared ack list.
  const words = text
    .toLowerCase()
    .replace(/[.,!।|?？"'“”]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((w) => w === "ஆ" || isBareAcknowledgement(w));
}

function isWhoQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  return /யார்|யாரு|who(?:'s| is)? (?:this|calling|that)|who are you/iu.test(t);
}

function isWhatQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  return /என்ன விஷயம்|என்னது|என்ன சொல்|என்ன வேணும்|சொல்லு(?:ங்க)?|பேசு(?:ங்க)?|tell me|what(?:'s| is) (?:this|it|that)|go ahead/iu.test(t);
}

/** True when the opener already said who is calling, not only "hello, can we talk?". */
function openerAlreadyIntroduced(prev: string): boolean {
  const t = prev.trim();
  if (t.length < 24) return false;
  if (isHelloOnly(t)) return false;
  return looksLikeIdentityClause(t);
}

/**
 * Per-turn reminder for the first 30s. Returns null once the caller has moved
 * past hello / "who is this" / "what is this" — a real answer should follow the script.
 */
export function buildOpeningHandshakeNudge(userText: string, prevAgentLine: string): string | null {
  const said = callerUtterance(userText);
  if (!said || isHoldRequest(said)) return null;
  const prev = prevAgentLine.trim();

  // They already heard the reason and agreed — the script may continue.
  if (PITCH_IN_LINE.test(prev) && isYesAck(said)) return null;

  if (isWhoQuestion(said)) {
    return "[OPENING HANDSHAKE] They asked who is calling. Answer in ONE short spoken sentence: your name and company only. Do not describe the offer, funding, or process. Do not read the scripted introduction. Then stop.";
  }
  if (isWhatQuestion(said)) {
    return "[OPENING HANDSHAKE] They asked what this call is about. Answer in ONE short spoken sentence: the reason for the call, then ask if now is okay. Do not read the scripted introduction. Do not ask whether they need funds yet. Then stop.";
  }
  if (isHelloOnly(said)) {
    if (openerAlreadyIntroduced(prev) || PITCH_IN_LINE.test(prev)) {
      return "[OPENING HANDSHAKE] They said hello again. Do not repeat your introduction and do not start the script. ONE short spoken sentence: ask if they can talk for a moment. Do not ask if they need funds. Then stop.";
    }
    return "[OPENING HANDSHAKE] They only said hello. The script has not started. ONE short spoken sentence: your name and company, and ask if they can talk. Do not mention funding, loans, or the offer. Then stop.";
  }
  if (isYesAck(said)) {
    if (!openerAlreadyIntroduced(prev)) {
      return "[OPENING HANDSHAKE] They said okay, but you have not introduced yourself yet. ONE short spoken sentence: your name and company, and that you will be brief. Do not ask if they need funds. Do not read the scripted introduction. Then stop.";
    }
    return "[OPENING HANDSHAKE] They agreed to listen. ONE short spoken sentence: why you called, then ask if now is okay. Do not ask whether they need funds, a loan, or funding yet. Do not repeat your name. Then stop.";
  }
  return null;
}
