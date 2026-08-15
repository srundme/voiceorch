# Partner white-label domains — setup guide for the team

**Goal:** Let partners give clients a branded login URL:

- **Phase A (required first):** `https://acme.snapserve.ai`
- **Phase B (optional later):** `https://app.partnerbrand.com`

**Owner:** infra / DNS + one product QA pass  
**App code status:** already shipped on `main` (Partner Hub → Settings → “Your domain”)  
**Primary production app:** `https://app.snapserve.ai`

---

## 1. What already exists in the product

Partners can already (after deploy):

1. Open **Partner Hub → Settings**
2. Claim a **SnapServe subdomain** slug (e.g. `acme` → `acme.snapserve.ai`)
3. Optionally enter a **custom domain** and get DNS instructions
4. Click **Verify DNS** when ready

Clients sign in with **email and password** on the partner host (Google is disabled there). Partners create client accounts from Partner Hub and customize login logo / headline / subtitle. The same universal `/sign-in` page brands itself from the Host.

**Without DNS/TLS below, the Settings UI works but `*.snapserve.ai` will not open in a browser.**

---

## 2. Architecture (short)

| Piece | Responsibility |
|---|---|
| Partner sets slug in SnapServe | Stored in DB (`partners.slug`) |
| `*.snapserve.ai` DNS | Points all partner subdomains to the same dashboard/app edge |
| TLS (HTTPS) | Wildcard cert for `*.snapserve.ai` |
| SnapServe app | Reads `Host` header → loads that partner’s branding |
| Login | Universal `/sign-in` gateway; partner hosts show email/password only (no Google) |

Same app binary serves:

- `app.snapserve.ai` (main SnapServe)
- `acme.snapserve.ai` (partner A)
- `other.snapserve.ai` (partner B)

No separate deploy per partner.

---

## 3. Prerequisites

Access needed:

- [ ] Cloudflare (or wherever `snapserve.ai` DNS is managed)
- [ ] Railway project that serves `app.snapserve.ai` (dashboard + API)
- [ ] Ability to set Railway environment variables
- [ ] A partner test account in production (or Admin “view as” a partner)
- [ ] Ability to create a test client invite

Confirm current live URL:

```bash
curl -I https://app.snapserve.ai
```

Expect `200` / `301` / `302` — not DNS failure.

---

## 4. Step A — Wildcard DNS for partner subdomains (REQUIRED)

### 4.1 Find where `app.snapserve.ai` currently points

In Cloudflare DNS for zone **`snapserve.ai`**, note the existing record for `app`:

- Usually a **CNAME** to a Railway domain, or  
- An **A/AAAA** / proxied CNAME via Cloudflare

You will mirror that target for the wildcard.

### 4.2 Add wildcard record

Create:

| Type | Name | Target / content | Proxy |
|---|---|---|---|
| `CNAME` | `*` | **Same target as `app`** (Railway hostname or current `app` destination) | Proxied (orange cloud) **recommended** |

Notes:

- Name `*` means `anything.snapserve.ai` (e.g. `acme.snapserve.ai`).
- Do **not** delete the existing `app` record.
- If Cloudflare asks about conflict with other records, keep `app` explicit; wildcard covers the rest.

### 4.3 Add CNAME target host for custom domains (recommended)

Also create a stable hostname partners will CNAME to:

| Type | Name | Target | Proxy |
|---|---|---|---|
| `CNAME` | `partners` | Same target as `app` | Proxied recommended |

Result: `partners.snapserve.ai` → same app as `app.snapserve.ai`.

Partners with custom domains will be told:

```text
CNAME  app.theirbrand.com  →  partners.snapserve.ai
```

### 4.4 TLS / HTTPS

**Preferred (Cloudflare proxied):**

1. Keep orange-cloud proxy ON for `*` and `partners`
2. SSL/TLS mode: **Full** or **Full (strict)**
3. Cloudflare issues certs covering `*.snapserve.ai`

**If not using Cloudflare proxy:**

- You need a wildcard certificate `*.snapserve.ai` on Railway / your edge
- Railway custom domains usually need each hostname added individually — that does **not** scale for many partners
- **Strong recommendation:** use Cloudflare proxy for wildcards

### 4.5 DNS sanity checks

After DNS propagates (often minutes, sometimes up to an hour):

```bash
# Should resolve (same IP/stack as app)
dig +short testpartner.snapserve.ai
dig +short partners.snapserve.ai
dig +short app.snapserve.ai

# HTTPS should respond (even before a partner claims the slug)
curl -I https://testpartner.snapserve.ai
curl -I https://partners.snapserve.ai
```

Pass criteria:

- DNS resolves
- HTTPS works (no certificate name mismatch)
- Response comes from SnapServe app (HTML or redirect), not a Cloudflare error page

---

## 5. Step B — Railway / app environment variables

On the **API server** Railway service (and dashboard if it needs the same public host knowledge), set:

| Variable | Suggested value | Purpose |
|---|---|---|
| `APP_BASE_URL` | `https://app.snapserve.ai` | Canonical SnapServe origin (already should exist) |
| `PARTNER_SUBDOMAIN_ROOT` | `snapserve.ai` | Builds `{slug}.snapserve.ai` |
| `PARTNER_CNAME_TARGET` | `partners.snapserve.ai` | Shown in Partner Settings + used in verify |

Redeploy / restart after changing env vars.

Optional check after deploy:

```bash
curl "https://app.snapserve.ai/api/public/partner-branding?host=app.snapserve.ai"
```

Expect JSON with `"branding": null` (main host is not a partner slug). That proves the public endpoint is live.

---

## 6. Step C — Product QA (subdomain)

### 6.1 Partner claims a slug

1. Log in as a **partner** (or Admin → view as partner)
2. Go to **Partner Hub → Settings**
3. Under **Your domain → SnapServe subdomain**, enter e.g. `qaacme`
4. Click **Save**
5. Confirm preview link: `https://qaacme.snapserve.ai`

### 6.2 Branding API

```bash
curl "https://app.snapserve.ai/api/public/partner-branding?host=qaacme.snapserve.ai"
```

Expect:

- `branding.companyName` = partner company
- `branding.slug` = `qaacme`
- `branding.subdomainHost` = `qaacme.snapserve.ai`
- `branding.logoUrl` if logo uploaded

### 6.3 Open the subdomain in a browser

1. Open `https://qaacme.snapserve.ai/sign-in`
2. Confirm the branded email/password login loads over HTTPS (partner logo + title)
3. Confirm **Google is not shown**
4. Sign in with a client email/password created in Partner Hub

### 6.4 Partner client path

1. From Partner Hub → Clients → **Create client** (email + password)
2. Tell the client to open **`https://qaacme.snapserve.ai/sign-in`** (not `app.snapserve.ai`)
3. Client signs in with email/password
4. Confirm:
   - Session works
   - Partner logo / “Powered by …” branding appears for managed clients

---

## 7. Step D — Custom domain (Phase B, after subdomain works)

Only do this after Step A–C pass.

### 7.1 In Partner Settings

1. Enter custom domain, e.g. `app.partnerbrand.com`
2. Save → status **Pending DNS**
3. Copy the instructions shown (CNAME and/or TXT)

Typical instructions:

```text
CNAME  app.partnerbrand.com  →  partners.snapserve.ai

OR

TXT  _snapserve-verify.app.partnerbrand.com  =  snapserve-verify=<token>
```

### 7.2 At the partner’s DNS provider

Add the CNAME (preferred) or TXT record exactly as shown.

Also ensure the custom hostname can get HTTPS:

- If traffic ends on Cloudflare in front of SnapServe, you may need Cloudflare for SaaS / custom hostnames later for many partners
- For the first pilot partner, adding the hostname in Cloudflare (Custom Hostnames / SaaS) or as an extra Railway custom domain may be required for TLS

> **Pilot tip:** first prove subdomain (`*.snapserve.ai`). Treat real custom domains as a second infra project if TLS for arbitrary customer domains is not ready.

### 7.3 Verify in product

1. Wait for DNS (check with `dig`)
2. In Partner Settings click **Verify DNS**
3. Status should become **Active**
4. Open `https://app.partnerbrand.com` and repeat login test

If Verify fails, the UI/API error text usually includes what DNS is missing.

---

## 8. Pass / fail checklist

| # | Check | Pass? |
|---|---|---|
| 1 | Partner Settings shows “Your domain” | ☐ |
| 2 | `*.snapserve.ai` DNS exists and resolves | ☐ |
| 3 | `https://qaacme.snapserve.ai` loads with valid TLS | ☐ |
| 4 | Branding API returns partner for that host | ☐ |
| 5 | Email/password login works on partner subdomain | ☐ |
| 6 | Invited client can use partner URL | ☐ |
| 7 | (Optional) Custom domain verify → Active | ☐ |

---

## 9. Rollback / safe defaults

If something breaks:

1. Remove or disable the `*` DNS record temporarily (keeps `app.snapserve.ai` working)
2. Partners can still use `https://app.snapserve.ai` as today
3. Slugs saved in DB are harmless if DNS is down — they just won’t resolve

Do **not** enable Google Sign-In on partner hosts. Partner clients are provisioned with email + password from the Partner Hub.

---

## 10. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Settings UI missing “Your domain” | Deploy not live / old frontend | Confirm Railway deploy of latest `main` |
| Branding API 500 | Migration `0107_partner_domains` not applied | Check API logs / DB migrations on boot |
| `qaacme.snapserve.ai` NXDOMAIN | Wildcard DNS missing | Add `*` CNAME |
| Browser SSL error on subdomain | No wildcard TLS / proxy off | Enable Cloudflare proxy or wildcard cert |
| Opens but always looks like main SnapServe | Host not reaching app / wrong service | Confirm wildcard points to same app as `app` |
| Login fails / Google button still visible | Host not resolving to partner | Confirm slug/custom domain saved & active; branding API returns logo/title |
| Custom Verify fails | CNAME/TXT wrong or not propagated | `dig CNAME` / `dig TXT`; wait; fix record |

Useful dig commands:

```bash
dig CNAME app.partnerbrand.com +short
dig TXT _snapserve-verify.app.partnerbrand.com +short
```

---

## 11. What to tell partners (once infra is live)

Short partner instructions you can copy:

1. Go to **Partner Hub → Settings**
2. Under **Your domain**, choose a subdomain (letters/numbers/hyphens), e.g. `acme`
3. Upload logo + company name
4. Share this login link with your clients: `https://acme.snapserve.ai`
5. Create clients in Partner Hub with email + password (they sign in on that link — no Google)
6. (Optional) Add your own domain later with the DNS steps shown in Settings

---

## 12. Follow-ups (product, not blocking infra)

Nice-to-haves after DNS works:

- Invite emails should deep-link to the partner subdomain/custom domain automatically
- Login page should show partner logo before sign-in when Host is a partner domain
- Cloudflare for SaaS for scalable custom-domain TLS

Ask engineering if you want those next.

---

## 13. Quick owner summary

**You must do now:**

1. Add Cloudflare DNS `*` → same target as `app`
2. Add `partners.snapserve.ai` → same target
3. Ensure HTTPS works for a test subdomain
4. Set `PARTNER_SUBDOMAIN_ROOT` + `PARTNER_CNAME_TARGET` on Railway
5. QA with one partner slug + one created client (email/password) + login branding

**You can defer:**

- Real customer custom domains / Cloudflare for SaaS at scale
