/**
 * /app/wallet — Wallet | Usage
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";
import WalletPage from "@/pages/wallet";
import UsagePage from "@/pages/usage";

export default function WalletTabPage() {
  const { isManagedWorkspace, partnerName } = usePartnerManagedWorkspace();

  return (
    <StripeTabPage
      title="Billing"
      description={
        isManagedWorkspace
          ? `Partner-funded balance · rate set by ${partnerName}`
          : "Wallet balance, rate, and usage."
      }
      defaultTab="wallet"
      tabs={[
        { key: "wallet", label: "Wallet", content: <WalletPage /> },
        { key: "usage", label: "Usage", content: <UsagePage /> },
      ]}
    />
  );
}
