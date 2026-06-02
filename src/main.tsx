// Client thin-shell boot. The runtime SPA ships as the @simply-now-enabler package; this file is the
// only code in the repo. It reads the build-time VITE_* config (injected by the deploy workflow as
// GitHub Actions secrets), assembles a RuntimeConfig, and mounts via createApp. It mirrors the
// monorepo reference caller packages/frontend/src/main.tsx — MINUS the dev-only mock fields
// (mockAuth / mockSchema / devAccessToken). Shipping a dev field here = silent mock-mode in production.
import { createApp, type RuntimeConfig } from "@simply-now-enabler/performance-enabler-frontend";
import "@simply-now-enabler/performance-enabler-frontend/style.css";

const env = import.meta.env;

const config: RuntimeConfig = {
  appSlug:      env.VITE_APP_SLUG as string,
  dataverseUrl: env.VITE_DATAVERSE_URL as string,
  tenantId:     env.VITE_TENANT_ID as string,
  spClientId:   env.VITE_SP_CLIENT_ID as string,
  redirectUri:  env.VITE_REDIRECT_URI as string,
  env:          env.VITE_ENV as string | undefined,
  // NO mockAuth / mockSchema / devAccessToken — real MSAL auth + real Dataverse.
};

const host = document.getElementById("root");
if (!host) throw new Error("#root element not found");

createApp({ host, config });
