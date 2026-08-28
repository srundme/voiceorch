/**
 * Who must receive booking mail (From = linked Google Calendar account):
 * - customer: email spoken to the AI (attendee)
 * - organizer: calendar hostEmail + connected Google account email
 * - additional hosts
 */

function pushUnique(out: string[], seen: Set<string>, raw: string | null | undefined): void {
  const e = (raw ?? "").trim();
  if (!e) return;
  const key = e.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(e);
}

export function collectBookingMailRecipients(opts: {
  attendeeEmail: string;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
  /** Connected Google Calendar account (true invite From / calendar owner). */
  organizerEmail?: string | null;
}): { customer: string | null; hosts: string[]; all: string[] } {
  const seen = new Set<string>();
  const customerList: string[] = [];
  pushUnique(customerList, seen, opts.attendeeEmail);
  const customer = customerList[0] ?? null;

  const hosts: string[] = [];
  // Host list starts fresh so customer is not duplicated as a "host" copy,
  // but organizer + additional hosts always get their own mail.
  const hostSeen = new Set<string>(customer ? [customer.toLowerCase()] : []);
  pushUnique(hosts, hostSeen, opts.hostEmail);
  for (const h of opts.additionalHosts ?? []) {
    pushUnique(hosts, hostSeen, h);
  }
  // Calendar owner must be notified even when hostEmail is empty / different
  // (Google never emails the organizer guest invite to themselves).
  pushUnique(hosts, hostSeen, opts.organizerEmail);

  const allSeen = new Set<string>();
  const all: string[] = [];
  pushUnique(all, allSeen, customer);
  for (const h of hosts) pushUnique(all, allSeen, h);
  return { customer, hosts, all };
}
