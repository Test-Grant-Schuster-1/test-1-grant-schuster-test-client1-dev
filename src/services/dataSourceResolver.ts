import type { DataverseClient } from "../shared/dataverse";
import type {
  AnchorDataSourceConfig,
  DataSourceConfig,
  DataverseField,
  DataverseRelationship,
  DataverseTable,
  DirectDataSourceConfig,
  FilterGroup,
  HopConfig,
  QueryResult,
  ResolvedContext,
  StaticFilterConfig,
  TokenValue,
  UserConnectedDataSourceConfig,
} from "../shared/types";
import { resolveValue } from "../shared/tokenResolver";
import { buildHopRelMap } from "./relationshipCache.js";

const MOCK_SCHEMA = import.meta.env.VITE_MOCK_SCHEMA === "true";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_INCOMING_HOPS = 3;
const MAX_INTERMEDIATE_IDS = 500;
const HOP_BATCH = 100;

// ─── Relationship-aware hop params ───────────────────────────────────────────

function resolveHopParams(
  hop: HopConfig,
  tables: DataverseTable[],
  relMap: Record<string, DataverseRelationship | null>
): { entitySetName: string; pkAttr: string; fkAttr: string } {
  const rel = relMap[hop.relationshipSchemaName ?? ""];
  const queryTable = rel?.referencingEntity ?? hop.toTable;
  const fkField    = rel?.referencingAttribute ?? hop.toField;
  const entitySetName =
    tables.find((t) => t.logicalName === queryTable)?.entitySetName ?? `${queryTable}s`;
  const pkAttr =
    tables.find((t) => t.logicalName === queryTable)?.primaryIdAttribute ?? `${queryTable}id`;
  const fkAttr = `_${fkField}_value`;
  return { entitySetName, pkAttr, fkAttr };
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_NAMES: Record<string, string[]> = {
  cr_action:     ["Community Hall Upgrade", "Road Safety Initiative", "Tree Planting Program", "Library Expansion", "Park Maintenance"],
  cr_actionarea: ["Infrastructure", "Environment", "Community", "Health & Wellbeing", "Governance"],
  cr_position:   ["Director Engineering", "Manager Parks", "Senior Planner", "HR Business Partner", "IT Coordinator"],
  cr_staff:      ["Sarah Chen", "Marcus Williams", "Priya Nair", "Tom O'Brien", "Aisha Patel"],
  cr_appointment:["Board Meeting", "Council Workshop", "Planning Review", "Staff 1:1", "Community Forum"],
  cr_leave:      ["Annual Leave", "Sick Leave", "Long Service Leave", "Study Leave", "Parental Leave"],
  cr_band:       ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"],
};

function mockFieldValue(field: string, table: string, idx: number): TokenValue {
  const base = field.split(".").pop() ?? field;
  if (base.endsWith("id") || base === "id") return `${table}-${idx + 1}`;
  if (base === "cr_name" || base === "name") {
    const names = MOCK_NAMES[table] ?? [];
    return names[idx % (names.length || 1)] ?? `${table} Record ${idx + 1}`;
  }
  if (base.includes("status") || base.includes("state"))
    return ["Active", "Inactive", "Pending", "Closed", "Draft"][idx % 5];
  if (base.includes("date") || base.endsWith("on") || base.includes("time"))
    return new Date(2025, idx % 12, (idx + 1) * 3).toISOString().slice(0, 10);
  if (base.includes("amount") || base.includes("cost") || base.includes("budget"))
    return (idx + 1) * 5000;
  if (base.includes("email")) return `user${idx + 1}@council.gov.au`;
  if (base.includes("phone")) return `04${String(idx * 9).padStart(8, "0")}`;
  if (base.includes("description") || base.includes("notes")) return `Notes for record ${idx + 1}`;
  return `${base.replace(/^cr_/, "").replace(/_/g, " ")} ${idx + 1}`;
}

function generateMockResults(table: string, fields: string[]): QueryResult {
  const cols = fields.length > 0 ? fields : ["cr_name", "cr_status", "createdon"];
  return Array.from({ length: 8 }, (_, i) => {
    const row: Record<string, TokenValue> = {};
    // Always include the primary ID so row-click navigation works
    row[`${table}id`] = `${table}-${i + 1}`;
    for (const f of cols) row[f] = mockFieldValue(f, table, i);
    return row;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DataSourceResolveOptions {
  dataSource: DataSourceConfig;
  fields?: string[];
  sortField?: string;
  sortDir?: "asc" | "desc";
  client: DataverseClient | null;
  tables: DataverseTable[];
  userId?: string;
  userEmail?: string;
  schemaFields?: DataverseField[];
  /** For anchor mode — the page's primaryTable logical name */
  anchorTable?: string;
  /** For anchor mode — the :recordId from the URL */
  anchorRecordId?: string;
}

export async function resolveDataSource(
  opts: DataSourceResolveOptions
): Promise<QueryResult> {
  if (MOCK_SCHEMA || !opts.client) return resolveMock(opts);
  if (opts.dataSource.mode === "direct") return resolveDirectMode(opts);
  if (opts.dataSource.mode === "anchor") return resolveAnchorMode(opts);
  return resolveUserConnectedMode(opts);
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

function resolveMock(opts: DataSourceResolveOptions): QueryResult {
  const ds = opts.dataSource;
  let table: string;
  if (ds.mode === "direct") {
    table = ds.table;
  } else if (ds.hops.length > 0) {
    table = ds.hops[ds.hops.length - 1].toTable;
  } else if (ds.mode === "anchor") {
    table = opts.anchorTable ?? "systemuser";
  } else {
    table = "systemuser";
  }
  return generateMockResults(table, opts.fields ?? []);
}

// ─── OData helpers ────────────────────────────────────────────────────────────

function makeContext(opts: DataSourceResolveOptions): ResolvedContext {
  return { currentUser: opts.userId ?? "", currentUserEmail: opts.userEmail ?? "" };
}

function lookupAttr(logicalName: string): string {
  return `_${logicalName}_value`;
}

function serializeODataValue(str: string, field: DataverseField | undefined): string {
  if (!field) {
    // GUIDs are Edm.Guid literals — no quotes; everything else is a string.
    if (UUID_RE.test(str)) return str;
    return `'${str.replace(/'/g, "''")}'`;
  }
  switch (field.type) {
    case "Integer":
    case "OptionSet":
    case "MultiSelectOptionSet": {
      const n = parseInt(str, 10);
      return isNaN(n) ? `'${str.replace(/'/g, "''")}'` : String(n);
    }
    case "Decimal":
    case "Money": {
      const n = parseFloat(str);
      return isNaN(n) ? `'${str.replace(/'/g, "''")}'` : String(n);
    }
    case "Boolean":
      return str === "1" || str.toLowerCase() === "true" ? "true" : "false";
    case "Lookup":
    case "UniqueIdentifier":
      return str;
    default:
      return `'${str.replace(/'/g, "''")}'`;
  }
}

function transformSelectFields(fieldNames: string[], schemaFields?: DataverseField[]): string[] {
  if (!schemaFields) return fieldNames;
  return fieldNames.map((name) => {
    const def = schemaFields.find((f) => f.logicalName === name);
    return def?.type === "Lookup" ? lookupAttr(name) : name;
  });
}

function condToOData(
  cond: StaticFilterConfig,
  context: ResolvedContext,
  fields?: DataverseField[]
): string {
  if (!cond.field) return "";
  const fieldDef = fields?.find((f) => f.logicalName === cond.field);
  const raw = resolveValue(cond.value, context) as TokenValue | TokenValue[];

  // When schema is unavailable, detect lookup fields by UUID-shaped values:
  // Dataverse navigation properties can't be compared with eq directly — use _field_value form.
  const firstRaw = Array.isArray(raw) ? raw[0] : raw;
  const isLookupHeuristic = !fieldDef && UUID_RE.test(firstRaw != null ? String(firstRaw) : "");
  const oDataField =
    fieldDef?.type === "Lookup" ? lookupAttr(cond.field) :
    isLookupHeuristic        ? lookupAttr(cond.field) :
    cond.field;

  const qv = (v: TokenValue): string => {
    if (v === null || v === undefined) return "null";
    return serializeODataValue(String(v), fieldDef);
  };
  const qStr = (v: TokenValue): string => {
    const s = String(v ?? "");
    return `'${s.replace(/'/g, "''")}'`;
  };

  switch (cond.operator) {
    case "eq":         return `${oDataField} eq ${qv(raw as TokenValue)}`;
    case "ne":         return `${oDataField} ne ${qv(raw as TokenValue)}`;
    case "gt":         return `${oDataField} gt ${qv(raw as TokenValue)}`;
    case "gte":        return `${oDataField} ge ${qv(raw as TokenValue)}`;
    case "lt":         return `${oDataField} lt ${qv(raw as TokenValue)}`;
    case "lte":        return `${oDataField} le ${qv(raw as TokenValue)}`;
    case "contains":   return `contains(${oDataField},${qStr(raw as TokenValue)})`;
    case "startsWith": return `startswith(${oDataField},${qStr(raw as TokenValue)})`;
    case "endsWith":   return `endswith(${oDataField},${qStr(raw as TokenValue)})`;
    case "null":       return `${oDataField} eq null`;
    case "notNull":    return `${oDataField} ne null`;
    case "in":
      return Array.isArray(raw)
        ? raw.map((v) => `${oDataField} eq ${qv(v)}`).join(" or ")
        : `${oDataField} eq ${qv(raw as TokenValue)}`;
    case "notIn":
      return Array.isArray(raw)
        ? raw.map((v) => `${oDataField} ne ${qv(v)}`).join(" and ")
        : `${oDataField} ne ${qv(raw as TokenValue)}`;
    default:
      return "";
  }
}

function buildFilter(
  filterGroups: FilterGroup[],
  context: ResolvedContext,
  fields?: DataverseField[]
): string {
  const groups = filterGroups
    .map((g) => {
      const conds = g.conditions.map((c) => condToOData(c, context, fields)).filter(Boolean);
      if (conds.length === 0) return "";
      return conds.length === 1 ? conds[0] : `(${conds.join(" and ")})`;
    })
    .filter(Boolean);
  if (groups.length === 0) return "";
  return groups.length === 1 ? groups[0] : groups.map((g) => `(${g})`).join(" or ");
}

/**
 * Multi-step hop resolution for chains that contain outgoing hops.
 * When fromTable has the FK (outgoing), we resolve step-by-step:
 *   - incoming hop: fetch toTable filtered by FK, collect primary keys
 *   - outgoing hop: fetch fromTable by primary key, collect FK values pointing to toTable
 * Optimization: an incoming hop followed immediately by an outgoing hop is combined into
 * one query by pre-selecting the outgoing FK field.
 */
async function resolveMultiHop(
  hops: HopConfig[],
  startId: string,
  client: DataverseClient,
  tables: DataverseTable[]
): Promise<string[]> {
  let currentIds: string[] = [startId];
  let i = 0;

  while (i < hops.length) {
    if (currentIds.length === 0) return [];
    const hop = hops[i];

    if (hop.direction === "outgoing") {
      // fromTable has FK (fromField) → toTable; currentIds are fromTable IDs
      const entitySetName =
        tables.find((t) => t.logicalName === hop.fromTable)?.entitySetName ?? `${hop.fromTable}s`;
      const pkAttr =
        tables.find((t) => t.logicalName === hop.fromTable)?.primaryIdAttribute ?? `${hop.fromTable}id`;
      const fkAttr = `_${hop.fromField}_value`;
      const idFilter = currentIds.map((id) => `${pkAttr} eq ${id}`).join(" or ");
      const qs = `?$select=${fkAttr}&$filter=${encodeURIComponent(idFilter)}&$top=500`;
      const results = await client.fetchPage(entitySetName, qs);
      currentIds = results.map((r) => r[fkAttr] as string).filter(Boolean);
      i++;
    } else {
      // incoming: toTable has FK (toField) → fromTable; currentIds are fromTable IDs
      const entitySetName =
        tables.find((t) => t.logicalName === hop.toTable)?.entitySetName ?? `${hop.toTable}s`;
      const pkAttr =
        tables.find((t) => t.logicalName === hop.toTable)?.primaryIdAttribute ?? `${hop.toTable}id`;
      const fkAttr = `_${hop.toField}_value`;

      // If the next hop is outgoing, pre-select its FK to avoid a separate re-query of this table
      const nextHop = hops[i + 1];
      const nextOutgoingFk = nextHop?.direction === "outgoing" ? `_${nextHop.fromField}_value` : null;

      const selectFields = nextOutgoingFk ? `${pkAttr},${nextOutgoingFk}` : pkAttr;
      const idFilter = currentIds.map((id) => `${fkAttr} eq ${id}`).join(" or ");
      const qs = `?$select=${selectFields}&$filter=${encodeURIComponent(idFilter)}&$top=500`;
      const results = await client.fetchPage(entitySetName, qs);

      if (nextOutgoingFk) {
        currentIds = results.map((r) => r[nextOutgoingFk] as string).filter(Boolean);
        i += 2;
      } else {
        currentIds = results.map((r) => r[pkAttr] as string).filter(Boolean);
        i++;
      }
    }
  }

  return currentIds;
}

/**
 * Validates an all-incoming hop chain. Throws user-facing errors for unsupported
 * configurations: chains longer than MAX_INCOMING_HOPS, or mixed direction chains.
 */
function validateIncomingHopChain(hops: HopConfig[], label: string): void {
  if (hops.length > MAX_INCOMING_HOPS) {
    throw new Error(
      `${label} has ${hops.length} hops but the maximum supported is ${MAX_INCOMING_HOPS}. ` +
      `Reduce the hop count in the page canvas.`
    );
  }
  for (let i = 0; i < hops.length; i++) {
    if (hops[i].direction === "outgoing") {
      throw new Error(
        `Multi-hop chains mixing incoming and outgoing hops are not yet supported ` +
        `(hop ${i + 1} on "${hops[i].toTable}" is outgoing). Use only incoming hops for multi-hop chains.`
      );
    }
  }
}

/**
 * Sequential resolver for all-incoming hop chains of length ≥ 2.
 * Walks hops[0..length-2], issuing one batched Dataverse query per hop.
 * Returns the IDs of the second-to-last entity so the caller can issue
 * the final hop query with full view options (select, filter, sort).
 *
 * Empty intermediate result → returns [] immediately (short-circuit).
 * Intermediate result > MAX_INTERMEDIATE_IDS → throws a user-facing error naming the hop.
 * IDs are batched in groups of HOP_BATCH to stay under Dataverse URL limits.
 */
async function resolveIncomingIntermediateIds(
  hops: HopConfig[],
  startId: string,
  client: DataverseClient,
  tables: DataverseTable[],
  relMap: Record<string, DataverseRelationship | null> = {}
): Promise<string[]> {
  let currentIds: string[] = [startId];

  for (let i = 0; i < hops.length - 1; i++) {
    if (currentIds.length === 0) return [];
    const hop = hops[i];
    const { entitySetName, pkAttr, fkAttr } = resolveHopParams(hop, tables, relMap);

    const batchResults: string[] = [];
    for (let b = 0; b < currentIds.length; b += HOP_BATCH) {
      const batch = currentIds.slice(b, b + HOP_BATCH);
      const idFilter = batch.map((id) => `${fkAttr} eq ${id}`).join(" or ");
      const qs = `?$select=${pkAttr}&$filter=${encodeURIComponent(idFilter)}&$top=500`;
      const rows = await client.fetchPage(entitySetName, qs);
      for (const row of rows) {
        const pk = row[pkAttr] as string;
        if (pk) batchResults.push(pk);
      }
    }

    if (batchResults.length > MAX_INTERMEDIATE_IDS) {
      const rel = relMap[hop.relationshipSchemaName ?? ""];
      const queryTable = rel?.referencingEntity ?? hop.toTable;
      throw new Error(
        `Multi-hop query returned ${batchResults.length} intermediate records at hop ${i + 1} ` +
        `(table: ${queryTable}), exceeding the ${MAX_INTERMEDIATE_IDS}-record safety limit. ` +
        `Add a filter condition to narrow the intermediate result set.`
      );
    }

    currentIds = batchResults;
  }

  return currentIds;
}

function buildQueryParams(parts: {
  select?: string[];
  filter?: string;
  orderBy?: string;
  top?: number;
}): string {
  const qs: string[] = [];
  if (parts.select && parts.select.length > 0) qs.push(`$select=${parts.select.join(",")}`);
  if (parts.filter) qs.push(`$filter=${encodeURIComponent(parts.filter)}`);
  if (parts.orderBy) qs.push(`$orderby=${parts.orderBy}`);
  if (parts.top != null) qs.push(`$top=${parts.top}`);
  return qs.length > 0 ? `?${qs.join("&")}` : "";
}

// ─── Direct mode ──────────────────────────────────────────────────────────────

async function resolveDirectMode(opts: DataSourceResolveOptions): Promise<QueryResult> {
  const ds = opts.dataSource as DirectDataSourceConfig;
  const entitySetName =
    opts.tables.find((t) => t.logicalName === ds.table)?.entitySetName ?? `${ds.table}s`;
  const context = makeContext(opts);
  const filter  = buildFilter(ds.filterGroups, context, opts.schemaFields) || undefined;
  const orderBy = opts.sortField ? `${opts.sortField} ${opts.sortDir ?? "asc"}` : undefined;
  const select  = transformSelectFields(opts.fields ?? [], opts.schemaFields);
  const qs      = buildQueryParams({ select, filter, orderBy, top: 50 });
  return opts.client!.fetchPage(entitySetName, qs);
}

// ─── Anchor mode ─────────────────────────────────────────────────────────────

async function resolveAnchorMode(opts: DataSourceResolveOptions): Promise<QueryResult> {
  const ds = opts.dataSource as AnchorDataSourceConfig;
  if (!opts.anchorRecordId) return [];

  const anchorEntitySetName =
    opts.tables.find((t) => t.logicalName === opts.anchorTable)?.entitySetName ??
    `${opts.anchorTable ?? "unknown"}s`;

  const select = transformSelectFields(opts.fields ?? [], opts.schemaFields);

  if (ds.hops.length === 0) {
    // Direct anchor fetch: GET /{entitySet}({recordId})?$select=...
    const qs = buildQueryParams({ select });
    const row = await opts.client!.fetchRecord(anchorEntitySetName, opts.anchorRecordId, qs);
    return row ? [row] : [];
  }

  // Validate and classify the hop chain direction
  const allOutgoing = ds.hops.every((h) => h.direction === "outgoing");
  const hasOutgoingAfterIncoming = !allOutgoing && ds.hops.some((h, i) => i > 0 && h.direction === "outgoing");
  const hasIncomingBeforeOutgoing = ds.hops[0].direction === "incoming" && ds.hops.some((h) => h.direction === "outgoing");

  if (hasOutgoingAfterIncoming || hasIncomingBeforeOutgoing) {
    throw new Error(
      "Anchor data source chains mixing incoming then outgoing hops are not yet supported. " +
      "Use only incoming hops for multi-hop chains."
    );
  }

  if (allOutgoing) {
    // Navigate anchor's lookup(s): GET /{entitySet}({recordId})/{navPath}?$select=...
    const navPath = ds.hops.map((h) => h.fromField).join("/");
    const qs = buildQueryParams({ select });
    const row = await opts.client!.fetchRecord(anchorEntitySetName, opts.anchorRecordId, qs, navPath);
    return row ? [row] : [];
  }

  // All-incoming hops
  validateIncomingHopChain(ds.hops, "Anchor data source");

  const relMap = await buildHopRelMap(ds.hops);
  const finalHop = ds.hops[ds.hops.length - 1];
  const { entitySetName: finalEntitySetName, fkAttr: finalFkAttr } =
    resolveHopParams(finalHop, opts.tables, relMap);
  const context = makeContext(opts);
  const addlFilter = buildFilter(ds.filterGroups, context, opts.schemaFields);
  const orderBy = opts.sortField ? `${opts.sortField} ${opts.sortDir ?? "asc"}` : undefined;

  if (ds.hops.length === 1) {
    const filter = [`${finalFkAttr} eq ${opts.anchorRecordId}`, addlFilter]
      .filter(Boolean).join(" and ") || undefined;
    const qs = buildQueryParams({ select, filter, top: 50 });
    return opts.client!.fetchPage(finalEntitySetName, qs);
  }

  // 2-3 incoming hops — resolve sequentially with batched intermediate queries
  const intermediateIds = await resolveIncomingIntermediateIds(
    ds.hops, opts.anchorRecordId, opts.client!, opts.tables, relMap
  );
  if (intermediateIds.length === 0) return [];

  const allRows: QueryResult = [];
  for (let b = 0; b < intermediateIds.length; b += HOP_BATCH) {
    const batch = intermediateIds.slice(b, b + HOP_BATCH);
    const idFilter = batch.map((id) => `${finalFkAttr} eq ${id}`).join(" or ");
    const filter = [idFilter, addlFilter].filter(Boolean).join(" and ") || undefined;
    const qs = buildQueryParams({ select, filter, orderBy, top: 50 });
    allRows.push(...(await opts.client!.fetchPage(finalEntitySetName, qs)));
  }
  return allRows;
}

// ─── User-connected mode ──────────────────────────────────────────────────────

async function resolveUserConnectedMode(opts: DataSourceResolveOptions): Promise<QueryResult> {
  const ds = opts.dataSource as UserConnectedDataSourceConfig;
  if (ds.hops.length === 0) return [];

  const finalHop = ds.hops[ds.hops.length - 1];
  const entitySetName =
    opts.tables.find((t) => t.logicalName === finalHop.toTable)?.entitySetName ?? `${finalHop.toTable}s`;
  const context  = makeContext(opts);
  const addlFilter = buildFilter(ds.filterGroups, context, opts.schemaFields);
  const orderBy  = opts.sortField ? `${opts.sortField} ${opts.sortDir ?? "asc"}` : undefined;
  const select   = transformSelectFields(opts.fields ?? [], opts.schemaFields);

  const hasOutgoing = ds.hops.some((h) => h.direction === "outgoing");

  if (!hasOutgoing) {
    validateIncomingHopChain(ds.hops, "User-connected data source");
    const relMap = await buildHopRelMap(ds.hops);
    const { entitySetName: finalEntitySetName, fkAttr: finalFkAttr } =
      resolveHopParams(finalHop, opts.tables, relMap);

    if (ds.hops.length === 1) {
      const filter = [`${finalFkAttr} eq ${opts.userId ?? ""}`, addlFilter]
        .filter(Boolean).join(" and ") || undefined;
      const qs = buildQueryParams({ select, filter, orderBy, top: 50 });
      return opts.client!.fetchPage(finalEntitySetName, qs);
    }
    // 2+ incoming hops — resolve sequentially with batched intermediate queries
    const intermediateIds = await resolveIncomingIntermediateIds(
      ds.hops, opts.userId ?? "", opts.client!, opts.tables, relMap
    );
    if (intermediateIds.length === 0) return [];
    const allRows: QueryResult = [];
    for (let b = 0; b < intermediateIds.length; b += HOP_BATCH) {
      const batch = intermediateIds.slice(b, b + HOP_BATCH);
      const idFilter = batch.map((id) => `${finalFkAttr} eq ${id}`).join(" or ");
      const filter = [idFilter, addlFilter].filter(Boolean).join(" and ") || undefined;
      const qs = buildQueryParams({ select, filter, orderBy, top: 50 });
      allRows.push(...(await opts.client!.fetchPage(finalEntitySetName, qs)));
    }
    return allRows;
  }

  // Mixed / outgoing chains — walk hops to resolve final entity IDs, then fetch with view options
  const finalIds = await resolveMultiHop(ds.hops, opts.userId ?? "", opts.client!, opts.tables);
  if (finalIds.length === 0) return [];

  const pkAttr =
    opts.tables.find((t) => t.logicalName === finalHop.toTable)?.primaryIdAttribute ?? `${finalHop.toTable}id`;
  const idFilter = finalIds.map((id) => `${pkAttr} eq ${id}`).join(" or ");
  const filter = [idFilter, addlFilter].filter(Boolean).join(" and ") || undefined;
  const qs = buildQueryParams({ select, filter, orderBy, top: 50 });
  return opts.client!.fetchPage(entitySetName, qs);
}
