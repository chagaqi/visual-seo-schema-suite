import "@framer/plugin/framer.css"
import "@vss/ui-kit/styles.css"

import React from "react"
import ReactDOM from "react-dom/client"
import { framer } from "@framer/plugin"
import { LicenseClient } from "@vss/core-engine"
import { SuiteApp } from "@vss/ui-kit"
import { createFramerAdapter, type FramerApi } from "./framerAdapter.ts"
import { CHECKOUT_URL, LICENSE_API_URL } from "./config.ts"

void framer.showUI({
  position: "top right",
  width: 380,
  height: 640,
  minWidth: 320,
  minHeight: 420,
  resizable: true,
})

const adapter = createFramerAdapter(framer as FramerApi)
const license = LICENSE_API_URL
  ? new LicenseClient({
      baseUrl: LICENSE_API_URL,
      host: "framer",
      getUserId: async () => (await adapter.getUser()).id,
      storage: adapter.deviceStorage,
    })
  : null

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <SuiteApp adapter={adapter} theme="framer" license={license} checkoutUrl={CHECKOUT_URL} />
  </React.StrictMode>,
)
