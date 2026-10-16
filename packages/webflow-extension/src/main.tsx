import "@vss/ui-kit/styles.css"

import React from "react"
import ReactDOM from "react-dom/client"
import { LicenseClient } from "@vss/core-engine"
import { SuiteApp } from "@vss/ui-kit"
import { CHECKOUT_URL, LICENSE_API_URL } from "./config.ts"
import { createWebflowAdapter, type WebflowDesignerApi } from "./webflowAdapter.ts"

async function start() {
  if (import.meta.env.MODE === "e2e") {
    // Tree-shaken from production builds: MODE is replaced statically.
    const { installFakeWebflow } = await import("./testing/fakeWebflow.ts")
    installFakeWebflow()
  }
  const designer = (globalThis as unknown as { webflow?: WebflowDesignerApi & Pick<WebflowApi, "setExtensionSize"> }).webflow
  if (!designer) {
    document.getElementById("root")!.textContent = "Open this extension from the Webflow Designer (Apps panel)."
    return
  }
  void designer.setExtensionSize?.("comfortable")

  const adapter = createWebflowAdapter(designer, {
    // api.webflow.com has no CORS: CMS calls go through the license worker proxy.
    ...(LICENSE_API_URL ? { dataApiBaseUrl: `${LICENSE_API_URL.replace(/\/$/, "")}/v1/webflow` } : {}),
  })
  const license = LICENSE_API_URL
    ? new LicenseClient({ baseUrl: LICENSE_API_URL, host: "webflow", getUserId: async () => (await adapter.getUser()).id, storage: adapter.deviceStorage })
    : null

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <SuiteApp adapter={adapter} theme="webflow" license={license} checkoutUrl={CHECKOUT_URL} />
    </React.StrictMode>,
  )
}

void start()
