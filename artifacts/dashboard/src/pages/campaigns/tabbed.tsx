/**
 * /app/campaigns — single Campaigns page.
 * Deep-link routes (/:id, batches, leads) are handled separately in App.tsx.
 */
import { StripePage } from "@/components/stripe-page";
import CampaignsPage from "./index";

export default function CampaignsTabPage() {
  return (
    <StripePage
      title="Campaigns"
      description="Start a campaign from Meta, Website, Google Sheets, CSV, or Zoho CRM."
      fullBleed
      contentClassName="!px-0 !py-0 max-w-none"
    >
      <CampaignsPage />
    </StripePage>
  );
}
