import { useEffect } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { FileText, CheckCircle, AlertTriangle, Copyright, Scale, Ban, Globe, Mail, Gavel } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function TermsPage() {
  useEffect(() => {
    document.title = "Terms of Service \u00b7 SnapServe AI";
    return () => {
      document.title = "SnapServe";
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <PageHeader href="/" showSarvamCoBrand />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-2xl font-semibold text-foreground">Terms of Service</h1>
            <p className="mt-1 text-sm text-muted-foreground">Last updated: June 2026</p>
          </div>

          {/* Intro */}
          <p className="text-sm text-muted-foreground mb-10 leading-relaxed">
            Welcome to SnapServe AI. These Terms of Service ("Terms") govern your access to and use of the SnapServe AI platform ("Service"), operated by SnapServe AI ("Company", "we", "us", or "our"). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree to these Terms, you may not access or use the Service.
          </p>

          {/* Sections */}
          <div className="space-y-10">
            {/* 1. Acceptance of Terms */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">1. Acceptance of Terms</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>By creating an account, accessing, or using SnapServe AI, you confirm that:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>You are at least 18 years of age or the legal age of majority in your jurisdiction.</li>
                  <li>You have the legal capacity to enter into a binding agreement.</li>
                  <li>You will comply with all applicable laws, regulations, and these Terms.</li>
                  <li>The information you provide during registration is accurate, complete, and up to date.</li>
                </ul>
                <p>We reserve the right to modify these Terms at any time. We will notify you of significant changes by posting the updated Terms on our website and updating the "Last updated" date. Continued use of the Service after changes constitutes acceptance of the new Terms.</p>
              </div>
            </section>

            {/* 2. Description of Service */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">2. Description of the Service</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>SnapServe AI is an AI Voice Agent Orchestration platform that provides:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Creation and management of AI-powered voice agents for automated phone conversations.</li>
                  <li>Integration with telephony providers (Twilio, Plivo, Vobiz) for outbound and inbound calling.</li>
                  <li>Integration with AI providers (OpenAI, Anthropic, Google, etc.) for speech-to-text, language understanding, and text-to-speech.</li>
                  <li>Google Calendar integration for automated meeting scheduling and Google Meet link generation.</li>
                  <li>Campaign management for outbound calling at scale.</li>
                  <li>Call analytics, transcription, and recording (when enabled).</li>
                </ul>
                <p>You are responsible for configuring your own provider API keys (ASR, LLM, TTS, telephony) and ensuring compliance with each provider's terms of service. SnapServe AI provides the orchestration layer but does not provide the underlying AI or telephony services directly.</p>
              </div>
            </section>

            {/* 3. User Responsibilities */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">3. User Responsibilities</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>As a user of SnapServe AI, you agree to:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Provide accurate and complete information when creating your account and connecting third-party services.</li>
                  <li>Maintain the security of your account credentials and API keys. You are responsible for all activity under your account.</li>
                  <li>Obtain proper consent from individuals before calling them using our platform, in compliance with applicable laws (e.g., TCPA, GDPR, TRAI regulations).</li>
                  <li>Ensure you have the legal right to use the phone numbers and contacts you upload to the platform.</li>
                  <li>Comply with all applicable telemarketing, privacy, and data protection laws in your jurisdiction.</li>
                  <li>Monitor your usage and wallet balance to avoid service interruptions.</li>
                  <li>Not interfere with or disrupt the Service or its infrastructure.</li>
                </ul>
              </div>
            </section>

            {/* 4. Prohibited Uses */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Ban className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">4. Prohibited Uses</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>You may not use SnapServe AI for any of the following:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Any illegal, fraudulent, or harmful purpose, including scams, phishing, or impersonation.</li>
                  <li>Harassment, abuse, or threatening behavior toward individuals.</li>
                  <li>Calling numbers on the Do Not Call (DNC) registry or individuals who have opted out.</li>
                  <li>Spoofing caller ID or misrepresenting your identity.</li>
                  <li>Recording calls without proper consent where required by law.</li>
                  <li>Distributing malware, viruses, or other malicious code.</li>
                  <li>Attempting to gain unauthorized access to our systems or other users' accounts.</li>
                  <li>Reselling or redistributing the Service without written authorization.</li>
                  <li>Using the Service to generate spam or unsolicited communications.</li>
                  <li>Reverse engineering, decompiling, or disassembling any part of the Service.</li>
                </ul>
                <p>Violation of these prohibitions may result in immediate suspension or termination of your account, and we may report illegal activity to the appropriate authorities.</p>
              </div>
            </section>

            {/* 5. Intellectual Property */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Copyright className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">5. Intellectual Property</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>All content, software, and materials provided by SnapServe AI, including but not limited to:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>The SnapServe AI platform, website, and mobile interfaces.</li>
                  <li>Logos, trademarks, brand names, and trade dress.</li>
                  <li>Software code, algorithms, and documentation.</li>
                  <li>User interfaces, designs, and visual elements.</li>
                </ul>
                <p>are the intellectual property of SnapServe AI and are protected by copyright, trademark, and other intellectual property laws. You may not use, copy, modify, or distribute our intellectual property without express written permission.</p>
                <p>You retain ownership of your data, including call recordings, transcripts, and contact lists. You grant us a limited license to process and store your data solely for the purpose of providing the Service.</p>
              </div>
            </section>

            {/* 6. Limitation of Liability */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">6. Limitation of Liability</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>To the maximum extent permitted by law:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>SnapServe AI is provided "as is" and "as available" without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement.</li>
                  <li>We do not warrant that the Service will be uninterrupted, error-free, or secure at all times.</li>
                  <li>We are not responsible for the quality, accuracy, or legality of AI-generated responses during calls. The AI providers you connect are responsible for their model outputs.</li>
                  <li>We are not liable for any indirect, incidental, special, consequential, or punitive damages, including lost profits, data loss, or business interruption, arising from your use of the Service.</li>
                  <li>Our total liability for any claim arising from these Terms or the Service shall not exceed the amount you paid us in the 12 months preceding the claim, or $100, whichever is greater.</li>
                </ul>
              </div>
            </section>

            {/* 7. Termination */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Gavel className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">7. Termination</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>You may terminate your account at any time by deleting it from the Settings page. Upon termination:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Your access to the Service will be immediately revoked.</li>
                  <li>All your data will be permanently deleted within 30 days, except where retention is required by law.</li>
                  <li>Any active campaigns or scheduled calls will be cancelled.</li>
                  <li>Any remaining wallet balance will be forfeited unless otherwise agreed.</li>
                </ul>
                <p>We may suspend or terminate your account immediately if you violate these Terms, engage in illegal activity, or if required by law. We will notify you of such termination where possible.</p>
              </div>
            </section>

            {/* 8. Governing Law */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">8. Governing Law</h2>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. Any dispute arising from these Terms or the Service shall be resolved through binding arbitration in Bengaluru, India, in accordance with the Arbitration and Conciliation Act, 1996. Each party waives any objection to this venue.</p>
                <p>Notwithstanding the above, either party may seek injunctive relief in a court of competent jurisdiction to prevent irreparable harm pending the resolution of arbitration.</p>
              </div>
            </section>

            {/* 9. Contact */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">9. Contact Information</h2>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                <p>
                  If you have any questions about these Terms of Service, please contact us at:{" "}
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
              <Link href="/privacy">
                <span className="text-foreground underline underline-offset-2 hover:text-foreground/80 cursor-pointer">
                  Privacy Policy
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
