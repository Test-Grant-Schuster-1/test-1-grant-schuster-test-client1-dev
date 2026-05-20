import type {
  CreateFieldDefinition,
  CreateRelationshipDefinition,
  CreateTableDefinition,
  DataverseField,
  DataverseFieldType,
  DataverseRelationship,
  DataverseTable,
  FilterOperator,
  JoinClause,
  OrderByClause,
  QueryDefinition,
  QueryResult,
  RequiredLevel,
  ResolvedContext,
  TokenValue,
  TransactionResult,
  UpdateColumnDefinition,
  WhereClause,
  WriteOperation,
} from "./types.js";
import { resolveValue } from "./tokenResolver.js";

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface DataverseClientOptions {
  /** Base URL of the Dataverse environment, e.g. https://org.crm.dynamics.com */
  baseUrl: string;
  /** Returns a current Bearer token — called before every request */
  getAccessToken: () => Promise<string>;
  /** OData API version — defaults to "9.2" */
  apiVersion?: string;
}

async function odataFetch<T>(
  baseUrl: string,
  getToken: () => Promise<string>,
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = await getToken();
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dataverse ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Retry a schema write that may be blocked by a concurrent PublishAll (0x80071151). */
async function withSchemaRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [4000, 8000, 15000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err);
      const isConflict = msg.includes("0x80071151") || msg.includes("PublishAll");
      if (!isConflict || attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

// ─── OData query builder ──────────────────────────────────────────────────────

function operatorToOData(
  op: FilterOperator,
  field: string,
  value: TokenValue | TokenValue[]
): string {
  const v = (val: TokenValue) =>
    typeof val === "string" ? `'${val.replace(/'/g, "''")}'` : String(val);

  switch (op) {
    case "eq":
      return `${field} eq ${v(value as TokenValue)}`;
    case "ne":
      return `${field} ne ${v(value as TokenValue)}`;
    case "gt":
      return `${field} gt ${v(value as TokenValue)}`;
    case "gte":
      return `${field} ge ${v(value as TokenValue)}`;
    case "lt":
      return `${field} lt ${v(value as TokenValue)}`;
    case "lte":
      return `${field} le ${v(value as TokenValue)}`;
    case "contains":
      return `contains(${field}, ${v(value as TokenValue)})`;
    case "startsWith":
      return `startswith(${field}, ${v(value as TokenValue)})`;
    case "endsWith":
      return `endswith(${field}, ${v(value as TokenValue)})`;
    case "in":
      return (value as TokenValue[])
        .map((val) => `${field} eq ${v(val)}`)
        .join(" or ");
    case "notIn":
      return (value as TokenValue[])
        .map((val) => `${field} ne ${v(val)}`)
        .join(" and ");
    case "null":
      return `${field} eq null`;
    case "notNull":
      return `${field} ne null`;
  }
}

function buildODataQuery(
  def: QueryDefinition,
  context: ResolvedContext
): string {
  const parts: string[] = [];

  // $select
  if (def.select.length > 0) {
    parts.push(`$select=${def.select.join(",")}`);
  }

  // $expand for joins (OData expand with nested $select / $filter)
  if (def.joins.length > 0) {
    const expands = def.joins.map((j) => {
      const alias = j.alias ?? j.table;
      return alias;
    });
    parts.push(`$expand=${expands.join(",")}`);
  }

  // $filter
  const filters = def.where.map((w) => {
    const resolved = resolveValue(w.value, context);
    return operatorToOData(w.operator, w.field, resolved as TokenValue);
  });
  if (filters.length > 0) {
    parts.push(`$filter=${filters.join(" and ")}`);
  }

  // $orderby
  if (def.orderBy.length > 0) {
    const order = def.orderBy
      .map((o) => `${o.field} ${o.direction}`)
      .join(",");
    parts.push(`$orderby=${order}`);
  }

  if (def.top != null) parts.push(`$top=${def.top}`);
  if (def.skip != null) parts.push(`$skip=${def.skip}`);

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ─── Fluent query chain ───────────────────────────────────────────────────────

export class DataverseQuery {
  private def: QueryDefinition = {
    from: "",
    joins: [],
    where: [],
    select: [],
    orderBy: [],
  };

  constructor(
    private readonly baseUrl: string,
    private readonly apiVersion: string,
    private readonly getToken: () => Promise<string>
  ) {}

  from(table: string): this {
    this.def.from = table;
    return this;
  }

  join(clause: JoinClause): this {
    this.def.joins.push(clause);
    return this;
  }

  where(clause: WhereClause): this {
    this.def.where.push(clause);
    return this;
  }

  select(...fields: string[]): this {
    this.def.select.push(...fields);
    return this;
  }

  orderBy(clause: OrderByClause): this {
    this.def.orderBy.push(clause);
    return this;
  }

  top(n: number): this {
    this.def.top = n;
    return this;
  }

  skip(n: number): this {
    this.def.skip = n;
    return this;
  }

  async execute(context: ResolvedContext = {}): Promise<QueryResult> {
    const qs = buildODataQuery(this.def, context);
    const url = `/api/data/v${this.apiVersion}/${this.def.from}${qs}`;
    const token = await this.getToken();

    const res = await fetch(`${this.baseUrl}${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dataverse query failed ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { value: QueryResult };
    return json.value;
  }

  /** Returns the fully resolved QueryDefinition (useful for codegen / debugging) */
  toDefinition(): QueryDefinition {
    return { ...this.def };
  }
}

// ─── Schema introspection ─────────────────────────────────────────────────────

export class DataverseSchema {
  constructor(
    private readonly baseUrl: string,
    private readonly apiVersion: string,
    private readonly getToken: () => Promise<string>
  ) {}

  async getTables(): Promise<DataverseTable[]> {
    // Dataverse metadata API returns PascalCase keys and nested label objects
    interface RawEntity {
      MetadataId: string;
      LogicalName: string;
      DisplayName: { UserLocalizedLabel?: { Label: string } };
      EntitySetName: string;
      PrimaryIdAttribute: string;
      PrimaryNameAttribute: string;
    }
    const data = await odataFetch<{ value: RawEntity[] }>(
      this.baseUrl,
      this.getToken,
      `/api/data/v${this.apiVersion}/EntityDefinitions?$select=MetadataId,LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`
    );
    return data.value.map((e) => ({
      logicalName: e.LogicalName,
      displayName: e.DisplayName?.UserLocalizedLabel?.Label ?? e.LogicalName,
      pluralName: e.EntitySetName,
      entitySetName: e.EntitySetName,
      primaryIdAttribute: e.PrimaryIdAttribute,
      primaryNameAttribute: e.PrimaryNameAttribute,
      metadataId: e.MetadataId,
    }));
  }

  async getFields(tableLogicalName: string): Promise<DataverseField[]> {
    interface RawAttr {
      LogicalName: string;
      DisplayName: { UserLocalizedLabel?: { Label: string } };
      AttributeType: string;
      RequiredLevel: { Value: string };
    }
    // FormatName is a ManagedProperty that includes RichText; Format is an older enum that doesn't.
    // We prefer FormatName.Value when present.
    interface RawFormatAttr {
      LogicalName: string;
      Format?: string | null;
      FormatName?: { Value?: string | null } | null;
    }
    interface RawOption { Value: number; Label: { UserLocalizedLabel?: { Label: string } } }
    interface RawOptionSet { Options: RawOption[] }
    interface RawOptionAttr {
      LogicalName: string;
      OptionSet?: RawOptionSet | null;
      GlobalOptionSet?: RawOptionSet | null;
    }
    const expand = "$expand=OptionSet,GlobalOptionSet";
    const base = `/api/data/v${this.apiVersion}/EntityDefinitions(LogicalName='${tableLogicalName}')`;

    // Format is only defined on typed subtypes, not on base AttributeMetadata,
    // so we fetch it via cast endpoints and merge — same pattern as OptionSet.
    const [allAttrs, picklistAttrs, multiPicklistAttrs, stringAttrs, memoAttrs, intAttrs] =
      await Promise.all([
        odataFetch<{ value: RawAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes?$select=LogicalName,DisplayName,AttributeType,RequiredLevel`),
        odataFetch<{ value: RawOptionAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&${expand}`),
        odataFetch<{ value: RawOptionAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes/Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata?$select=LogicalName&${expand}`),
        odataFetch<{ value: RawFormatAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,Format,FormatName`),
        odataFetch<{ value: RawFormatAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,Format,FormatName`),
        odataFetch<{ value: RawFormatAttr[] }>(this.baseUrl, this.getToken,
          `${base}/Attributes/Microsoft.Dynamics.CRM.IntegerAttributeMetadata?$select=LogicalName,Format`),
      ]);

    const optionsMap = new Map<string, import("./types.js").FieldOption[]>();
    for (const a of [...picklistAttrs.value, ...multiPicklistAttrs.value]) {
      const optSet = a.OptionSet ?? a.GlobalOptionSet;
      optionsMap.set(a.LogicalName, (optSet?.Options ?? []).map((o) => ({
        value: o.Value,
        label: o.Label?.UserLocalizedLabel?.Label ?? String(o.Value),
      })));
    }

    const formatMap = new Map<string, string>();
    for (const a of [...stringAttrs.value, ...memoAttrs.value, ...intAttrs.value]) {
      // FormatName.Value is the authoritative source (includes RichText); fall back to Format
      const fmt = a.FormatName?.Value ?? a.Format;
      if (fmt) formatMap.set(a.LogicalName, fmt);
    }

    return allAttrs.value.map((a) => {
      const requiredLevel = (a.RequiredLevel?.Value ?? "None") as import("./types.js").RequiredLevel;
      const mappedType = ATTR_TYPE_MAP[a.AttributeType] ?? "String";
      // Default format so Type Details always has something to show for text/number fields
      const defaultFormat =
        mappedType === "String" || mappedType === "Memo" ? "Text" :
        mappedType === "Integer" ? "None" : undefined;
      return {
        logicalName:   a.LogicalName,
        displayName:   a.DisplayName?.UserLocalizedLabel?.Label ?? a.LogicalName,
        type:          mappedType,
        required:      requiredLevel === "SystemRequired" || requiredLevel === "ApplicationRequired",
        requiredLevel,
        format:        (formatMap.get(a.LogicalName) ?? defaultFormat) as import("./types.js").DataverseField["format"],
        options:       optionsMap.get(a.LogicalName),
      };
    });
  }

  async getRelationships(
    tableLogicalName: string
  ): Promise<DataverseRelationship[]> {
    interface RawRel {
      SchemaName: string;
      ReferencingEntity: string;
      ReferencingAttribute: string;
      ReferencedEntity: string;
      ReferencedAttribute: string;
    }
    const [oneToMany, manyToOne] = await Promise.all([
      odataFetch<{ value: RawRel[] }>(
        this.baseUrl,
        this.getToken,
        `/api/data/v${this.apiVersion}/EntityDefinitions(LogicalName='${tableLogicalName}')/OneToManyRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute`
      ),
      odataFetch<{ value: RawRel[] }>(
        this.baseUrl,
        this.getToken,
        `/api/data/v${this.apiVersion}/EntityDefinitions(LogicalName='${tableLogicalName}')/ManyToOneRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute`
      ),
    ]);
    const mapRel = (r: RawRel, type: "OneToMany" | "ManyToOne"): DataverseRelationship => ({
      schemaName:           r.SchemaName,
      type,
      referencingEntity:    r.ReferencingEntity,
      referencingAttribute: r.ReferencingAttribute,
      referencedEntity:     r.ReferencedEntity,
      referencedAttribute:  r.ReferencedAttribute,
    });
    return [
      ...oneToMany.value.map((r) => mapRel(r, "OneToMany")),
      ...manyToOne.value.map((r) => mapRel(r, "ManyToOne")),
    ];
  }

  async createTable(def: CreateTableDefinition): Promise<string> {
    const logicalName = `${PUBLISHER_PREFIX}${def.schemaName.toLowerCase()}`;
    const body = {
      "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
      SchemaName: `${PUBLISHER_PREFIX}${def.schemaName}`,
      DisplayName: mdLabel(def.displayName),
      DisplayCollectionName: mdLabel(def.displayCollectionName),
      Description: mdLabel(def.description ?? ""),
      HasActivities: def.hasActivities ?? false,
      HasNotes: def.hasNotes ?? false,
      OwnershipType: def.ownershipType ?? "UserOwned",
      Attributes: [{
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        AttributeType: "String",
        IsPrimaryName: true,
        SchemaName: `${PUBLISHER_PREFIX}Name`,
        DisplayName: mdLabel(def.primaryColumnDisplayName ?? "Name"),
        RequiredLevel: mdRequired("ApplicationRequired"),
        MaxLength: def.primaryNameMaxLength ?? 200,
      }],
    };
    return withSchemaRetry(async () => {
      const token = await this.getToken();
      const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/EntityDefinitions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "OData-MaxVersion": "4.0", "OData-Version": "4.0",
          "Content-Type": "application/json", Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Create table failed ${res.status}: ${await res.text()}`);
      return logicalName;
    });
  }

  async createField(tableLogicalName: string, def: CreateFieldDefinition): Promise<string> {
    if (def.type === "Lookup") {
      throw new Error("Lookup fields must be created via a relationship — use createRelationship() (coming soon).");
    }
    const logicalName = `${PUBLISHER_PREFIX}${def.schemaName.toLowerCase()}`;
    const body: Record<string, unknown> = {
      "@odata.type": FIELD_ODATA_TYPE[def.type],
      SchemaName: `${PUBLISHER_PREFIX}${def.schemaName}`,
      DisplayName: mdLabel(def.displayName),
      Description: mdLabel(def.description ?? ""),
      RequiredLevel: mdRequired(def.required ?? "None"),
    };

    if (def.type === "String")  { body.MaxLength = def.maxLength ?? 100; if (def.format) body.Format = def.format; }
    if (def.type === "Memo")    { body.MaxLength = def.maxLength ?? 4000; }
    if (def.type === "Integer") { if (def.minValue != null) body.MinValue = def.minValue; if (def.maxValue != null) body.MaxValue = def.maxValue; if (def.format) body.Format = def.format; }
    if (def.type === "Decimal") { body.Precision = def.precision ?? 2; if (def.minValue != null) body.MinValue = def.minValue; if (def.maxValue != null) body.MaxValue = def.maxValue; }
    if (def.type === "Money")   { body.Precision = def.precision ?? 2; }
    if (def.type === "DateTime") { body.DateTimeBehavior = { Value: def.dateTimeBehavior ?? "UserLocal" }; }
    if (def.type === "Boolean") {
      body.DefaultValue = def.defaultValue ?? false;
      body.OptionSet = {
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
        TrueOption:  { "@odata.type": "Microsoft.Dynamics.CRM.OptionMetadata", Value: 1, Label: mdLabel(def.trueLabel  ?? "Yes") },
        FalseOption: { "@odata.type": "Microsoft.Dynamics.CRM.OptionMetadata", Value: 0, Label: mdLabel(def.falseLabel ?? "No")  },
      };
    }
    if (def.type === "OptionSet" || def.type === "MultiSelectOptionSet") {
      if (def.globalOptionSetName) {
        body.GlobalOptionSet = { Name: def.globalOptionSetName };
      } else {
        body.OptionSet = {
          "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: (def.options ?? []).map((o) => ({
            "@odata.type": "Microsoft.Dynamics.CRM.OptionMetadata",
            Value: o.value,
            Label: mdLabel(o.label),
          })),
        };
      }
    }
    if (def.type === "File") {
      body.MaxSizeInKB = def.maxSizeInKB ?? 32768;
    }
    if (def.type === "Image") {
      body.IsPrimaryImage   = def.isPrimaryImage  ?? false;
      body.MaxHeight        = def.maxHeight        ?? 144;
      body.MaxWidth         = def.maxWidth         ?? 144;
      body.CanStoreFullImage = def.canStoreFullImage ?? false;
    }

    return withSchemaRetry(async () => {
      const token = await this.getToken();
      const res = await fetch(
        `${this.baseUrl}/api/data/v${this.apiVersion}/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "OData-MaxVersion": "4.0", "OData-Version": "4.0",
            "Content-Type": "application/json", Accept: "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`Create field failed ${res.status}: ${await res.text()}`);
      return logicalName;
    });
  }

  async updateColumn(
    tableLogicalName: string,
    fieldLogicalName: string,
    update: UpdateColumnDefinition,
    currentType: DataverseFieldType
  ): Promise<void> {
    const body: Record<string, unknown> = {
      "@odata.type": FIELD_ODATA_TYPE[currentType],
      LogicalName: fieldLogicalName,
    };

    if (update.displayName !== undefined) body.DisplayName = mdLabel(update.displayName);
    if (update.description !== undefined) body.Description = mdLabel(update.description);
    if (update.required    !== undefined) body.RequiredLevel = mdRequired(update.required);

    if (update.maxLength !== undefined) body.MaxLength = update.maxLength;
    if (update.format    !== undefined) body.Format    = update.format;
    if (update.minValue  !== undefined) body.MinValue  = update.minValue;
    if (update.maxValue  !== undefined) body.MaxValue  = update.maxValue;
    if (update.precision !== undefined) body.Precision = update.precision;

    if (currentType === "Boolean" && (update.trueLabel || update.falseLabel)) {
      body.OptionSet = {
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
        TrueOption:  { "@odata.type": "Microsoft.Dynamics.CRM.OptionMetadata", Value: 1, Label: mdLabel(update.trueLabel  ?? "Yes") },
        FalseOption: { "@odata.type": "Microsoft.Dynamics.CRM.OptionMetadata", Value: 0, Label: mdLabel(update.falseLabel ?? "No")  },
      };
    }

    if (update.maxSizeInKB    !== undefined) body.MaxSizeInKB    = update.maxSizeInKB;
    if (update.isPrimaryImage  !== undefined) body.IsPrimaryImage  = update.isPrimaryImage;
    if (update.maxHeight       !== undefined) body.MaxHeight       = update.maxHeight;
    if (update.maxWidth        !== undefined) body.MaxWidth        = update.maxWidth;
    if (update.canStoreFullImage !== undefined) body.CanStoreFullImage = update.canStoreFullImage;

    await withSchemaRetry(async () => {
      const token = await this.getToken();
      const res = await fetch(
        `${this.baseUrl}/api/data/v${this.apiVersion}/EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes(LogicalName='${fieldLogicalName}')`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "OData-MaxVersion": "4.0", "OData-Version": "4.0",
            "Content-Type": "application/json", Accept: "application/json",
            "MSCRM-Merge-Labels": "true",
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`Update column failed ${res.status}: ${await res.text()}`);
    });

    // ── OptionSet option CRUD ──────────────────────────────────────────────────
    const optionBase = { EntityLogicalName: tableLogicalName, AttributeLogicalName: fieldLogicalName };

    for (const opt of update.addOptions ?? []) {
      await withSchemaRetry(async () => {
        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/InsertOptionValue`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "OData-MaxVersion": "4.0", "OData-Version": "4.0", "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...optionBase, Value: opt.value, Label: mdLabel(opt.label) }),
        });
        if (!res.ok) throw new Error(`InsertOptionValue failed ${res.status}: ${await res.text()}`);
      });
    }

    for (const opt of update.updateOptions ?? []) {
      await withSchemaRetry(async () => {
        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/UpdateOptionValue`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "OData-MaxVersion": "4.0", "OData-Version": "4.0", "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...optionBase, Value: opt.value, Label: mdLabel(opt.label) }),
        });
        if (!res.ok) throw new Error(`UpdateOptionValue failed ${res.status}: ${await res.text()}`);
      });
    }

    for (const val of update.deleteOptionValues ?? []) {
      await withSchemaRetry(async () => {
        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/DeleteOptionValue`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "OData-MaxVersion": "4.0", "OData-Version": "4.0", "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...optionBase, Value: val }),
        });
        if (!res.ok) throw new Error(`DeleteOptionValue failed ${res.status}: ${await res.text()}`);
      });
    }
  }

  async createRelationship(def: CreateRelationshipDefinition): Promise<string> {
    const prefix = "cr_";
    const attrSchema = `${prefix}${def.lookupSchemaName}`;
    const relSchema  = `${prefix}${def.referencedEntity}_${def.referencingEntity}_${def.lookupSchemaName.toLowerCase()}`;

    const body = {
      "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
      SchemaName: relSchema,
      ReferencedEntity: def.referencedEntity,
      ReferencingEntity: def.referencingEntity,
      Lookup: {
        "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
        SchemaName: attrSchema,
        DisplayName: mdLabel(def.lookupDisplayName),
        Description: mdLabel(def.lookupDescription ?? ""),
        RequiredLevel: mdRequired(def.lookupRequired ?? "None"),
      },
      AssociatedMenuConfiguration: {
        Behavior: def.associatedMenuLabel ? "UseLabel" : "UseCollectionName",
        Group: "Details",
        Label: mdLabel(def.associatedMenuLabel ?? ""),
        Order: 10000,
      },
      CascadeConfiguration: {
        Assign:   "NoCascade",
        Delete:   def.cascadeDelete ?? "RemoveLink",
        Merge:    "NoCascade",
        Reparent: "NoCascade",
        Share:    "NoCascade",
        Unshare:  "NoCascade",
      },
    };

    return withSchemaRetry(async () => {
      const token = await this.getToken();
      const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/RelationshipDefinitions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "OData-MaxVersion": "4.0", "OData-Version": "4.0",
          "Content-Type": "application/json", Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Create relationship failed ${res.status}: ${await res.text()}`);
      return attrSchema.toLowerCase();
    });
  }

  async publishCustomizations(): Promise<void> {
    return withSchemaRetry(async () => {
      const token = await this.getToken();
      const res = await fetch(`${this.baseUrl}/api/data/v${this.apiVersion}/PublishAllXml`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "OData-MaxVersion": "4.0", "OData-Version": "4.0",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!res.ok) throw new Error(`Publish failed ${res.status}: ${await res.text()}`);
    });
  }
}

// ─── Schema write helpers ─────────────────────────────────────────────────────

const PUBLISHER_PREFIX = "cr_";

const ATTR_TYPE_MAP: Record<string, DataverseFieldType> = {
  String:               "String",
  Memo:                 "Memo",
  Integer:              "Integer",
  BigInt:               "Integer",
  Decimal:              "Decimal",
  Money:                "Money",
  Boolean:              "Boolean",
  DateTime:             "DateTime",
  Lookup:               "Lookup",
  Owner:                "Lookup",
  Customer:             "Lookup",
  Picklist:             "OptionSet",
  MultiSelectPicklist:  "MultiSelectOptionSet",
  Uniqueidentifier:     "UniqueIdentifier",
  File:                 "File",
  Image:                "Image",
};

const FIELD_ODATA_TYPE: Record<DataverseFieldType, string> = {
  String:               "Microsoft.Dynamics.CRM.StringAttributeMetadata",
  Memo:                 "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
  Integer:              "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
  Decimal:              "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
  Money:                "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
  Boolean:              "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
  DateTime:             "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
  Lookup:               "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
  OptionSet:            "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
  MultiSelectOptionSet: "Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata",
  UniqueIdentifier:     "Microsoft.Dynamics.CRM.UniqueIdentifierAttributeMetadata",
  File:                 "Microsoft.Dynamics.CRM.FileAttributeMetadata",
  Image:                "Microsoft.Dynamics.CRM.ImageAttributeMetadata",
};

function mdLabel(text: string) {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.Label",
    LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 }],
    UserLocalizedLabel: { "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 },
  };
}

function mdRequired(level: RequiredLevel = "None") {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.AttributeRequiredLevelManagedProperty",
    Value: level,
    CanBeChanged: true,
    ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings",
  };
}

// ─── Transaction engine ───────────────────────────────────────────────────────

async function executeWrite(
  baseUrl: string,
  apiVersion: string,
  getToken: () => Promise<string>,
  op: WriteOperation
): Promise<{ id?: string; error?: string }> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    if (op.type === "create") {
      const res = await fetch(
        `${baseUrl}/api/data/v${apiVersion}/${op.table}`,
        { method: "POST", headers, body: JSON.stringify(op.data) }
      );
      if (!res.ok) throw new Error(await res.text());
      const location = res.headers.get("OData-EntityId") ?? "";
      const id = location.match(/\(([^)]+)\)$/)?.[1];
      return { id };
    }

    if (op.type === "update") {
      const res = await fetch(
        `${baseUrl}/api/data/v${apiVersion}/${op.table}(${op.id})`,
        { method: "PATCH", headers, body: JSON.stringify(op.data) }
      );
      if (!res.ok) throw new Error(await res.text());
      return { id: op.id };
    }

    if (op.type === "delete") {
      const res = await fetch(
        `${baseUrl}/api/data/v${apiVersion}/${op.table}(${op.id})`,
        { method: "DELETE", headers }
      );
      if (!res.ok) throw new Error(await res.text());
      return { id: op.id };
    }

    return {};
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class DataverseClient {
  private readonly apiVersion: string;
  readonly schema: DataverseSchema;

  constructor(private readonly options: DataverseClientOptions) {
    this.apiVersion = options.apiVersion ?? "9.2";
    this.schema = new DataverseSchema(
      options.baseUrl,
      this.apiVersion,
      options.getAccessToken
    );
  }

  /** Start a fluent query chain */
  query(): DataverseQuery {
    return new DataverseQuery(
      this.options.baseUrl,
      this.apiVersion,
      this.options.getAccessToken
    );
  }

  /** Convenience alias so callers can write client.from("table").where(...).execute() */
  from(table: string): DataverseQuery {
    return this.query().from(table);
  }

  /** Resolves the Dataverse-internal systemuserid for the authenticated user.
   *  This GUID may differ from the Azure AD Object ID (MSAL localAccountId). */
  async whoAmI(): Promise<{ UserId: string; BusinessUnitId: string; OrganizationId: string }> {
    return odataFetch(
      this.options.baseUrl,
      this.options.getAccessToken,
      `/api/data/v${this.apiVersion}/WhoAmI()`
    );
  }

  /** Fetch a single record by primary key.
   *  For outgoing navigation property traversal pass navPath (e.g. "cr_positionid").
   *  Single-record OData responses are a plain JSON object, not { value: [] }. */
  async fetchRecord(
    entitySetName: string,
    recordId: string,
    queryParams: string,
    navPath?: string
  ): Promise<Record<string, TokenValue> | null> {
    const token = await this.options.getAccessToken();
    const seg = navPath ? `${entitySetName}(${recordId})/${navPath}` : `${entitySetName}(${recordId})`;
    const url = `${this.options.baseUrl}/api/data/v${this.apiVersion}/${seg}${queryParams}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        "Prefer": `odata.include-annotations="OData.Community.Display.V1.FormattedValue"`,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dataverse fetch record failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<Record<string, TokenValue>>;
  }

  /** Execute a pre-built OData GET request against an entity set.
   *  Caller is responsible for constructing a correctly encoded query string. */
  async fetchPage(entitySetName: string, queryParams: string): Promise<QueryResult> {
    const token = await this.options.getAccessToken();
    const url = `${this.options.baseUrl}/api/data/v${this.apiVersion}/${entitySetName}${queryParams}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        // Ask Dataverse to include display-name annotations for lookups and option sets.
        // Lookup: _xxx_value@OData.Community.Display.V1.FormattedValue → "John Smith"
        // OptionSet: statecode@OData.Community.Display.V1.FormattedValue → "Active"
        "Prefer": `odata.include-annotations="OData.Community.Display.V1.FormattedValue"`,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dataverse query failed ${res.status}: ${body}`);
    }
    const json = (await res.json()) as { value: QueryResult };
    return json.value;
  }

  /** PATCH a single record with an If-Match etag header for optimistic concurrency.
   *  Returns "conflict" (HTTP 412) without throwing — caller decides what to do. */
  async patchWithEtag(
    entitySetName: string,
    id: string,
    data: Record<string, TokenValue>,
    etag: string,
  ): Promise<"ok" | "conflict"> {
    const token = await this.options.getAccessToken();
    const url = `${this.options.baseUrl}/api/data/v${this.apiVersion}/${entitySetName}(${id})`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization:    `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version":    "4.0",
        "Content-Type":   "application/json",
        Accept:           "application/json",
        "If-Match":       etag,
      },
      body: JSON.stringify(data),
    });
    if (res.status === 412) return "conflict";
    if (!res.ok) throw new Error(`Dataverse PATCH failed ${res.status}: ${await res.text()}`);
    return "ok";
  }

  /** Execute multiple write operations. If any fail, all subsequent operations
   *  are skipped and the results array reports each outcome. */
  async transaction(operations: WriteOperation[]): Promise<TransactionResult> {
    const results: TransactionResult["results"] = [];
    let aborted = false;

    for (const op of operations) {
      if (aborted) {
        results.push({ operation: op, error: "aborted" });
        continue;
      }
      const result = await executeWrite(
        this.options.baseUrl,
        this.apiVersion,
        this.options.getAccessToken,
        op
      );
      results.push({ operation: op, ...result });
      if (result.error) aborted = true;
    }

    return { success: !aborted, results };
  }
}

export function createDataverseClient(
  options: DataverseClientOptions
): DataverseClient {
  return new DataverseClient(options);
}
