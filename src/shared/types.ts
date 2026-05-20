// ─── Context tokens ───────────────────────────────────────────────────────────

export type ContextToken =
  | "$currentUser"
  | "$currentUserEmail"
  | "$anchorPosition"
  | "$now"
  | "$today"
  | "$queryParam"
  | `$param:${string}`
  | `$join:${string}.${string}`
  | `$hop:${string}`
  | `$position:${string}`
  | `$formField:${string}`
  | `$record:${string}`
  | `$trigger:${string}`
  | `$env:${string}`
  | `$secret:${string}`;

export type TokenValue = string | number | boolean | Date | null;

export type ResolvedContext = Record<string, TokenValue>;

// ─── Schema types ─────────────────────────────────────────────────────────────

export interface DataverseTable {
  logicalName: string;
  displayName: string;
  pluralName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute: string;
  /** MetadataId from Dataverse — used to build direct PowerApps maker portal links */
  metadataId?: string;
}

export type DataverseFieldType =
  | "String"
  | "Integer"
  | "Decimal"
  | "Boolean"
  | "DateTime"
  | "Lookup"
  | "OptionSet"
  | "MultiSelectOptionSet"
  | "Memo"
  | "Money"
  | "UniqueIdentifier"
  | "File"
  | "Image";

export type RequiredLevel =
  | "None"
  | "SystemRequired"
  | "ApplicationRequired"
  | "Recommended";

export type StringFieldFormat =
  | "Email" | "Phone" | "PhoneticGuide" | "RichText" | "Text" | "TextArea" | "TickerSymbol" | "Url";

export type IntegerFieldFormat = "None" | "Duration" | "Language" | "TimeZone";

export type DateTimeBehavior = "UserLocal" | "DateOnly" | "TimeZoneIndependent";

export interface FieldOption { label: string; value: number }

export interface DataverseField {
  logicalName: string;
  displayName: string;
  type: DataverseFieldType;
  required: boolean;
  requiredLevel?: RequiredLevel;
  description?: string;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  precision?: number;
  format?: StringFieldFormat | IntegerFieldFormat;
  dateTimeBehavior?: DateTimeBehavior;
  /** For Lookup fields — the target entity logical names */
  targets?: string[];
  /** For OptionSet / MultiSelectOptionSet */
  options?: FieldOption[];
  trueLabel?: string;
  falseLabel?: string;
  // File
  maxSizeInKB?: number;
  // Image
  isPrimaryImage?: boolean;
  maxHeight?: number;
  maxWidth?: number;
  canStoreFullImage?: boolean;
}

// ─── Schema write types ───────────────────────────────────────────────────────

export interface CreateFieldDefinition {
  /** Without publisher prefix — cr_ added automatically */
  schemaName: string;
  displayName: string;
  type: DataverseFieldType;
  required?: RequiredLevel;
  description?: string;
  maxLength?: number;
  format?: StringFieldFormat | IntegerFieldFormat;
  minValue?: number;
  maxValue?: number;
  precision?: number;
  dateTimeBehavior?: DateTimeBehavior;
  targets?: string[];
  options?: FieldOption[];
  globalOptionSetName?: string;
  trueLabel?: string;
  falseLabel?: string;
  defaultValue?: boolean;
  // File
  maxSizeInKB?: number;
  // Image
  isPrimaryImage?: boolean;
  maxHeight?: number;
  maxWidth?: number;
  canStoreFullImage?: boolean;
}

export type CascadeType = "NoCascade" | "Cascade" | "RemoveLink" | "Restrict";

export interface CreateRelationshipDefinition {
  /** Display name for the lookup field on the referencing entity */
  lookupDisplayName: string;
  /** Schema name for the lookup attribute — without publisher prefix */
  lookupSchemaName: string;
  lookupRequired?: RequiredLevel;
  lookupDescription?: string;
  /** The "one" side — the entity being looked up */
  referencedEntity: string;
  /** The "many" side — the entity that receives the lookup field */
  referencingEntity: string;
  /** Label for the related-records sub-grid on the referenced entity */
  associatedMenuLabel?: string;
  cascadeDelete?: "RemoveLink" | "Restrict" | "Cascade";
}

// Only properties that Dataverse allows changing after creation
export interface UpdateColumnDefinition {
  displayName?: string;
  description?: string;
  required?: RequiredLevel;
  // String / Memo — max length can only be increased
  maxLength?: number;
  format?: StringFieldFormat | IntegerFieldFormat;
  // Integer / Decimal / Money
  minValue?: number;
  maxValue?: number;
  precision?: number;
  // Boolean
  trueLabel?: string;
  falseLabel?: string;
  // OptionSet — granular option operations
  addOptions?: FieldOption[];          // new options to insert
  updateOptions?: FieldOption[];       // existing options to relabel (matched by value)
  deleteOptionValues?: number[];       // option integer values to remove
  // File — can only be increased
  maxSizeInKB?: number;
  // Image
  isPrimaryImage?: boolean;
  maxHeight?: number;
  maxWidth?: number;
  canStoreFullImage?: boolean;
}

export interface CreateTableDefinition {
  /** Without publisher prefix — cr_ added automatically */
  schemaName: string;
  displayName: string;
  displayCollectionName: string;
  description?: string;
  hasNotes?: boolean;
  hasActivities?: boolean;
  ownershipType?: "UserOwned" | "OrganizationOwned";
  /** Display label for the primary name column — defaults to "Name" */
  primaryColumnDisplayName?: string;
  primaryNameMaxLength?: number;
}

export interface DataverseRelationship {
  schemaName: string;
  type: "OneToMany" | "ManyToOne" | "ManyToMany";
  referencingEntity: string;
  referencingAttribute: string;
  referencedEntity: string;
  referencedAttribute: string;
}

// ─── Query builder types ──────────────────────────────────────────────────────

export interface JoinClause {
  table: string;
  on: [string, string]; // [localField, foreignField]
  alias?: string;
  type?: "inner" | "left";
}

export type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "notIn"
  | "null"
  | "notNull";

export interface WhereClause {
  field: string;
  operator: FilterOperator;
  value: TokenValue | ContextToken | (TokenValue | ContextToken)[];
}

export interface OrderByClause {
  field: string;
  direction: "asc" | "desc";
}

export interface QueryDefinition {
  from: string;
  joins: JoinClause[];
  where: WhereClause[];
  select: string[];
  orderBy: OrderByClause[];
  top?: number;
  skip?: number;
}

export type QueryResult = Record<string, TokenValue>[];

export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  definition: QueryDefinition;
  createdAt: string;
  updatedAt: string;
}

// ─── Write / transaction types ────────────────────────────────────────────────

export type WriteOperation =
  | { type: "create"; table: string; data: Record<string, TokenValue> }
  | {
      type: "update";
      table: string;
      id: string;
      data: Record<string, TokenValue>;
    }
  | { type: "delete"; table: string; id: string };

export interface TransactionResult {
  success: boolean;
  results: Array<{ operation: WriteOperation; id?: string; error?: string }>;
}

// ─── RBAC types ───────────────────────────────────────────────────────────────

export type TierId = "t1" | "t2" | "t3" | "t4" | "t5";

/** A tier entry with optional environment/app scope constraints */
export interface TierAccess {
  id: TierId;
  /** Undefined = all environments */
  environments?: string[];
  /** Undefined = all apps */
  apps?: string[];
}

/** Shorthand string "t1" is sugar for { id: "t1" } */
export type TierEntry = TierId | TierAccess;

export interface RoleDefinition {
  id: string;
  /** Entra ID group GUID — compared against token group claims */
  entraGroup: string;
  tiers: TierEntry[];
  scope: {
    environments: string[] | "*";
    apps: string[] | "*";
  };
}

export interface RolesConfig {
  $schema: string;
  client: string;
  roles: RoleDefinition[];
}

export interface EffectivePermissions {
  userId: string;
  userName: string;
  userEmail: string;
  isPlatformOwner: boolean;
  /** Resolved role IDs from matched Entra groups */
  roles: string[];
  /** True if the user's token hit the >200-group overage claim — Graph fallback needed */
  hasGroupsOverage: boolean;
  /** Whether the user can perform operations requiring this tier in this environment/app */
  canAccess(tier: TierId, environment: string, appId?: string): boolean;
}

// ─── Deploy types ─────────────────────────────────────────────────────────────

export type DeployMode = "integrated" | "pull_request" | "export_only";

export type Env = "dev" | "test" | "prod";

export interface ClientCredentials {
  githubInstallationId?: number;
  githubOwner?: string;
  azureTenantId?: string;
  azureSubscriptionId?: string;
  azureResourceGroup?: string;
  azureRegion?: string;
  azureSpClientId?: string;
  azureSpClientSecret?: string;
  publishedAppClientId?: string;
  dataverseUrl?: string;
}

export interface AppDeploymentTarget {
  appId: string;
  environment: Env;
  deployMode: DeployMode;
  githubOwner?: string;
  githubRepo?: string;
  swaResourceId?: string;
  swaDefaultHostname?: string;
  selfServiceProvisioned?: boolean;
  selfServiceProvisionedAt?: string;
  provisionedAt: string;
  provisionedBy: string;
  provisionedByUpn?: string;
}

// ─── Config file types ────────────────────────────────────────────────────────

export interface EnvConfig {
  name: string;
  dataverseUrl: string;
  tenantId: string;
  clientId: string;
  functionAppUrl: string;
  staticWebAppUrl: string;
  keyVaultName: string;
}

export interface EnvConfigExtended extends EnvConfig {
  env: "dev" | "test" | "prod";
  gitBranch: string;
  schemaVersion?: string | null;
  lastDeploy?: string | null;
}

export interface AppManifest {
  appId: string;
  displayName: string;
  version: string;
  environments: string[];
  configFiles: string[];
  deploymentTargets: string[];
}

// ─── Data source config types ─────────────────────────────────────────────────

export interface StaticFilterConfig {
  field: string;
  operator: FilterOperator;
  /** Literal value or a context token string like "$currentUser" */
  value: string;
}

/**
 * A group of filter conditions joined by AND.
 * Multiple groups are joined by OR — a record matches if it satisfies
 * ALL conditions in ANY single group.
 */
export interface FilterGroup {
  conditions: StaticFilterConfig[];
}

export interface DirectDataSourceConfig {
  mode: "direct";
  /** Logical name of the source table */
  table: string;
  /** Optional reference to a saved query as a starting-point template */
  queryId?: string;
  /** OR-of-AND filter logic: groups joined by OR, conditions within a group joined by AND */
  filterGroups: FilterGroup[];
}

/** A single step in a user-connected traversal chain */
export interface HopConfig {
  fromTable: string;
  toTable: string;
  relationshipSchemaName: string;
  /** "outgoing" = fromTable has the FK (ManyToOne); "incoming" = toTable has the FK (OneToMany) */
  direction: "outgoing" | "incoming";
  /** Join field on fromTable */
  fromField: string;
  /** Join field on toTable */
  toField: string;
}

export interface UserConnectedDataSourceConfig {
  mode: "userConnected";
  /** Chain of hops starting from systemuser (current user). Maximum 4. */
  hops: HopConfig[];
  /** Optional filters applied to records at the final table in the chain (OR-of-AND) */
  filterGroups: FilterGroup[];
}

export interface AnchorDataSourceConfig {
  mode: "anchor";
  /**
   * Zero hops = the anchor record itself (the page's /:recordId record).
   * N hops = records reachable from the anchor via relationships.
   * For detail views, max 1 hop (outgoing ManyToOne only).
   */
  hops: HopConfig[];
  /** Filters applied to the final record set (OR-of-AND) */
  filterGroups: FilterGroup[];
}

export type DataSourceConfig = DirectDataSourceConfig | UserConnectedDataSourceConfig | AnchorDataSourceConfig;

// ─── View config types ────────────────────────────────────────────────────────

export type ViewKind =
  | "table"
  | "list"
  | "calendar"
  | "map"
  | "detail"
  | "createForm"
  | "updateForm"
  | "actionButton"
  | "pageLink"
  | "urlLink";

export interface FormFieldConfig {
  field: string;
  label?: string;
  order: number;
}

export interface ViewConfig {
  id: string;
  pageId: string;
  order: number;
  kind: ViewKind;
  label?: string;
  // Data source — for record-displaying views (table, list, calendar, map, detail)
  dataSource?: DataSourceConfig;
  // Record-displaying views: which fields to show
  fields?: string[];
  /**
   * Ordered mix of field logical names and "link:<pageId>" entries.
   * Supersedes the separate fields/linkedPageIds arrays for display ordering.
   * fields and linkedPageIds are kept in sync on save for runtime/OData use.
   */
  columnOrder?: string[];
  sortField?: string;
  sortDir?: "asc" | "desc";
  // Calendar
  dateField?: string;
  endDateField?: string;
  // Map
  latField?: string;
  lngField?: string;
  // Forms (createForm, updateForm)
  formFields?: FormFieldConfig[];
  // Navigation (pageLink, urlLink, actionButton)
  targetPageId?: string;
  url?: string;
  // Record-level linking: single-record page IDs in same app with matching primaryTable
  linkedPageIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Section / Page / App config types ───────────────────────────────────────

/** Retained for future multi-column layout use; not currently used on pages */
export interface SectionConfig {
  id: string;
  pageId: string;
  order: number;
  label?: string;
  columnCount: number;
  viewElementIds: string[];
}

interface PageConfigBase {
  id: string;
  appId: string;
  name: string;
  slug: string;
  inNav: boolean;
  views: ViewConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface StandardPageConfig extends PageConfigBase {
  kind: "standard";
  navOrder: number;
  // No primaryTable or dataSource — data source and table binding live on individual views
}

export interface SingleRecordPageConfig extends PageConfigBase {
  kind: "singleRecord";
  parentPageId: string;
  /** Matches the parent page's primaryTable; defines the URL contract /:recordId */
  primaryTable: string;
}

export type PageConfig = StandardPageConfig | SingleRecordPageConfig;

/** Exported as *.app.json */
export interface AppConfig {
  id: string;
  name: string;
  slug: string;
  environment: string;
  description?: string;
  pages: PageConfig[];
  createdAt: string;
  updatedAt: string;
}
