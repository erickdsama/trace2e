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
    version: "0.2.0",
    ...(process.env.WEBSTORE ? {} : { key: DEV_KEY }),
    permissions: ["activeTab", "storage", "sidePanel", "webNavigation", "tabs"],
    // No host_permissions needed for the daemon: the recorder's <all_urls> content script
    // match already counts as an all-hosts permission in Chrome, so extension contexts
    // (options page, side panel, background) can fetch any daemon origin CORS-exempt.
    // Verified empirically against a daemon with CORS locked to a different origin.
    action: { default_title: "trace2e" },
    side_panel: { default_path: "sidepanel.html" },
  },
});
