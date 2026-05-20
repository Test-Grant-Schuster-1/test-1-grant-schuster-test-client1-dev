import type { DataverseRelationship } from "../shared/types";
import { getAccessToken } from "../auth/tokenProvider.js";

const DATAVERSE_URL = import.meta.env.VITE_DATAVERSE_URL as string | undefined;
const MOCK_SCHEMA   = import.meta.env.VITE_MOCK_SCHEMA === "true";

const cache = new Map<string, DataverseRelationship | null>();

/**
 * Fetches Dataverse relationship metadata by schema name and caches the result.
 * Used by the sequential hop resolver to find the correct queryTable
 * (referencingEntity) and filterFK (referencingAttribute) for each incoming hop,
 * so the OData query is issued against the entity that actually owns the FK field
 * rather than the entity being pointed to.
 *
 * Returns null in mock-schema mode, on network error, or when schemaName is absent.
 */
export async function getRelationshipBySchema(
  schemaName: string
): Promise<DataverseRelationship | null> {
  if (MOCK_SCHEMA || !DATAVERSE_URL || !schemaName) return null;
  if (cache.has(schemaName)) return cache.get(schemaName)!;

  try {
    const token = await getAccessToken();
    const url =
      `${DATAVERSE_URL}/api/data/v9.2/RelationshipDefinitions(SchemaName='${schemaName}')` +
      `?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) { cache.set(schemaName, null); return null; }
    const d = await res.json() as {
      SchemaName: string;
      ReferencingEntity: string;
      ReferencingAttribute: string;
      ReferencedEntity: string;
      ReferencedAttribute: string;
    };
    const rel: DataverseRelationship = {
      schemaName:           d.SchemaName,
      // Type is not critical for resolution; referencingEntity always owns the FK
      type:                 "OneToMany",
      referencingEntity:    d.ReferencingEntity,
      referencingAttribute: d.ReferencingAttribute,
      referencedEntity:     d.ReferencedEntity,
      referencedAttribute:  d.ReferencedAttribute,
    };
    cache.set(schemaName, rel);
    return rel;
  } catch {
    cache.set(schemaName, null);
    return null;
  }
}

/**
 * Pre-fetches relationship metadata for every hop in a chain (in parallel)
 * and returns a schemaName → relationship map.  Callers pass this to the
 * resolver so it can resolve queryTable/filterFK without per-hop fetches.
 */
export async function buildHopRelMap(
  hops: { relationshipSchemaName: string }[]
): Promise<Record<string, DataverseRelationship | null>> {
  const entries = await Promise.all(
    hops.map(async (h) =>
      [h.relationshipSchemaName, await getRelationshipBySchema(h.relationshipSchemaName)] as const
    )
  );
  return Object.fromEntries(entries);
}
