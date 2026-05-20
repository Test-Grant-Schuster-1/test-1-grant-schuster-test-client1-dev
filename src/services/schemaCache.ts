import type { DataverseField } from "../shared/types";
import { getAccessToken } from "../auth/tokenProvider.js";

const DATAVERSE_URL = import.meta.env.VITE_DATAVERSE_URL as string | undefined;
const MOCK_SCHEMA   = import.meta.env.VITE_MOCK_SCHEMA === "true";

// AttributeType values returned by the Dataverse metadata API → our field type enum
const ATTR_TYPE_MAP: Record<string, DataverseField["type"]> = {
  String:               "String",
  Memo:                 "Memo",
  Integer:              "Integer",
  BigInt:               "Integer",
  Decimal:              "Decimal",
  Money:                "Money",
  Boolean:              "Boolean",
  DateTime:             "DateTime",
  Lookup:               "Lookup",
  Owner:                "Lookup",    // ownerid, createdby, modifiedby
  Customer:             "Lookup",    // customerid (polymorphic)
  Picklist:             "OptionSet",
  MultiSelectPicklist:  "MultiSelectOptionSet",
  Uniqueidentifier:     "UniqueIdentifier",
  File:                 "File",
  Image:                "Image",
};

// One cache entry per entity logical name, populated on first access.
const cache = new Map<string, DataverseField[]>();

/**
 * Returns a minimal field list (logicalName + type) for the given Dataverse entity.
 * Used by resolveDataSource to correctly transform lookup fields in $select and $filter.
 * Returns [] immediately in mock-schema mode (resolveDataSource uses mock data anyway).
 * Returns [] silently on network error so views still render with best-effort field handling.
 */
export async function getTableFields(tableName: string): Promise<DataverseField[]> {
  if (MOCK_SCHEMA || !DATAVERSE_URL) return [];
  if (cache.has(tableName)) return cache.get(tableName)!;

  let fields: DataverseField[];
  try {
    const token = await getAccessToken();
    const url =
      `${DATAVERSE_URL}/api/data/v9.2/EntityDefinitions(LogicalName='${tableName}')/Attributes` +
      `?$select=LogicalName,AttributeType`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      fields = [];
    } else {
      const data = await res.json() as {
        value: Array<{ LogicalName: string; AttributeType: string }>;
      };
      fields = data.value.map((a) => ({
        logicalName: a.LogicalName,
        displayName: a.LogicalName,
        type: (ATTR_TYPE_MAP[a.AttributeType] ?? "String") as DataverseField["type"],
        required: false,
      }));
    }
  } catch {
    fields = [];
  }

  cache.set(tableName, fields);
  return fields;
}
