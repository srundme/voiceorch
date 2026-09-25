/** Base URL of the GPU process that serves Irfan's ear, brain, and voice. */
export function irfanPodBaseUrl(): string {
  const raw = (process.env["IRFAN_POD_URL"] ?? "").trim().replace(/\/$/, "");
  if (!raw) {
    throw new Error("IRFAN_POD_URL is not set");
  }
  return raw;
}
