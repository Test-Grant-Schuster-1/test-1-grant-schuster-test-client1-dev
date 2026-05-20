import {
  BrowserAuthError,
  InteractionRequiredAuthError,
  type IPublicClientApplication,
  type SilentRequest,
} from "@azure/msal-browser";

const RECOVERABLE_CODES = new Set([
  "timed_out",
  "monitor_window_timeout",
  "no_token_request_cache_error",
  "interaction_in_progress",
]);

/**
 * Acquires an access token silently, auto-recovering from stale-cache and
 * session-timeout failures via redirect. Non-recoverable errors are re-thrown.
 *
 * Never call this in mock auth mode — the caller must guard with VITE_MOCK_AUTH.
 */
export async function acquireToken(
  msalInstance: IPublicClientApplication,
  request: SilentRequest,
): Promise<string> {
  try {
    const result = await msalInstance.acquireTokenSilent(request);
    return result.accessToken;
  } catch (err) {
    const isRecoverable =
      err instanceof InteractionRequiredAuthError ||
      (err instanceof BrowserAuthError && RECOVERABLE_CODES.has(err.errorCode));

    if (!isRecoverable) throw err;

    if (request.account) {
      await msalInstance.clearCache({ account: request.account });
    }
    await msalInstance.acquireTokenRedirect({
      account: request.account,
      scopes:  request.scopes,
    });
    return null as unknown as string; // navigation pending — unreachable
  }
}
