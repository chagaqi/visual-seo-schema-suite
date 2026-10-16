#!/usr/bin/env node
/**
 * Generates marketplace icons, banners and screenshots for Framer + Webflow listings.
 *
 * Screenshots are real: the built playground (playground/dist) is served locally and driven with
 * headless Chromium inside branded marketing frames.
 *
 *   npm run assets            # builds the playground first, then renders into ./assets
 */
import { createServer } from "node:http"
import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIST = join(ROOT, "playground", "dist")
const OUT = join(ROOT, "assets")

const BRAND = {
  name: "Visual SEO & Schema Suite",
  short: "Visual SEO & Schema",
  framer: { accent: "#0099ff", bg: "#111111", grad: "radial-gradient(1200px 800px at 85% 15%, rgba(0,153,255,.35), transparent 60%), #0b0b0b" },
  webflow: { accent: "#146ef5", bg: "#1e1e1e", grad: "radial-gradient(1200px 800px at 85% 15%, rgba(20,110,245,.38), transparent 60%), #111318" },
}

const LOGO = (size, accent = "#0099ff") => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#6a5cff"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M15 41.5 26 30l9 9 13.5-15.5" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48.5" cy="23.5" r="4.6" fill="#fff"/><path d="M14 51h36" stroke="rgba(255,255,255,.55)" stroke-width="3.5" stroke-linecap="round"/></svg>`

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json" }

async function serveDist() {
  try {
    await stat(join(DIST, "index.html"))
  } catch {
    throw new Error("playground/dist not found — run `npm run build -w @vss/playground` first (npm run assets does this).")
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x")
    const path = url.pathname === "/" ? "/index.html" : url.pathname
    try {
      const body = await readFile(join(DIST, decodeURIComponent(path)))
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address()
  return { server, origin: `http://127.0.0.1:${port}` }
}

const FONT = `font-family: Inter, "SF Pro Display", "Segoe UI", system-ui, -apple-system, sans-serif;`

function frameHtml({ width, height, host, headline, sub, bullets, src, uiWidth = 380 }) {
  const b = BRAND[host]
  const uiHeight = height - Math.round(height * 0.12)
  const scale = Math.min(1.6, (height * 0.8) / 720)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
  body{${FONT} background:${b.grad}; color:#fff; display:flex; align-items:center; gap:${Math.round(width * 0.05)}px; padding:0 ${Math.round(width * 0.06)}px}
  .copy{flex:1; min-width:0}
  .brand{display:flex; align-items:center; gap:14px; font-weight:600; font-size:${Math.round(height * 0.028)}px; opacity:.92; margin-bottom:${Math.round(height * 0.04)}px}
  h1{font-size:${Math.round(height * 0.072)}px; line-height:1.05; letter-spacing:-.035em; margin:0 0 ${Math.round(height * 0.03)}px; font-weight:750}
  h1 em{font-style:normal; color:${b.accent}}
  p{font-size:${Math.round(height * 0.028)}px; line-height:1.45; color:rgba(255,255,255,.72); margin:0 0 ${Math.round(height * 0.035)}px; max-width:34ch}
  ul{list-style:none; padding:0; margin:0; display:grid; gap:${Math.round(height * 0.016)}px}
  li{font-size:${Math.round(height * 0.024)}px; color:rgba(255,255,255,.86); display:flex; gap:10px; align-items:center}
  li::before{content:""; width:${Math.round(height * 0.016)}px; height:${Math.round(height * 0.016)}px; border-radius:50%; background:${b.accent}; box-shadow:0 0 0 4px ${b.accent}33; flex:none}
  .device{flex:none; width:${uiWidth * scale}px; height:${uiHeight}px; border-radius:${14 * scale}px; overflow:hidden; background:${b.bg};
    box-shadow:0 0 0 1px rgba(255,255,255,.1), 0 30px 80px rgba(0,0,0,.6), 0 0 120px ${b.accent}22}
  iframe{border:0; width:${uiWidth}px; height:${uiHeight / scale}px; transform:scale(${scale}); transform-origin:0 0; display:block}
  </style></head><body>
  <div class="copy"><div class="brand">${LOGO(Math.round(height * 0.05), b.accent)}<span>${BRAND.name}</span></div>
  <h1>${headline}</h1><p>${sub}</p><ul>${bullets.map((x) => `<li>${x}</li>`).join("")}</ul></div>
  <div class="device"><iframe src="${src}" title="Plugin UI"></iframe></div>
  </body></html>`
}

const SCENES = [
  {
    key: "alt-text",
    headline: "Bulk alt text.<br><em>Zero API keys.</em>",
    sub: "A deterministic engine reads filenames, layer names, captions and CMS titles to write WCAG-friendly alt text for hundreds of images.",
    bullets: ["Smart filename + context parser", "Confidence scores & decorative detection", "Optional bring-your-own AI key"],
    act: async (f) => {
      await f.getByLabel("Image scope").selectOption("page")
      await f.getByRole("button", { name: "Scan" }).click()
      await f.getByTestId("generate-alt").click()
      await f.getByText(/Generated/).waitFor()
    },
  },
  {
    key: "cms",
    headline: "CMS updates that<br><em>never hit 429.</em>",
    sub: "Throttled batch writes with exponential back-off and Retry-After awareness. Update every collection item safely.",
    bullets: ["Token-bucket rate limiting", "Auto-resume after rate limits", "Per-item error isolation"],
    act: async (f) => {
      await f.getByRole("tab", { name: "CMS" }).click()
      await f.getByTestId("load-collections").click()
      await f.getByLabel("Collection").selectOption("blog")
      await f.getByText(/items loaded/).waitFor()
      await f.getByLabel("Task").selectOption("meta")
      await f.getByTestId("preview-cms").click()
      await f.getByTestId("cms-row").first().waitFor()
    },
  },
  {
    key: "audit",
    headline: "WCAG AA & AAA<br><em>in one pass.</em>",
    sub: "Contrast checker with closest-passing color suggestions, plus a page audit for alt text, headings, links and tap targets.",
    bullets: ["WCAG 2.2 success criteria", "One-click fixes", "Color-blindness preview"],
    act: async (f) => {
      await f.getByRole("tab", { name: "Contrast & A11y" }).click()
      await f.getByLabel("Text color", { exact: true }).fill("#555555")
      await f.getByTestId("run-audit").click()
      await f.getByTestId("audit-issue").first().waitFor()
    },
  },
  {
    key: "schema",
    headline: "Visual JSON-LD<br><em>with live validation.</em>",
    sub: "LocalBusiness, Product, FAQ, Article and SoftwareApplication schema — validated against Google's rich result rules as you type.",
    bullets: ["Rich-result eligibility check", "Injects into the page &lt;head&gt;", "Import FAQs from your page"],
    act: async (f) => {
      await f.getByRole("tab", { name: "Schema" }).click()
      await f.getByTestId("load-example").click()
      await f.getByTestId("schema-validation").getByText("Valid").waitFor()
      await f.getByText("Live JSON-LD").scrollIntoViewIfNeeded()
    },
  },
]

async function renderScene(browser, origin, { host, width, height, scene, out }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(frameHtml({ width, height, host, ...scene, src: `${origin}/?theme=${host}&embed=1` }), { waitUntil: "load" })
  const frame = page.frameLocator("iframe")
  await frame.getByRole("tab", { name: "Alt text" }).waitFor()
  await scene.act(frame)
  await page.waitForTimeout(250)
  await page.screenshot({ path: out })
  await page.close()
}

async function renderHtml(browser, { width, height, html, out, omitBackground = false }) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(html, { waitUntil: "load" })
  await page.screenshot({ path: out, omitBackground })
  await page.close()
}

async function main() {
  await mkdir(join(OUT, "framer"), { recursive: true })
  await mkdir(join(OUT, "webflow"), { recursive: true })
  await mkdir(join(OUT, "brand"), { recursive: true })

  await writeFile(join(OUT, "brand", "logo.svg"), LOGO(512))
  await copyFile(join(ROOT, "packages", "framer-plugin", "public", "icon.svg"), join(OUT, "framer", "icon.svg"))

  const { server, origin } = await serveDist()
  const browser = await chromium.launch()
  const written = []
  try {
    const icon = (size, accent, radiusPad = 0) =>
      `<html><body style="margin:0;background:transparent;display:grid;place-items:center;width:${size}px;height:${size}px">${LOGO(size - radiusPad * 2, accent)}</body></html>`

    // Framer: 30×30 SVG icon in framer.json (+ 90×90 raster as recommended for PNG icons).
    for (const [file, size] of [["icon-90.png", 90], ["icon-512.png", 512]]) {
      const out = join(OUT, "framer", file)
      await renderHtml(browser, { width: size, height: size, html: icon(size, BRAND.framer.accent), out, omitBackground: true })
      written.push(out)
    }
    // Webflow: 900×900 app logo (pictorial mark), 20×20 publisher logo.
    {
      const out = join(OUT, "webflow", "app-logo-900.png")
      await renderHtml(browser, {
        width: 900,
        height: 900,
        html: `<html><body style="margin:0;width:900px;height:900px;display:grid;place-items:center;background:${BRAND.webflow.grad}">${LOGO(560, BRAND.webflow.accent)}</body></html>`,
        out,
      })
      written.push(out)
      const pub = join(OUT, "webflow", "publisher-logo-20.png")
      await renderHtml(browser, { width: 20, height: 20, html: icon(20, BRAND.webflow.accent), out: pub, omitBackground: true })
      written.push(pub)
    }

    // Covers / banners
    const banners = [
      { host: "framer", width: 1600, height: 1200, scene: SCENES[0], out: join(OUT, "framer", "cover-1600x1200.png") },
      { host: "framer", width: 1920, height: 1080, scene: SCENES[3], out: join(OUT, "banner-1920x1080.png") },
      { host: "framer", width: 1200, height: 630, scene: SCENES[0], out: join(OUT, "og-1200x630.png") },
    ]
    // Screenshots: Framer (1600×1200 frames) and Webflow (1280×846, as listed in Webflow's guide).
    SCENES.forEach((scene, i) => {
      banners.push({ host: "framer", width: 1600, height: 1200, scene, out: join(OUT, "framer", `screenshot-${i + 1}-${scene.key}.png`) })
      banners.push({ host: "webflow", width: 1280, height: 846, scene, out: join(OUT, "webflow", `screenshot-${i + 1}-${scene.key}-1280x846.png`) })
    })
    for (const b of banners) {
      await renderScene(browser, origin, b)
      written.push(b.out)
    }
  } finally {
    await browser.close()
    server.close()
  }
  for (const f of written) console.log("✓", f.replace(`${ROOT}/`, ""))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
