import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

const msalConfiguration: Configuration = {
  auth: {
    clientId:                 import.meta.env.VITE_SP_CLIENT_ID as string,
    authority:                `https://login.microsoftonline.com/${import.meta.env.VITE_TENANT_ID as string}`,
    redirectUri:              import.meta.env.VITE_REDIRECT_URI ?? window.location.origin,
    postLogoutRedirectUri:    import.meta.env.VITE_REDIRECT_URI ?? window.location.origin,
  },
  cache: {
    cacheLocation: "localStorage",
  },
  system: {
    iframeBridgeTimeout:       10000,
    redirectNavigationTimeout: 10000,
    tokenRenewalOffsetSeconds: 300,
  },
};

export const msalInstance = new PublicClientApplication(msalConfiguration);

export const DATAVERSE_SCOPE = `${import.meta.env.VITE_DATAVERSE_URL as string}/.default`;

// openid/profile/email establish the session; no User.Read needed (no RBAC group resolution)
export const LOGIN_SCOPES = ["openid", "profile", "email"];
