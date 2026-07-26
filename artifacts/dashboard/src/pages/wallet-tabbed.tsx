/**
 * /app/wallet — tabbed page (shown as "Billing" in the nav)
 * Tabs: Wallet (balance, top-up) | Usage (cost breakdown)
 */
import { PageTabs } from "@/components/page-tabs";
import WalletPage from "@/pages/wallet";
import UsagePage from "@/pages/usage";

export default function WalletTabPage() {
  return (
    <PageTabs
      defaultTab="wallet"
      tabs={[
        {
          key: "wallet",
          label: "Wallet",
          content: <WalletPage />,
        },
        {
          key: "usage",
          label: "Usage",
          content: <UsagePage />,
        },
      ]}
    />
  );
}
