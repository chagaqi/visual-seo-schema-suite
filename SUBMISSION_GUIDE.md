# Submission Guide — Visual SEO & Schema Suite

How to ship this monorepo to the **Framer Plugin Marketplace** and the **Webflow Apps Marketplace** (Designer Extension), with Polar.sh licensing behind a Cloudflare Worker.

> Marketplace requirements change. Asset sizes and limits below were checked in October 2026 against Framer's developer docs and Webflow's "Listing your app" guide. Re-check the live submission forms before you upload anything.

---

## 0. Pre-flight checklist

```bash
npm ci
npm run typecheck          # all workspaces
npm test                   # 187 Vitest unit/component tests
npm run test:e2e           # builds e2e bundles + 20 headless Chromium tests (incl. axe WCAG 2.2 AA)
npm run assets             # re-renders icons, banners, screenshots into ./assets
```

All of these must pass before you submit.

---

## 1. Deploy the license worker (Polar.sh + Cloudflare)

### 1.1 Polar.sh

1. Create an organization at <https://polar.sh> (test first in the sandbox at <https://sandbox.polar.sh>).
2. Create a **Product** named "Visual SEO & Schema Suite Pro" (one-time or subscription).
3. Add a **License Keys** benefit to it. Optional settings: activation limit, expiry.
4. Copy the **Organization ID** (Settings › General) and the product's **checkout link**.
5. Create an **Organization Access Token** with the `license_keys:read` and `license_keys:write` scopes. It's optional: without it the worker uses the public customer-portal validate endpoint.

### 1.2 Cloudflare Worker

```bash
cd packages/license-worker
npx wrangler@4 login
npx wrangler@4 kv namespace create USAGE        # paste the id into wrangler.toml
# edit wrangler.toml: POLAR_ORGANIZATION_ID, CHECKOUT_URL (and POLAR_API_BASE for sandbox)
npx wrangler@4 secret put POLAR_ACCESS_TOKEN    # optional, recommended
npm run deploy
curl https://vss-license-worker.<account>.workers.dev/health   # {"ok":true,...}
```

| Endpoint | Purpose |
|---|---|
| `POST /v1/usage/status` | Plan and remaining free credits |
| `POST /v1/usage/consume` | Spends 1 of the **10 free audits/generations per user**; returns `402` with `checkoutUrl` when they run out |
| `POST /v1/license/validate` | Validates a key with Polar; the verdict is cached in KV for 1 hour |
| `ALL /v1/webflow/*` | Allow-listed CORS proxy to `api.webflow.com/v2`, needed because the Webflow Data API rejects browser calls |

Metered features: bulk alt text, meta generation, page audit, schema install, CMS bulk runs. SVG minification and the manual contrast checker stay free.

### 1.3 Point the plugins at the worker

Create `.env.production` in **both** `packages/framer-plugin/` and `packages/webflow-extension/` (see `.env.example`):

```
VITE_LICENSE_API_URL=https://vss-license-worker.<account>.workers.dev
VITE_POLAR_CHECKOUT_URL=https://polar.sh/<org>/products/<product>
```

If you build without `VITE_LICENSE_API_URL`, metering is off and usage is unlimited. That's fine for development, but never submit a build like that.

If your plugin origins differ from the defaults (`*.framercdn.com`, `*.framer.*`, `*.webflow-ext.com`, `*.webflow.*`), add them to `ALLOWED_ORIGINS` in `wrangler.toml`.

---

## 2. Framer Plugin Marketplace

**Typical review time: 2–5 business days.**

### 2.1 Build and test inside Framer

```bash
npm run dev -w @vss/framer-plugin        # https://localhost:5173 (mkcert)
```

In Framer, open **Plugins › Development › Open Development Plugin**, then check:

- [ ] Alt text: select an image frame, then Scan → Generate → Apply. Confirm the alt text in the image settings.
- [ ] Project scope finds every `backgroundImage` (`framer.getNodesWithAttributeSet`).
- [ ] CMS tab: user collections are editable. Collections from `framer.getManagedCollections()` show as read-only.
- [ ] Schema → "Whole site" writes `framer.setCustomCode({ location: "headEnd" })`. Publish and check the page source, then run Google's [Rich Results Test](https://search.google.com/test/rich-results).
- [ ] Page-level schema copies a `<script>` tag. Paste it into Page Settings › Custom Code.
- [ ] Settings persist per project (`framer.setPluginData`). The AI key and license key stay on the device (localStorage).
- [ ] UI works in **light and dark** mode. The theme reads Framer's `--framer-color-*` variables (Framer requires both modes).

### 2.2 Package

```bash
npm run pack:framer        # vite build + framer-plugin-tools pack → plugin.zip
```

`framer.json`: `id` (6-hex, keep it stable across versions), `name`, `modes: ["canvas"]`, `icon: "/icon.svg"` (a 30×30 SVG in `public/`).

### 2.3 Listing assets (`assets/framer/`)

| File | Use |
|---|---|
| `icon.svg` | Plugin icon, 30×30 SVG (also shipped in the bundle) |
| `icon-90.png`, `icon-512.png` | Raster icon (Framer recommends 90×90 for PNG icons) and a high-res mark |
| `cover-1600x1200.png` | Marketplace cover / thumbnail |
| `screenshot-1..4-*.png` | Gallery: alt text, CMS, audit, schema |

### 2.4 Submit

1. Go to <https://www.framer.com/marketplace/dashboard> (Creator Dashboard), choose **Plugins › New**, and upload `plugin.zip`.
2. Fill the listing with the copy in §4.
3. Reviewer notes, ready to paste:
   > No account or API key needed. Select any image layer → Alt text tab → Scan → Generate → Apply. The free tier includes 10 generations; reviewer Pro key: `<create one in Polar and paste here>`.

---

## 3. Webflow Apps Marketplace (Designer Extension, API v2)

Webflow averages about 3,400 installs per app, which makes this the bigger distribution channel.

### 3.1 Register the app

1. Go to Workspace settings › **Apps & Integrations › Develop › Create an App**.
2. Enable **Designer Extension**. If you want installs to request Data API access, also enable **Data client** with the scopes `cms:read`, `cms:write`, `pages:read`, `pages:write`, `custom_code:write`.
3. Users can paste a **Site API token** (CMS read & write) in Settings › Webflow connection. The CMS bulk updater uses it through the worker proxy.

### 3.2 Develop inside the Designer

```bash
npm run build -w @vss/webflow-extension
npm run serve:designer -w @vss/webflow-extension     # webflow extension serve (port 1337)
```

Open your site in the Designer, then **Apps panel › your app › Launch development app**. Check:

- [ ] Alt text on the selected element (`webflow.getSelectedElement()`), the whole page (`getAllElements`) and site assets (`asset.setAltText`).
- [ ] Meta: Generate → Save writes `page.setTitle()` and `page.setDescription()`.
- [ ] Audit → Apply fix sets the `aria-label` **custom attribute**.
- [ ] Page schema creates a `<script type="application/ld+json">` custom element. Site-wide schema uses the custom-code API when the token has `custom_code:write`, and falls back to copy/paste otherwise.
- [ ] CMS bulk run over 100+ items completes. When the rate limit is hit you see "Webflow rate limit reached — resuming in Ns", and no items are dropped.

### 3.3 Bundle

```bash
npm run pack:webflow     # vite build + webflow extension bundle → bundle.zip
```

`webflow.json`: `{ "name", "apiVersion": "2", "publicDir": "dist", "size": "comfortable" }`. The bundle must contain `index.html` and only allowed file types (js/css/html/svg/png/…), and stay under 5 MB. It's currently about 0.6 MB.

### 3.4 Listing assets (`assets/webflow/`)

| File | Spec |
|---|---|
| `app-logo-900.png` | App logo 900×900, 1:1, pictorial mark (no text-only logotypes) |
| `publisher-logo-20.png` | 20×20 publisher logo |
| `screenshot-1..4-*-1280x846.png` | 1280×846 screenshots (at least 4 recommended, showing key workflows) |

App name: **"Visual SEO & Schema"** (19 chars, which fits the 20-character limit). Short description ≤ 100 chars (see §4).

### 3.5 Submit

Go to App settings › **Submit for review**, upload `bundle.zip`, the assets and the listing copy, and add a privacy policy URL (host `PRIVACY.md`). Give reviewers a test site and a Pro key.

---

## 4. Listing copy

**Name:** Visual SEO & Schema Suite (Framer) / Visual SEO & Schema (Webflow)

**Tagline (≤100 chars):** Bulk alt text, meta descriptions, WCAG audits & JSON-LD schema — no API key required.

**Description:**

> Make every page accessible and search-ready in minutes.
>
> • **Bulk alt text** — a deterministic engine reads filenames, layer names, captions and CMS titles to write WCAG-friendly alt text for hundreds of images. It flags decorative images, gives each suggestion a confidence score, and can optionally use your own OpenAI or Anthropic key for the hard ones.
> • **Meta descriptions** — 120–155 character descriptions extracted from your page content, with a live Google preview and pixel-width warnings.
> • **CMS bulk updates that don't crash** — throttled batch writes with exponential back-off on HTTP 429, so large collections update reliably.
> • **WCAG AA/AAA auditor** — contrast checker with closest-passing color suggestions, color-blindness preview, and page audits for alt text, heading order, link names and tap targets.
> • **Visual JSON-LD builder** — LocalBusiness, Product, FAQPage, Article and SoftwareApplication, validated live against Google's rich-result requirements and injected into your site head.
> • **SVG minifier** — strips editor cruft and unsafe scripts, typically saving 30–70%. Free forever.
>
> Free: 10 audits/generations. Pro: unlimited.

**Categories:** SEO, Accessibility, Productivity, CMS.

---

## 5. Post-launch

- Bump `version` in package.json files and keep `framer.json` `id` stable.
- Track metered usage in the KV `usage:v1:*` records (`features` counts per feature).
- For strict quota counting under heavy concurrency, move usage records to a Durable Object. KV is eventually consistent, so a burst can occasionally grant one extra free credit.
