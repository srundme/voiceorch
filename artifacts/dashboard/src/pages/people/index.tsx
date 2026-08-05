/**
 * Leads — CSV / list of who you reach.
 * Sheets, website forms, and Meta live under Connections.
 */

import { StripePage } from "@/components/stripe-page";
import CampaignsPage from "@/pages/campaigns/index";

export default function PeoplePage() {
  return (
    <StripePage
      title="Leads"
      description="Upload a CSV or manage lists. Attach a list to a call plan, then Start queue."
      back={{ href: "/app/home", label: "Home" }}
      fullBleed
      contentClassName="!px-0 !py-0 max-w-none"
    >
      <CampaignsPage mode="lists" />
    </StripePage>
  );
}
