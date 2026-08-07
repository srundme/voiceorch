/**
 * /app/wallet — Wallet | Usage
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import WalletPage from "@/pages/wallet";
import UsagePage from "@/pages/usage";

export default function WalletTabPage() {
  return (
    <StripeTabPage
      title="Billing"
      description="Wallet balance, rate, and usage."
      defaultTab="wallet"
      tabs={[
        { key: "wallet", label: "Wallet", content: <WalletPage /> },
        { key: "usage", label: "Usage", content: <UsagePage /> },
      ]}
    />
  );
}
