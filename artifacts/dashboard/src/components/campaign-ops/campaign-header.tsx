export function CampaignExecutionStrip({
  calling,
  talking,
  slotsUsed,
  concurrencyLimit,
}: {
  calling: number;
  talking: number;
  slotsUsed: number;
  concurrencyLimit: number | string;
}) {
  return (
    <p className="mt-2 text-xs tabular-nums text-muted-foreground">
      Calling: {calling}
      <span className="mx-2 text-border">|</span>
      Talking: {talking}
      <span className="mx-2 text-border">|</span>
      Slots: {slotsUsed} / {concurrencyLimit}
    </p>
  );
}
