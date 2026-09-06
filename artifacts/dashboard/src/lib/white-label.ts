/**
 * Host-level white-label (partner subdomain / custom domain).
 * Apply before React paint so clients never see SnapServe chrome or ads pixels.
 */

export type HostBrand = {
  partnerId: number;
  companyName: string;
  logoUrl: string | null;
  loginTitle: string | null;
  loginSubtitle: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  docsUrl?: string | null;
  termsUrl?: string | null;
  privacyUrl?: string | null;
};

export function isDirectSnapServeHost(hostname = typeof window === "undefined" ? "" : window.location.hostname): boolean {
  const h = hostname.toLowerCase().split(":")[0] ?? "";
  if (!h) return true;
  if (h === "app.snapserve.ai" || h === "www.snapserve.ai" || h === "snapserve.ai") return true;
  if (h === "voiceorch-development.up.railway.app") return true;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

export function applyWhiteLabelChrome(brand: HostBrand | null): void {
  if (typeof document === "undefined") return;
  if (!brand) return;

  document.title = brand.companyName;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", brand.companyName);
  for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector(sel)?.setAttribute("content", brand.companyName);
  }
  for (const sel of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    document.querySelector(sel)?.setAttribute("content", brand.loginSubtitle || brand.companyName);
  }

  const href = brand.logoUrl || "";
  if (href) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = href;
  }
}

let cachedBrand: HostBrand | null = null;
let hostBrandPromise: Promise<HostBrand | null> | null = null;

export function getCachedHostBrand(): HostBrand | null {
  return cachedBrand;
}

/** Product name in titles / in-app chrome. Partner hosts never say SnapServe. */
export function hostProductName(): string {
  if (isDirectSnapServeHost()) return "SnapServe";
  return cachedBrand?.companyName || "Workspace";
}

export function loadHostBrand(): Promise<HostBrand | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (isDirectSnapServeHost()) return Promise.resolve(null);
  if (hostBrandPromise) return hostBrandPromise;
  hostBrandPromise = (async () => {
    try {
      const res = await fetch(`/api/public/partner-branding?host=${encodeURIComponent(window.location.host)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { branding: HostBrand | null };
      const brand = data.branding ?? null;
      cachedBrand = brand;
      applyWhiteLabelChrome(brand);
      return brand;
    } catch {
      return null;
    }
  })();
  return hostBrandPromise;
}
