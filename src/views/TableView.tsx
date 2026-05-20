import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AppConfig, DataverseField, QueryResult, TokenValue, ViewConfig } from "../shared/types";
import { resolveDataSource } from "../services/dataSourceResolver.js";
import { dataverseClient } from "../services/dataverseClient.js";
import { getTableFields } from "../services/schemaCache.js";
import { useUser } from "../App.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fieldLabel(logicalName: string): string {
  return logicalName
    .replace(/^cr_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function colLabel(entry: string, config: AppConfig): string {
  if (entry.startsWith("link:")) {
    const pageId = entry.slice(5);
    const page = config.pages.find((p) => p.id === pageId);
    return page?.name ?? "Link";
  }
  return fieldLabel(entry);
}

function extractRecordId(row: Record<string, TokenValue>, table: string): string | null {
  const stdKey = `${table}id`;
  if (stdKey in row) return String(row[stdKey]);
  const idKey = Object.keys(row).find(
    (k) => k.toLowerCase().endsWith("id") && !k.includes("@")
  );
  return idKey ? String(row[idKey]) : null;
}

// ─── Grid sub-components ──────────────────────────────────────────────────────

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr>
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i} style={{ padding: "8px 12px" }}>
          <div style={{
            height: 12, borderRadius: 4,
            background: "linear-gradient(90deg,#1e293b 25%,#293548 50%,#1e293b 75%)",
            backgroundSize: "200% 100%",
            animation: "fe-shimmer 1.4s infinite",
            width: `${50 + (i * 37) % 40}%`,
          }} />
        </td>
      ))}
    </tr>
  );
}

function resolveDisplayValue(
  col: string,
  row: Record<string, TokenValue>
): string {
  const FMTANNO = "OData.Community.Display.V1.FormattedValue";
  const annotation = row[`${col}@${FMTANNO}`];
  if (annotation != null) return String(annotation);
  const raw = row[col] ?? row[`_${col}_value`];
  return raw == null ? "—" : String(raw);
}

// ─── TableGrid ────────────────────────────────────────────────────────────────

interface TableGridProps {
  columns: string[];
  columnLabels: string[];
  rows: QueryResult;
  loading: boolean;
  error: string | null;
  onLinkClick?: (row: Record<string, TokenValue>, pageId: string) => void;
}

function TableGrid({ columns, columnLabels, rows, loading, error, onLinkClick }: TableGridProps) {
  const colCount = Math.max(columns.length, 3);

  if (error) {
    return (
      <div style={{
        padding: "12px 16px", background: "#1e0a0a", border: "1px solid #7f1d1d",
        borderRadius: 6, fontSize: 13, color: "#fca5a5",
      }}>
        <strong>Error: </strong>{error}
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <div style={{
        padding: "32px 24px", textAlign: "center", fontSize: 13,
        color: "#475569", border: "1px solid #1e293b", borderRadius: 6,
      }}>
        No records found
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <style>{`
        @keyframes fe-shimmer {
          0%   { background-position: -200% 0 }
          100% { background-position:  200% 0 }
        }
      `}</style>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#1e293b" }}>
            {columnLabels.map((label, i) => {
              const isLink = columns[i].startsWith("link:");
              return (
                <th key={i} style={{
                  padding: "8px 12px", textAlign: "left", fontWeight: 600,
                  color: isLink ? "#818cf8" : "#94a3b8",
                  fontSize: 12, borderBottom: "1px solid #293548", whiteSpace: "nowrap",
                }}>
                  {isLink ? `↗ ${label}` : label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} colCount={colCount} />)
            : rows.map((row, ri) => (
                <tr
                  key={ri}
                  style={{ borderBottom: "1px solid #1e293b", background: "transparent" }}
                >
                  {columns.map((col, ci) => {
                    if (col.startsWith("link:")) {
                      const pageId = col.slice(5);
                      return (
                        <td key={ci} style={{ padding: "8px 12px" }}>
                          <button
                            onClick={() => onLinkClick?.(row, pageId)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 3,
                              fontSize: 11, fontWeight: 600, color: "#818cf8",
                              background: "#1e1b4b", border: "1px solid #3730a3",
                              borderRadius: 4, padding: "2px 7px",
                              cursor: "pointer",
                            }}
                          >
                            ↗ {columnLabels[ci]}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={ci} style={{
                        padding: "8px 12px", color: "#cbd5e1",
                        maxWidth: 240, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {resolveDisplayValue(col, row)}
                      </td>
                    );
                  })}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── TableView ────────────────────────────────────────────────────────────────

interface TableViewProps {
  view: ViewConfig;
  config: AppConfig;
}

export function TableView({ view, config }: TableViewProps) {
  const navigate = useNavigate();
  const user = useUser();
  const [rows, setRows] = useState<QueryResult>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ds = view.dataSource;
    if (!ds) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    const tableName =
      ds.mode === "direct"
        ? ds.table
        : ds.hops.length > 0
          ? ds.hops[ds.hops.length - 1].toTable
          : undefined;

    (tableName ? getTableFields(tableName) : Promise.resolve<DataverseField[]>([]))
      .then((schemaFields) =>
        resolveDataSource({
          dataSource: ds,
          fields: view.fields,
          sortField: view.sortField,
          sortDir: view.sortDir,
          client: dataverseClient,
          tables: [],
          userId: user.id,
          userEmail: user.email,
          schemaFields: schemaFields.length > 0 ? schemaFields : undefined,
        })
      )
      .then((data) => { setRows(data); setLoading(false); })
      .catch((err: unknown) => { setError(String(err)); setLoading(false); });
  }, [view, user]);

  const rawCols: string[] = view.columnOrder ?? view.fields ?? [];
  const colLabels = rawCols.map((c) => colLabel(c, config));

  const table =
    view.dataSource?.mode === "direct"
      ? view.dataSource.table
      : view.dataSource?.mode === "userConnected" && view.dataSource.hops.length > 0
        ? view.dataSource.hops[view.dataSource.hops.length - 1].toTable
        : undefined;

  function handleLinkClick(row: Record<string, TokenValue>, pageId: string) {
    const targetPage = config.pages.find((p) => p.id === pageId);
    if (!targetPage || !table) return;
    const recordId = extractRecordId(row, table);
    if (!recordId) return;
    navigate(`/${targetPage.slug}/${recordId}`);
  }

  const hasLinks = rawCols.some((c) => c.startsWith("link:"));

  return (
    <div style={{
      border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden",
      background: "#0f172a",
    }}>
      <TableGrid
        columns={rawCols}
        columnLabels={colLabels}
        rows={rows}
        loading={loading}
        error={error}
        onLinkClick={hasLinks ? handleLinkClick : undefined}
      />
    </div>
  );
}
