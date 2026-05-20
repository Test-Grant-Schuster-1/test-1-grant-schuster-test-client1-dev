import { msalInstance, DATAVERSE_SCOPE } from "./msalConfig.js";
import { acquireToken } from "./acquireToken.js";

const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === "false" ? false : import.meta.env.DEV;
const MOCK_TOKEN = import.meta.env.VITE_DEV_ACCESS_TOKEN as string | undefined;

// Decode JWT payload without verification — used only to read oid/upn for data filtering,
// not for any security decision. Token authenticity is validated by Dataverse on each API call.
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

/** Extract user identity from VITE_DEV_ACCESS_TOKEN for mock auth mode. */
export function getMockUserInfo(): { id: string; email: string } {
  if (!MOCK_TOKEN) return { id: "", email: "" };
  const p = decodeJwtPayload(MOCK_TOKEN);
  return {
    id:    (p.oid          as string | undefined) ?? "",
    email: (p.upn          as string | undefined)
        ?? (p.unique_name  as string | undefined) ?? "",
  };
}

export async function getAccessToken(): Promise<string> {
  if (MOCK_AUTH) {
    if (!MOCK_TOKEN) {
      throw new Error(
        "Running in mock auth mode but VITE_DEV_ACCESS_TOKEN is not set. " +
        "Run: az account get-access-token --resource " +
        (import.meta.env.VITE_DATAVERSE_URL as string) +
        " --query accessToken -o tsv"
      );
    }
    return MOCK_TOKEN;
  }

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) throw new Error("Not authenticated");

  return acquireToken(msalInstance, {
    account: accounts[0],
    scopes:  [DATAVERSE_SCOPE],
  });
}
