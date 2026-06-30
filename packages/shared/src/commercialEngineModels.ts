export interface CommercialGatewayModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
}

function readTrimmedString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readModelName(record: Readonly<Record<string, unknown>>, id: string): string {
  return readTrimmedString(record, "display_name") ?? readTrimmedString(record, "name") ?? id;
}

function readModelProvider(record: Readonly<Record<string, unknown>>): string {
  return readTrimmedString(record, "owned_by") ?? readTrimmedString(record, "provider") ?? "unknown";
}

export function parseCommercialGatewayModelListResponse(
  body: unknown,
): ReadonlyArray<CommercialGatewayModelInfo> | null {
  if (typeof body !== "object" || body === null) return null;

  const data = (body as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  const seen = new Set<string>();
  const models: CommercialGatewayModelInfo[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Readonly<Record<string, unknown>>;
    const id = readTrimmedString(record, "id");
    if (!id || seen.has(id)) continue;

    seen.add(id);
    models.push({
      id,
      name: readModelName(record, id),
      provider: readModelProvider(record),
    });
  }

  return models;
}
