export interface CommercialGatewayModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly applyPatchToolType?: string;
  readonly codexCompatibility: CommercialGatewayCodexCompatibility;
}

export interface CommercialGatewayCodexCompatibility {
  readonly hasCodexModelInfoFields: boolean;
  readonly missingNativeApplyPatchFields: ReadonlyArray<string>;
  readonly nativeApplyPatchReady: boolean;
}

export const COMMERCIAL_GATEWAY_CODEX_MODEL_INFO_REQUIRED_FIELDS = [
  "slug",
  "display_name",
  "shell_type",
  "visibility",
  "supported_in_api",
  "base_instructions",
  "truncation_policy",
  "supports_parallel_tool_calls",
  "apply_patch_tool_type",
] as const;

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

function hasField(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(record, key) && record[key] !== undefined && record[key] !== null;
}

function readApplyPatchToolType(record: Readonly<Record<string, unknown>>): string | undefined {
  return readTrimmedString(record, "apply_patch_tool_type") ?? undefined;
}

function readModelEntries(body: Readonly<Record<string, unknown>>): unknown[] | null {
  const data = body.data;
  if (Array.isArray(data)) return data;

  const models = body.models;
  if (Array.isArray(models)) return models;

  return null;
}

function codexCompatibility(
  record: Readonly<Record<string, unknown>>,
  applyPatchToolType: string | undefined,
): CommercialGatewayCodexCompatibility {
  const missingNativeApplyPatchFields = COMMERCIAL_GATEWAY_CODEX_MODEL_INFO_REQUIRED_FIELDS.filter(
    (field) => !hasField(record, field),
  );
  const hasCodexModelInfoFields =
    hasField(record, "slug") ||
    hasField(record, "display_name") ||
    hasField(record, "apply_patch_tool_type");

  return {
    hasCodexModelInfoFields,
    missingNativeApplyPatchFields,
    nativeApplyPatchReady:
      missingNativeApplyPatchFields.length === 0 && applyPatchToolType === "freeform",
  };
}

export function parseCommercialGatewayModelListResponse(
  body: unknown,
): ReadonlyArray<CommercialGatewayModelInfo> | null {
  if (typeof body !== "object" || body === null) return null;

  const entries = readModelEntries(body as Readonly<Record<string, unknown>>);
  if (!entries) return null;

  const seen = new Set<string>();
  const models: CommercialGatewayModelInfo[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Readonly<Record<string, unknown>>;
    const id = readTrimmedString(record, "id") ?? readTrimmedString(record, "slug");
    if (!id || seen.has(id)) continue;

    const applyPatchToolType = readApplyPatchToolType(record);
    const model: CommercialGatewayModelInfo = {
      id,
      name: readModelName(record, id),
      provider: readModelProvider(record),
      codexCompatibility: codexCompatibility(record, applyPatchToolType),
    };
    seen.add(id);
    if (applyPatchToolType) {
      models.push({ ...model, applyPatchToolType });
    } else {
      models.push(model);
    }
  }

  return models;
}
