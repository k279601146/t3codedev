export const CHECKPOINT_GIT_ADD_ARGS = [
  "add",
  "-A",
  "--",
  ".",
  ":(exclude,glob)~$*",
  ":(exclude,glob)**/~$*",
] as const;
