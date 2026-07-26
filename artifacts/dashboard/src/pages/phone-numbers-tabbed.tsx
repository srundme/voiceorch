/**
 * /app/phone-numbers — tabbed page
 * Tabs: My numbers | Buy number | Verification (KYC)
 *
 * "My numbers" and "Buy number" both render PhoneNumbersPage which already
 * handles listing and purchasing in one view.
 * "Verification" renders the standalone KYC page.
 */
import { PageTabs } from "@/components/page-tabs";
import PhoneNumbersPage from "@/pages/phone-numbers";
import KycPage from "@/pages/kyc";

export default function PhoneNumbersTabPage() {
  return (
    <PageTabs
      defaultTab="my-numbers"
      tabs={[
        {
          key: "my-numbers",
          label: "My numbers",
          content: <PhoneNumbersPage />,
        },
        {
          key: "buy-number",
          label: "Buy number",
          content: <PhoneNumbersPage />,
        },
        {
          key: "verification",
          label: "Verification",
          content: <KycPage />,
        },
      ]}
    />
  );
}
