import type { EnvironmentId } from "@t3tools/contracts";

import type { ChatAttachment } from "./types";
import { readEnvironmentConnection } from "./environments/runtime";
import { readSavedEnvironmentBearerToken } from "./environments/runtime/catalog";

export async function uploadChatAttachment(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly file: File;
  readonly type: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}): Promise<ChatAttachment> {
  const connection = readEnvironmentConnection(input.environmentId);
  if (!connection) {
    throw new Error(`Environment connection not found for ${input.environmentId}.`);
  }

  const url = new URL("/attachments", connection.knownEnvironment.target.httpBaseUrl);
  url.searchParams.set("threadId", input.threadId);
  url.searchParams.set("type", input.type);
  url.searchParams.set("name", input.name);
  url.searchParams.set("mimeType", input.mimeType);
  url.searchParams.set("sizeBytes", String(input.sizeBytes));

  const headers: Record<string, string> = {
    "Content-Type": input.mimeType || "application/octet-stream",
  };
  if (connection.kind === "saved") {
    const bearerToken = await readSavedEnvironmentBearerToken(input.environmentId);
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
  }

  const response = await fetch(url, {
    method: "POST",
    body: input.file,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to persist attachment (${response.status}).`);
  }

  const payload = (await response.json()) as { readonly attachment?: ChatAttachment };
  if (!payload.attachment) {
    throw new Error("Attachment persistence response did not include attachment metadata.");
  }
  return payload.attachment;
}
