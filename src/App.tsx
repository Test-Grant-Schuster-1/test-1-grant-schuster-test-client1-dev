import { createContext, useContext, useEffect, useState } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  useParams,
} from "react-router-dom";
import type { AppConfig, PageConfig, SingleRecordPageConfig, StandardPageConfig } from "./shared/types";
import { AuthGate } from "./components/AuthGate.js";
import { loadAppConfig, type ConfigLoadError } from "./services/configLoader.js";
import { getMockUserInfo } from "./auth/tokenProvider.js";
import { dataverseClient } from "./services/dataverseClient.js";
import { PageView } from "./views/PageView.js";

// ─── User context ─────────────────────────────────────────────────────────────

export interface UserInfo { id: string; email: string; }
const UserContext = createContext<UserInfo>({ id: "", email: "" });
export function useUser(): UserInfo { return useContext(UserContext); }

const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === "false" ? false : import.meta.env.DEV;
const APP_SLUG  = (import.meta.env.VITE_APP_SLUG as string | undefined) ?? "default";

// ─── User chip (real auth only — useMsal requires MsalProvider) ──────────────

function UserChip() {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const user = useUser();
  const [open, setOpen] = useState(false);

  if (!isAuthenticated) return null;

  const initial = (user.email.split("@")[0] ?? "?").charAt(0).toUpperCase();

  function signOut() {
    void instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  }

  return (
    <div style={{ position: "relative", marginLeft: "auto" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={user.email}
        style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "#334155", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: "#94a3b8",
          outline: open ? "2px solid #38bdf8" : "none", outlineOffset: 2,
          flexShrink: 0,
        }}
      >
        {initial}
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 499 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 200, background: "#1e293b", border: "1px solid #334155",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 500, overflow: "hidden",
          }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid #293548" }}>
              <div style={{
                fontSize: 11, color: "#64748b",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {user.email || "Signed in"}
              </div>
            </div>
            <button
              onClick={signOut}
              style={{
                width: "100%", padding: "10px 14px", background: "none",
                border: "none", cursor: "pointer", textAlign: "left",
                fontSize: 13, color: "#94a3b8", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 14 }}>↩</span> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Navigation bar ───────────────────────────────────────────────────────────

function NavBar({ config, showUserChip }: { config: AppConfig; showUserChip: boolean }) {
  const navPages = (config.pages as PageConfig[])
    .filter((p): p is StandardPageConfig => p.kind === "standard" && p.inNav)
    .sort((a, b) => a.navOrder - b.navOrder);

  return (
    <header style={{
      height: 48, background: "#1e293b", borderBottom: "1px solid #293548",
      display: "flex", alignItems: "center", padding: "0 16px 0 24px", gap: 16, flexShrink: 0,
    }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: "#38bdf8", letterSpacing: "-0.5px" }}>PE</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>{config.name}</span>
      <nav style={{ display: "flex", gap: 2, marginLeft: 4 }}>
        {navPages.map((p) => (
          <NavLink
            key={p.id}
            to={`/${p.slug}`}
            style={({ isActive }) => ({
              padding: "5px 11px", fontSize: 13, borderRadius: 5, fontWeight: 500,
              background: isActive ? "#293548" : "transparent",
              color: isActive ? "#f8fafc" : "#94a3b8",
              textDecoration: "none",
              transition: "background 0.1s, color 0.1s",
            })}
          >
            {p.name}
          </NavLink>
        ))}
      </nav>
      {showUserChip && <UserChip />}
    </header>
  );
}

// ─── Single-record page wrapper (reads :recordId from URL) ────────────────────

function SingleRecordRoute({ page, config }: { page: SingleRecordPageConfig; config: AppConfig }) {
  const { recordId } = useParams<{ recordId: string }>();
  // Inject recordId into views via page copy so ViewRenderer can pass it to data layer
  const enriched: SingleRecordPageConfig = {
    ...page,
    name: recordId ? `${page.name} — ${recordId}` : page.name,
  };
  return <PageView page={enriched} config={config} />;
}

// ─── App router ───────────────────────────────────────────────────────────────

function AppRouter({ config, showUserChip }: { config: AppConfig; showUserChip: boolean }) {
  const navPages = (config.pages as PageConfig[])
    .filter((p): p is StandardPageConfig => p.kind === "standard" && p.inNav)
    .sort((a, b) => a.navOrder - b.navOrder);
  const defaultSlug = navPages[0]?.slug ?? "";

  return (
    <BrowserRouter>
      <div style={{
        height: "100vh", background: "#0f172a", color: "#f8fafc",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "flex", flexDirection: "column",
      }}>
        <NavBar config={config} showUserChip={showUserChip} />
        <main style={{ flex: 1, overflowY: "auto" }}>
          <Routes>
            {config.pages.map((page) =>
              page.kind === "singleRecord" ? (
                <Route
                  key={page.id}
                  path={`/${page.slug}/:recordId`}
                  element={<SingleRecordRoute page={page} config={config} />}
                />
              ) : (
                <Route
                  key={page.id}
                  path={`/${page.slug}`}
                  element={<PageView page={page} config={config} />}
                />
              )
            )}
            {defaultSlug && (
              <Route path="*" element={<Navigate to={`/${defaultSlug}`} replace />} />
            )}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

// ─── Loading / error states ───────────────────────────────────────────────────

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

function ConfigErrorScreen({ error }: { error: ConfigLoadError }) {
  const message =
    error.kind === "not-found"
      ? `Config file "${error.slug}.app.json" not found. Export it from the builder and place it in packages/frontend/public/.`
      : error.kind === "invalid-json"
      ? `Config file contains invalid JSON: ${error.detail}`
      : `Network error loading config: ${error.detail}`;

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#0f172a", color: "#f8fafc",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      gap: 8, padding: "0 32px", textAlign: "center",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>Failed to load app config</div>
      <div style={{ fontSize: 12, color: "#64748b", maxWidth: 480, lineHeight: 1.6 }}>{message}</div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

function AppShell({ initialUser, showUserChip }: { initialUser: UserInfo; showUserChip: boolean }) {
  const [config, setConfig]       = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<ConfigLoadError | null>(null);
  const [user, setUser]           = useState<UserInfo>(initialUser);

  useEffect(() => {
    loadAppConfig(APP_SLUG)
      .then(setConfig)
      .catch((err: unknown) => setConfigError(err as ConfigLoadError));
  }, []);

  // Resolve the authoritative Dataverse systemuserid via WhoAmI().
  // In online Dataverse the systemuserid matches the AAD oid, but WhoAmI is the
  // only guaranteed-correct source for $filter=_createdby_value eq <id>.
  useEffect(() => {
    if (!dataverseClient) return;
    dataverseClient.whoAmI()
      .then((r) => setUser((u) => ({ ...u, id: r.UserId })))
      .catch(() => { /* keep initialUser.id as fallback */ });
  }, []);

  if (configError) return <ConfigErrorScreen error={configError} />;
  if (!config) return <FullscreenSpinner message="Loading app config…" />;
  return (
    <UserContext.Provider value={user}>
      <AppRouter config={config} showUserChip={showUserChip} />
    </UserContext.Provider>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function MockAuthApp() {
  return <AppShell initialUser={getMockUserInfo()} showUserChip={false} />;
}

// useMsal is only called when MsalProvider is present (real auth mode, set up in main.tsx)
function RealAuthApp() {
  const { accounts } = useMsal();
  const acct = accounts[0];
  const initialUser: UserInfo = acct
    ? { id: acct.localAccountId, email: acct.username }
    : { id: "", email: "" };
  return (
    <AuthGate>
      <AppShell initialUser={initialUser} showUserChip={true} />
    </AuthGate>
  );
}

export function App() {
  if (MOCK_AUTH) return <MockAuthApp />;
  return <RealAuthApp />;
}
