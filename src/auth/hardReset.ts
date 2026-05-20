import type { IPublicClientApplication } from "@azure/msal-browser";

export async function hardReset(msalInstance: IPublicClientApplication): Promise<void> {
  for (const storage of [localStorage, sessionStorage]) {
    const keysToRemove = Object.keys(storage).filter((k) => k.startsWith("msal."));
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  }
  await msalInstance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
}
