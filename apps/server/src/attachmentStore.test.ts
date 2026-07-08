// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
  resolveThreadAttachmentImport,
  sanitizeAttachmentDisplayName,
  sanitizeAttachmentImportFileName,
} from "./attachmentStore.ts";

describe("attachmentStore", () => {
  it("sanitizes thread ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("thread.folder/unsafe space");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }

    const threadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    expect(threadSegment).toBeTruthy();
    expect(threadSegment).toMatch(/^[a-z0-9_-]+$/i);
    expect(threadSegment).not.toContain(".");
    expect(threadSegment).not.toContain("%");
    expect(threadSegment).not.toContain("/");
  });

  it("parses exact thread segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseThreadSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseThreadSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("normalizes created thread segments to lowercase", () => {
    const attachmentId = createAttachmentId("Thread.Foo");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }
    expect(parseThreadSegmentFromAttachmentId(attachmentId)).toBe("thread-foo");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-attachment-store-"));
    try {
      const attachmentId = "thread-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId,
      });
      expect(resolved).toBe(pngPath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("returns null when no attachment file exists for the id", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-attachment-store-"));
    try {
      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId: "thread-1-missing",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("sanitizes imported attachment file names", () => {
    expect(sanitizeAttachmentImportFileName("..\\danger log.txt")).toBe("danger_log.txt");
    expect(sanitizeAttachmentImportFileName("../../.env")).toBe("env");
    expect(sanitizeAttachmentImportFileName("  日志 文件.log  ")).toBe("log");
    expect(sanitizeAttachmentImportFileName("")).toBe("attachment");
  });

  it("keeps safe unicode attachment display names", () => {
    expect(sanitizeAttachmentDisplayName("..\\崩溃 日志.log")).toBe("崩溃 日志.log");
    expect(sanitizeAttachmentDisplayName("../../.env")).toBe("env");
    expect(sanitizeAttachmentDisplayName("bad\u0000/name?.log")).toBe("name_.log");
    expect(sanitizeAttachmentDisplayName("")).toBe("attachment");
  });

  it("resolves imported attachment paths inside the thread workspace", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-attachment-import-"));
    try {
      const resolved = resolveThreadAttachmentImport({
        conversationWorkspaceDir: baseDir,
        threadId: "thread-1",
        attachment: {
          type: "file",
          id: "thread-1-11111111-1111-4111-8111-111111111111",
          name: "../unsafe app.log",
          mimeType: "text/plain",
          sizeBytes: 12,
        },
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.workspaceRoot).toBe(path.resolve(path.join(baseDir, "thread-1")));
      expect(resolved?.relativePath).toBe(
        "files-mentioned-by-the-user/thread-1-11111111-1111-4111-8111-111111111111/unsafe_app.log",
      );
      expect(resolved?.path.startsWith(`${resolved.workspaceRoot}${path.sep}`)).toBe(true);
      expect(resolved?.path.includes(`${path.sep}.t3code${path.sep}`)).toBe(false);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
