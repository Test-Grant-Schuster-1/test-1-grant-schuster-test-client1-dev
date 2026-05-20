# Performance Enabler frontend template

This repository is a **GitHub template** for Performance Enabler Digital Platform client apps. Do not commit changes here directly — clone it, customise locally, and use the **"Use this template"** button to generate per-client repositories.

Repos generated from this template are populated by the platform's `provisionAppIntegrated` Function (or by the self-service provisioning script for pull-request / export-only modes). The CI workflow expects six GitHub Action secrets to be set on the generated repository:

| Secret | Source |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Auto-set by `az staticwebapp create` (or by `provisionAppIntegrated`) |
| `VITE_DATAVERSE_URL` | The client's app-data Dataverse URL |
| `VITE_TENANT_ID` | The client's Entra tenant ID |
| `VITE_SP_CLIENT_ID` | The client's published-app Entra App Registration client ID |
| `VITE_REDIRECT_URI` | The SWA's `https://*.azurestaticapps.net` URL |
| `VITE_APP_SLUG` | The app's slug (matches a `*.app.json` file in `public/`) |

For more, see [platform docs](https://github.com/Simply-Now-Enabler/) (operator-internal).
