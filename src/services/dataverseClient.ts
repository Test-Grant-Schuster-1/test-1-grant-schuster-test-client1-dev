import { DataverseClient } from "../shared/dataverse";
import { getAccessToken } from "../auth/tokenProvider.js";

const DATAVERSE_URL = import.meta.env.VITE_DATAVERSE_URL as string | undefined;
const MOCK_SCHEMA = import.meta.env.VITE_MOCK_SCHEMA === "true";

export const dataverseClient: DataverseClient | null =
  MOCK_SCHEMA || !DATAVERSE_URL
    ? null
    : new DataverseClient({ baseUrl: DATAVERSE_URL, getAccessToken });
