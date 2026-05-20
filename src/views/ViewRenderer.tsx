import { Link } from "react-router-dom";
import type { AppConfig, ViewConfig } from "../shared/types";
import { TableView } from "./TableView.js";
import { DetailView } from "./DetailView.js";

// ─── Placeholder for unimplemented view kinds ─────────────────────────────────

function ComingSoon({ kind }: { kind: string }) {
  return (
    <div style={{
      padding: "32px 24px", border: "1px dashed #293548", borderRadius: 8,
      textAlign: "center", fontSize: 13, color: "#475569",
      background: "#0f172a",
    }}>
      <span style={{ fontSize: 18, display: "block", marginBottom: 8 }}>◻</span>
      <strong style={{ color: "#64748b" }}>{kind}</strong> view — coming soon
    </div>
  );
}

// ─── ViewRenderer ─────────────────────────────────────────────────────────────

interface ViewRendererProps {
  view: ViewConfig;
  config: AppConfig;
  anchorTable?: string;
}

export function ViewRenderer({ view, config, anchorTable }: ViewRendererProps) {
  const labelEl = view.label ? (
    <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>
      {view.label}
    </div>
  ) : null;

  let body: React.ReactNode;

  switch (view.kind) {
    case "table":
      body = <TableView view={view} config={config} />;
      break;

    case "detail":
      body = anchorTable
        ? <DetailView view={view} anchorTable={anchorTable} />
        : <ComingSoon kind={view.kind} />;
      break;

    case "list":
    case "calendar":
    case "map":
    case "createForm":
    case "updateForm":
      body = <ComingSoon kind={view.kind} />;
      break;

    case "pageLink": {
      const target = config.pages.find((p) => p.id === view.targetPageId);
      body = (
        <Link
          to={target ? `/${target.slug}` : "#"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 6,
            background: "#1e293b", border: "1px solid #293548",
            color: "#f8fafc", fontSize: 13, fontWeight: 500,
            textDecoration: "none",
          }}
        >
          ↗ {view.label ?? target?.name ?? "Go to page"}
        </Link>
      );
      break;
    }

    case "urlLink":
      body = (
        <a
          href={view.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 6,
            background: "#1e293b", border: "1px solid #293548",
            color: "#38bdf8", fontSize: 13, fontWeight: 500,
            textDecoration: "none",
          }}
        >
          ↗ {view.label ?? view.url ?? "Link"}
        </a>
      );
      break;

    case "actionButton":
      body = (
        <button
          style={{
            padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: "#0ea5e9", color: "#0f172a", border: "none", cursor: "pointer",
          }}
        >
          {view.label ?? "Action"}
        </button>
      );
      break;

    default:
      body = null;
  }

  if (body === null) return null;

  return (
    <div>
      {labelEl}
      {body}
    </div>
  );
}
