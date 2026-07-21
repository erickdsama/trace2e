import { defineConfig } from "wxt";

// Pins a stable extension id for unpacked/dev loads and CRX packing
// (id: jbbacjmlabncoinbnddpgcjgjkomeknp). The Chrome Web Store assigns/signs the id itself
// and REJECTS uploads containing `key`, so it is omitted when WEBSTORE=1 (used for the
// store zip: `WEBSTORE=1 pnpm --filter @trace2e/extension zip`).
const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxUr75yggg3GdC5mZ1xdrFZ/m0piuxhbJDYC3zPPtA/pSQJ6R6gO5Odx6G4nUsDOUbHwz34KP8uuheprus7l20CK52pk22S9mUvNAITAUCdnSRKcqHtLrSK5S5nvR4Rn7jhSbXYHSL6R6ovFw49abS+sneUvZ80j3r3MfhuJC6wF8N6DcZ9Z35RlCjTZHOy9AiAA5xTJ0JH4fBlNTdHyaAbw6ftPOKMKKrqdm71yjkTbzvvsfnMe/xJeiXKuV5h44XTd+aVggpHR8URUhUkvwjSzl9q7b773e9cMEZNU6w+l5UDy4Tog6tm7nmsnse6CTozE12aXdJ40w3noBBL2D6wIDAQAB";

// MV3 manifest is generated from this config + the entrypoints/ directory.
export default defineConfig({
  manifest: {
    name: "trace2e recorder",
    description: "Record user interactions and generate Playwright E2E tests via Claude Code.",
    version: "0.1.0",
    ...(process.env.WEBSTORE ? {} : { key: DEV_KEY }),
    permissions: ["activeTab", "storage", "sidePanel", "webNavigation", "tabs"],
    // Local daemon on loopback is always allowed; a hosted daemon's origin is requested at
    // runtime (see the side panel's Save Settings) via optional_host_permissions.
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    optional_host_permissions: ["https://*/*"],
    action: { default_title: "trace2e" },
    side_panel: { default_path: "sidepanel.html" },
  },
});
