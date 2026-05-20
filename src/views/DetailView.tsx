import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import type { TokenValue, ViewConfig } from "../shared/types";
import { resolveDataSource } from "../services/dataSourceResolver.js";
import { dataverseClient } from "../services/dataverseClient.js";
import { getTableFields } from "../services/schemaCache.js";
import { useUser } from "../App.js";

const FMTANNO = "OData.Community.Display.V1.FormattedValue";

function resolveDisplayValue(field: string, row: Record<string, TokenValue>): string {
  const annotation = row[`${field}@${FMTANNO}`];
  if (annotation != null) return String(annotation);
  const raw = row[field] ?? row[`_${field}_value`];
  return raw == null ? "—" : String(raw);
}

interface DetailViewProps {
  view: ViewConfig;
  anchorTable: string;
}

export function DetailView({ view, anchorTable }: DetailViewProps) {
  const { recordId } = useParams<{ recordId: string }>();
  const user = useUser();
  const [row, setRow] = useState<Record<string, TokenValue> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ds = view.dataSource;
    if (!ds) { setLoading(false); return; }

    setLoading(true);
    setError(null);

    const fields = (view.formFields ?? []).map((ff) => ff.field);

    getTableFields(anchorTable)
      .then((schemaFields) =>
        resolveDataSource({
          dataSource: ds,
          fields,
          client: dataverseClient,
          tables: [],
          userId: user.id,
          userEmail: user.email,
          schemaFields: schemaFields.length > 0 ? schemaFields : undefined,
          anchorTable,
          anchorRecordId: recordId,
        })
      )
      .then((results) => {
        setRow(results[0] ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(String(err));
        setLoading(false);
      });
  }, [view, anchorTable, recordId, user]);

  const sorted = [...(view.formFields ?? [])].sort((a, b) => a.order - b.order);

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

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

  if (!row && sorted.length === 0) {
    return (
      <div style={{
        padding: "32px 24px", textAlign: "center", fontSize: 13,
        color: "#475569", border: "1px solid #1e293b", borderRadius: 6,
      }}>
        No record data
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", background: "#0f172a" }}>
      {sorted.map((ff, idx) => (
        <div
          key={ff.field}
          style={{
            display: "flex", alignItems: "flex-start",
            padding: "10px 16px",
            background: idx % 2 === 0 ? "#0f172a" : "#111827",
            borderBottom: idx < sorted.length - 1 ? "1px solid #1e293b" : "none",
          }}
        >
          <div style={{
            width: 180, flexShrink: 0, fontSize: 12, fontWeight: 600,
            color: "#64748b", paddingRight: 16, paddingTop: 1,
          }}>
            {ff.label ?? ff.field}
          </div>
          <div style={{ flex: 1, fontSize: 13, color: "#e2e8f0", wordBreak: "break-word" }}>
            {row ? resolveDisplayValue(ff.field, row) : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
