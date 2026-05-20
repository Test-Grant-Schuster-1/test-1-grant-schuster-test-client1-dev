import type { AppConfig, PageConfig } from "../shared/types";
import { ViewRenderer } from "./ViewRenderer.js";

interface PageViewProps {
  page: PageConfig;
  config: AppConfig;
}

export function PageView({ page, config }: PageViewProps) {
  const sorted = [...page.views].sort((a, b) => a.order - b.order);
  const anchorTable = page.kind === "singleRecord" ? page.primaryTable : undefined;

  return (
    <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>{page.name}</h1>
      {sorted.map((view) => (
        <ViewRenderer key={view.id} view={view} config={config} anchorTable={anchorTable} />
      ))}
    </div>
  );
}
