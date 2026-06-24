import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_LIST_DIRECTORY_MAX_DEPTH = 8;
const PROJECT_READ_FILE_MAX_LENGTH = 512;
const PROJECT_NAME_MAX_LENGTH = 120;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  sizeBytes: Schema.Number,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ProjectDirectoryTreeNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children?: ReadonlyArray<ProjectDirectoryTreeNode>;
}

const ProjectDirectoryTreeNodeRef = Schema.suspend(
  (): Schema.Codec<ProjectDirectoryTreeNode> => ProjectDirectoryTreeNodeSchema,
);

export const ProjectDirectoryTreeNodeSchema = Schema.Struct({
  path: Schema.String,
  name: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  children: Schema.optionalKey(Schema.Array(ProjectDirectoryTreeNodeRef)),
});

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  depth: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_LIST_DIRECTORY_MAX_DEPTH)),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  tree: ProjectDirectoryTreeNodeSchema,
  truncated: Schema.Boolean,
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateBlankInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_NAME_MAX_LENGTH)),
});
export type ProjectCreateBlankInput = typeof ProjectCreateBlankInput.Type;

export const ProjectCreateBlankResult = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
});
export type ProjectCreateBlankResult = typeof ProjectCreateBlankResult.Type;

export class ProjectCreateBlankError extends Schema.TaggedErrorClass<ProjectCreateBlankError>()(
  "ProjectCreateBlankError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectEnsureDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectEnsureDirectoryInput = typeof ProjectEnsureDirectoryInput.Type;

export const ProjectEnsureDirectoryResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectEnsureDirectoryResult = typeof ProjectEnsureDirectoryResult.Type;

export class ProjectEnsureDirectoryError extends Schema.TaggedErrorClass<ProjectEnsureDirectoryError>()(
  "ProjectEnsureDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
