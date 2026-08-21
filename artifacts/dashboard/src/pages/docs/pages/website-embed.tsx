import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function WebsiteEmbedPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Connect & channels"
        title="Website webcall embed"
        updated="21 Aug 2026"
        description="Put a voice agent on your own site. Each agent has its own snippet — visitors talk in the browser, billed to your wallet."
      />

      <h2 id="where">Where to get the code</h2>
      <ol>
        <li>
          Open the agent → <strong>Settings</strong> → <strong>Website</strong>.
        </li>
        <li>
          Click <strong>Generate embed code</strong> (once per agent).
        </li>
        <li>Copy the snippet that matches how you want it to appear.</li>
      </ol>
      <p>
        Deep link:{" "}
        <code className="text-[13px]">/app/agents/&lt;id&gt;?section=website</code>.
      </p>

      <h2 id="widget">Floating widget</h2>
      <p>
        Paste this once before <code>&lt;/body&gt;</code>. A mic button appears in the corner.
        Visitors allow the microphone, tap Start Call, and talk to that agent.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed">{`<script src="https://app.snapserve.ai/api/widget.js"
        data-agent-id="12"
        data-share="wcl_…"
        data-name="Support"
        data-color="#0ea5e9"
        data-position="bottom-right"></script>`}</pre>
      <ul>
        <li>
          <code>data-agent-id</code> — this agent’s numeric ID
        </li>
        <li>
          <code>data-share</code> — the per-agent token from Settings (required; without it
          visitors cannot connect)
        </li>
        <li>
          <code>data-name</code>, <code>data-color</code>, <code>data-position</code> — label and
          look (bottom-right, bottom-left, top-right, top-left)
        </li>
      </ul>
      <Callout variant="warn" title="HTTPS + microphone">
        The host page must be served over HTTPS (or localhost). Browsers block the mic on plain
        HTTP. Allow <code>https://app.snapserve.ai</code> in your Content-Security-Policy{" "}
        <code>script-src</code> if you lock scripts down.
      </Callout>

      <h2 id="iframe">Inline iframe</h2>
      <p>
        Use a fixed panel instead of a floating button. The iframe <strong>must</strong> include{" "}
        <code>allow=&quot;microphone&quot;</code>.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed">{`<iframe
  src="https://app.snapserve.ai/api/widget/call?share=wcl_…"
  allow="microphone"
  title="Voice assistant"
  style="border:0;width:380px;height:560px"></iframe>`}</pre>

      <h2 id="link">Direct join link</h2>
      <p>
        Same live call on a full SnapServe page — good for a “Talk to us” button or QR code. Opens{" "}
        <code>/join/&lt;token&gt;</code> for that agent.
      </p>

      <h2 id="billing">Billing &amp; safety</h2>
      <ul>
        <li>Each visitor call uses the same webcall path as Live test and bills your wallet.</li>
        <li>
          Keep a positive wallet balance. If the wallet is empty, the widget cannot connect (payment
          required).
        </li>
        <li>
          <strong>New token</strong> in Settings invalidates the old snippet. Update your website if
          you rotate it.
        </li>
        <li>One floating widget per page. Use a different agent’s snippet on a different page.</li>
      </ul>

      <h2 id="vs-form">Website form vs voice widget</h2>
      <p>
        Connections → Website form captures a phone number and starts an outbound campaign call.
        The Settings → Website snippet is a live in-browser voice call with this agent — no phone
        number required.{" "}
        <Link href="/docs/connections">Connections</Link> /{" "}
        <Link href="/docs/campaigns">Campaigns</Link>.
      </p>
    </div>
  );
}
