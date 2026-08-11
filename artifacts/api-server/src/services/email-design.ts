/**
 * Compile visual email design docs → email-safe table HTML.
 * Clients may also save raw HTML; this is the designer path.
 */

import type { EmailDesignBlock, EmailDesignDoc } from "@workspace/db";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function padCell(inner: string, align: string = "left", padding = "16px 24px"): string {
  return `<td align="${align}" style="padding:${padding};font-family:inherit;font-size:15px;line-height:1.55;color:#1a1a1a">${inner}</td>`;
}

function renderBlock(block: EmailDesignBlock, fontFamily: string): string {
  switch (block.type) {
    case "hero": {
      const bg = block.bg || "#0f172a";
      const color = block.color || "#ffffff";
      const align = block.align || "center";
      const sub = block.subtitle
        ? `<p style="margin:8px 0 0;font-size:14px;opacity:0.85;color:${color}">${esc(block.subtitle)}</p>`
        : "";
      return `<tr><td style="background:${bg};padding:32px 24px;text-align:${align};font-family:${fontFamily}">
        <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${color}">${esc(block.title)}</h1>
        ${sub}
      </td></tr>`;
    }
    case "text":
      return `<tr>${padCell(block.html || "<p></p>")}</tr>`;
    case "button": {
      const bg = block.bg || "#0f172a";
      const color = block.color || "#ffffff";
      const align = block.align || "center";
      const url = block.url || "#";
      return `<tr>${padCell(
        `<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;background:${bg};color:${color};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${esc(block.label || "Open")}</a>`,
        align,
      )}</tr>`;
    }
    case "image": {
      if (!block.src) return "";
      const w = block.width && block.width > 0 ? Math.min(block.width, 560) : 520;
      return `<tr>${padCell(
        `<img src="${esc(block.src)}" alt="${esc(block.alt || "")}" width="${w}" style="display:block;max-width:100%;height:auto;border:0;border-radius:8px" />`,
        "center",
      )}</tr>`;
    }
    case "divider":
      return `<tr><td style="padding:8px 24px"><hr style="border:none;border-top:1px solid ${block.color || "#e5e7eb"};margin:0"/></td></tr>`;
    case "spacer":
      return `<tr><td style="height:${Math.max(8, block.height ?? 24)}px;line-height:${Math.max(8, block.height ?? 24)}px;font-size:0">&nbsp;</td></tr>`;
    case "footer":
      return `<tr><td style="padding:20px 24px;font-size:12px;line-height:1.5;color:#6b7280;font-family:${fontFamily}">${block.html || ""}</td></tr>`;
    default:
      return "";
  }
}

export function defaultEmailDesign(): EmailDesignDoc {
  return {
    canvasBg: "#f4f4f6",
    contentBg: "#ffffff",
    width: 560,
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    blocks: [
      {
        id: "hero-1",
        type: "hero",
        title: "Thanks for your time, {{name}}",
        subtitle: "A quick follow-up from our call",
        bg: "#0f172a",
        color: "#ffffff",
        align: "center",
      },
      {
        id: "text-1",
        type: "text",
        html: "<p>Hi {{name}},</p><p>Thanks for speaking with us. Here's a short summary:</p><p>{{summary}}</p>",
      },
      {
        id: "btn-1",
        type: "button",
        label: "Open meeting",
        url: "{{meet_link}}",
        bg: "#0f172a",
        color: "#ffffff",
        align: "center",
      },
      {
        id: "footer-1",
        type: "footer",
        html: "<p style=\"margin:0\">— {{agent_name}} · {{business_name}}</p>",
      },
    ],
  };
}

export function compileEmailDesign(doc: EmailDesignDoc): string {
  const width = Math.min(Math.max(doc.width ?? 560, 320), 720);
  const canvasBg = doc.canvasBg || "#f4f4f6";
  const contentBg = doc.contentBg || "#ffffff";
  const fontFamily = doc.fontFamily
    || "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const rows = (doc.blocks || []).map((b) => renderBlock(b, fontFamily)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Email</title></head>
<body style="margin:0;padding:0;background:${canvasBg};font-family:${fontFamily}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${canvasBg};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:${contentBg};border-radius:12px;overflow:hidden">
        ${rows}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function newBlockId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
