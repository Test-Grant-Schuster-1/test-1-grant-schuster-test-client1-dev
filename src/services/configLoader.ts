import type { AppConfig } from "../shared/types";

export type ConfigLoadError =
  | { kind: "not-found"; slug: string }
  | { kind: "invalid-json"; detail: string }
  | { kind: "network"; detail: string };

export async function loadAppConfig(slug: string): Promise<AppConfig> {
  let response: Response;
  try {
    response = await fetch(`/${slug}.app.json`);
  } catch (err) {
    throw { kind: "network", detail: String(err) } satisfies ConfigLoadError;
  }

  if (response.status === 404) {
    throw { kind: "not-found", slug } satisfies ConfigLoadError;
  }

  if (!response.ok) {
    throw { kind: "network", detail: `HTTP ${response.status} ${response.statusText}` } satisfies ConfigLoadError;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw { kind: "invalid-json", detail: String(err) } satisfies ConfigLoadError;
  }

  return data as AppConfig;
}
