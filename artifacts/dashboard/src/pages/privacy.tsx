import { useEffect } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Shield, Mail, Calendar, User, Lock, ExternalLink, Trash2, Eye } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy \u00b7 SnapServe AI";
    return () => {
      document.title = "SnapServe";
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <PageHeader href="/" />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-2xl font-semibold text-foreground">Privacy Policy</h1>
            <p className="mt-1 text-sm text-muted-foreground">Last updated: June 2026</p>
          </div>

          {/* Intro */}
          <p className="text-sm text-muted-foreground mb-10 leading-relaxed">
            SnapServe AI ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your information when you use our AI Voice Agent Orchestration platform. By using SnapServe AI, you agree to the practices described in this policy.
          </p>

          {/* Sections */}
          <div className="space-y-10">
            {/* 1. What data we collect */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">What Data We Collect</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>We collect the following types of information:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong>Google Account Information:</strong> When you sign in with Google, we collect your name, email address, and profile picture. This is provided by Google OAuth and used solely for authentication and user identification within our platform.</li>
                  <li><strong>Google Calendar Data:</strong> When you connect your Google Calendar, we access your calendar events, availability, and time zone information. This is necessary for automated meeting scheduling and Google Meet link generation.</li>
                  <li><strong>Voice Call Data:</strong> We store call transcripts, recordings (if enabled), and call metadata (duration, timestamps, outcomes) to enable call analysis and quality monitoring.</li>
                  <li><strong>Usage Data:</strong> We collect information about how you interact with our platform, including feature usage, API calls, and error logs, to improve our service.</li>
                  <li><strong>Payment Information:</strong> We store transaction records and wallet balance information. We do not store full credit card details — these are handled securely by our payment processor.</li>
                </ul>
              </div>
            </section>

            {/* 2. Why we collect it */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Why We Collect It</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>We use your data for the following purposes:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong>Authentication:</strong> To verify your identity and provide secure access to your account.</li>
                  <li><strong>Calendar-Based Booking:</strong> To read your availability, create appointments, and generate Google Meet links for scheduled meetings.</li>
                  <li><strong>Voice Agent Operations:</strong> To enable your AI voice agents to make and receive calls, store transcripts, and track call outcomes.</li>
                  <li><strong>Service Improvement:</strong> To analyze usage patterns, fix bugs, and develop new features.</li>
                  <li><strong>Customer Support:</strong> To respond to your inquiries and troubleshoot issues.</li>
                </ul>
              </div>
            </section>

            {/* 3. How we use Google user data */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">How We Use Google User Data</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>Our use of Google user data is strictly limited to the following:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>We use Google Calendar data <strong>only</strong> for scheduling purposes — reading your free/busy times, creating events, and generating Meet links.</li>
                  <li>We use Google OAuth data <strong>only</strong> for authentication — verifying your identity and populating your profile.</li>
                  <li>We <strong>never</strong> sell your Google user data to third parties.</li>
                  <li>We <strong>never</strong> use your Google data for advertising or marketing purposes.</li>
                  <li>We <strong>never</strong> share your Google data with unauthorized third parties.</li>
                  <li>Access is limited to the minimum scope required: calendar access is only used when you explicitly connect your calendar, and OAuth data is only used during sign-in.</li>
                </ul>
              </div>
            </section>

            {/* 3a. Google API Limited-Use Disclosure (required for OAuth verification) */}
            <section className="rounded-lg border border-border bg-muted/30 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Google API Limited Use Disclosure</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>
                  SnapServe AI's use of information received from Google APIs adheres to the{" "}
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                  >
                    Google API Services User Data Policy
                  </a>
                  , including the Limited Use requirements.
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>
                    <strong>Scope used:</strong> We request the <code className="text-xs bg-muted px-1 py-0.5 rounded">https://www.googleapis.com/auth/calendar.events</code> scope
                    solely to create and manage Google Calendar events on behalf of the authenticated user for meeting scheduling purposes.
                  </li>
                  <li>
                    <strong>No advertising use:</strong> Data obtained through Google APIs is never used to serve advertisements and is not used for any advertising-related purpose.
                  </li>
                  <li>
                    <strong>No data sales:</strong> We do not sell, rent, or transfer Google user data to any third party.
                  </li>
                  <li>
                    <strong>No unauthorized sharing:</strong> We do not share Google user data with any third party except as necessary to provide the scheduling feature (e.g., writing the event back to Google Calendar on your behalf).
                  </li>
                  <li>
                    <strong>Revoke access:</strong> You can revoke SnapServe AI's access to your Google Calendar at any time from your{" "}
                    <a
                      href="https://myaccount.google.com/permissions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                    >
                      Google Account Permissions
                    </a>{" "}
                    page. Revoking access disables calendar-based scheduling features but does not delete your SnapServe account.
                  </li>
                </ul>
              </div>
            </section>

            {/* 4. How we store and protect data */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">How We Store and Protect Data</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>We take data security seriously:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong>Encryption:</strong> All data is encrypted in transit using TLS 1.3 and at rest using AES-256 encryption.</li>
                  <li><strong>Secure Infrastructure:</strong> We host on Replit's secure infrastructure with industry-standard security practices.</li>
                  <li><strong>Access Controls:</strong> Only authorized personnel can access production data, and all access is logged and audited.</li>
                  <li><strong>API Key Protection:</strong> Your provider API keys (Twilio, OpenAI, etc.) are encrypted at rest using AES-256-GCM. We only show the last 4 characters in the UI.</li>
                  <li><strong>Session Management:</strong> Authentication tokens are signed with HMAC-SHA256 and have a 30-day expiration. Tokens are stored securely in your browser's localStorage.</li>
                  <li><strong>Regular Audits:</strong> We conduct regular security reviews and vulnerability assessments.</li>
                </ul>
              </div>
            </section>

            {/* 5. Third-party services */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Third-Party Services</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>We use the following third-party services to provide our platform:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong>Google OAuth:</strong> For user authentication and identity verification.</li>
                  <li><strong>Google Calendar API:</strong> For reading availability and creating calendar events.</li>
                  <li><strong>Google Meet API:</strong> For generating video conference links.</li>
                  <li><strong>Telephony Providers (Twilio, Plivo, Vobiz):</strong> For making and receiving voice calls. You bring your own provider keys.</li>
                  <li><strong>AI Providers (OpenAI, Anthropic, Google, etc.):</strong> For speech-to-text, language model, and text-to-speech processing. You bring your own provider keys.</li>
                  <li><strong>Payment Processor:</strong> For handling wallet top-ups and billing.</li>
                </ul>
                <p className="mt-2">
                  Each third-party service is governed by its own privacy policy. We recommend reviewing those policies for complete information.
                </p>
              </div>
            </section>

            {/* 6. User rights */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Your Rights</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>You have the following rights regarding your data:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong>Access:</strong> You can view all your data within the SnapServe AI dashboard, including call logs, transcripts, and calendar connections.</li>
                  <li><strong>Delete:</strong> You can delete your account and all associated data at any time from the Settings page. This permanently removes all your data from our systems.</li>
                  <li><strong>Revoke Google Permissions:</strong> You can revoke SnapServe AI's access to your Google data at any time through your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:text-foreground/80">Google Account Permissions</a> page. Revoking access will disable calendar-based features but will not delete your account data.</li>
                  <li><strong>Data Portability:</strong> You can export your call logs and campaign data in CSV format from the dashboard.</li>
                  <li><strong>Correction:</strong> You can update your profile information and correct any inaccurate data through the Settings page.</li>
                </ul>
              </div>
            </section>

            {/* 7. Data retention */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Data Retention</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>We retain your data for as long as your account is active. When you delete your account:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>All personal data is permanently deleted within 30 days.</li>
                  <li>Call recordings and transcripts are deleted immediately.</li>
                  <li>Aggregated, anonymized analytics data may be retained for service improvement purposes.</li>
                </ul>
              </div>
            </section>

            {/* 8. Contact */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Contact Information</h2>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                <p>
                  If you have any questions about this Privacy Policy or your data, please contact us at:{" "}
                  <a href="mailto:support@snapserve.ai" className="text-foreground underline underline-offset-2 hover:text-foreground/80">
                    support@snapserve.ai
                  </a>
                </p>
              </div>
            </section>
          </div>

          {/* Footer link */}
          <div className="mt-12 pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Also see our{" "}
              <Link href="/terms">
                <span className="text-foreground underline underline-offset-2 hover:text-foreground/80 cursor-pointer">
                  Terms of Service
                </span>
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
