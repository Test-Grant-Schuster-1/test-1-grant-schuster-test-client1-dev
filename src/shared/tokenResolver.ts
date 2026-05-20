import type { ContextToken, ResolvedContext, TokenValue } from "./types.js";

const TOKEN_RE = /\$[a-zA-Z][a-zA-Z0-9_]*(?::[^\s,)}"']+)?/g;

export function isContextToken(value: unknown): value is ContextToken {
  return typeof value === "string" && value.startsWith("$");
}

export function resolveToken(
  token: string,
  context: ResolvedContext
): TokenValue {
  if (token === "$now") return new Date().toISOString();
  if (token === "$today") return new Date().toISOString().split("T")[0];

  // $param:name, $join:table.field, $hop:field1.field2, etc.
  const colonIdx = token.indexOf(":");
  if (colonIdx !== -1) {
    const key = token.slice(1); // strip leading $
    if (key in context) return context[key];
    // fall through to context lookup by full token key
  }

  // bare tokens: $currentUser, $anchorPosition, etc.
  const key = token.slice(1);
  if (key in context) return context[key];

  return null;
}

export function resolveValue(
  value: unknown,
  context: ResolvedContext
): TokenValue | TokenValue[] {
  if (Array.isArray(value)) {
    return value.map((v) =>
      isContextToken(v) ? resolveToken(v, context) : (v as TokenValue)
    );
  }
  if (isContextToken(value)) return resolveToken(value, context);
  return value as TokenValue;
}

export function resolveTokensInObject<T extends Record<string, unknown>>(
  obj: T,
  context: ResolvedContext
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && isContextToken(v)) {
      out[k] = resolveToken(v, context);
    } else if (typeof v === "string") {
      // resolve tokens embedded in a string template
      out[k] = v.replace(TOKEN_RE, (match) => {
        const resolved = resolveToken(match, context);
        return resolved == null ? "" : String(resolved);
      });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = resolveTokensInObject(v as Record<string, unknown>, context);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object"
          ? resolveTokensInObject(item as Record<string, unknown>, context)
          : isContextToken(item)
            ? resolveToken(item, context)
            : item
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
