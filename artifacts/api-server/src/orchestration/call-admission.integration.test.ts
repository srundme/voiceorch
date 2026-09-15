import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveCall, type CallLease } from "./call-admission.js";
const leases: CallLease[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(leases.splice(0).map(l => l.release())); });
// Run only against a dedicated disposable database, never a customer database.
describe.skipIf(process.env.ADMISSION_INTEGRATION_TEST !== "1")("PostgreSQL call reservations", () => {
  it("enforces a shared capacity limit under parallel starts", async () => {
    const tenant = `admission-test-${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reserveCall(tenant, `call-${i}`, 3, () => {})));
    for (const r of results) if (r.status === "fulfilled") leases.push(r.value);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(9);
  });
  it("grants only one owner for a duplicate call", async () => {
    const tenant = `admission-test-${randomUUID()}`;
    const results = await Promise.allSettled([reserveCall(tenant, "same", 3, () => {}), reserveCall(tenant, "same", 3, () => {})]);
    for (const r of results) if (r.status === "fulfilled") leases.push(r.value);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("fences output after the local ownership deadline, even before a delayed timer runs", async () => {
    const onLost = vi.fn();
    const lease = await reserveCall(`admission-test-${randomUUID()}`, "call", 1, onLost);
    leases.push(lease);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30000);
    expect(() => lease.assertOwned()).toThrow("ownership");
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(() => lease.assertOwned()).toThrow();
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});
