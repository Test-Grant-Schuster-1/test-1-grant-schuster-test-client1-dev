import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { LOGIN_SCOPES } from "../auth/msalConfig.js";
import { hardReset } from "../auth/hardReset.js";

function LoginScreen({ onLogin, loading, onReset }: {
  onLogin: () => void;
  loading: boolean;
  onReset: () => void;
}) {
  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#0f172a", color: "#f8fafc",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ marginBottom: 8, fontSize: 28, fontWeight: 700, color: "#38bdf8" }}>PE</div>
      <div style={{ marginBottom: 4, fontSize: 20, fontWeight: 600 }}>Performance Enabler</div>
      <div style={{ marginBottom: 40, fontSize: 13, color: "#64748b" }}>
        Sign in with your organisation account to continue
      </div>
      <button
        onClick={onLogin}
        disabled={loading}
        style={{
          padding: "11px 28px", fontSize: 14, fontWeight: 600, borderRadius: 8,
          background: loading ? "#1e293b" : "#38bdf8", color: loading ? "#64748b" : "#0f172a",
          border: "none", cursor: loading ? "not-allowed" : "pointer",
          marginBottom: 32,
        }}
      >
        {loading ? "Signing in…" : "Sign in with Microsoft"}
      </button>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
        If sign-in keeps failing, reset to clear cached credentials.
      </div>
      <button
        onClick={onReset}
        style={{
          padding: "7px 18px", fontSize: 12, fontWeight: 600, borderRadius: 6,
          background: "transparent", color: "#64748b",
          border: "1px solid #1e293b", cursor: "pointer",
        }}
      >
        Reset sign-in
      </button>
    </div>
  );
}

function FullscreenSpinner({ message }: { message: string }) {
  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#0f172a", color: "#64748b",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", gap: 12,
    }}>
      <div className="fe-spinner" />
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  if (inProgress !== InteractionStatus.None) {
    return <FullscreenSpinner message="Signing in…" />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        loading={inProgress !== InteractionStatus.None}
        onLogin={() => instance.loginRedirect({ scopes: LOGIN_SCOPES }).catch(console.error)}
        onReset={() => hardReset(instance)}
      />
    );
  }

  return <>{children}</>;
}
