import { cn } from "~/lib/utils";

export const composerPrimaryButtonClassName = (input?: { newThreadMode?: boolean }) =>
  cn(
    "flex size-8 shrink-0 items-center justify-center rounded-full border border-black/5 text-white shadow-sm transition-[background-color,transform,box-shadow] duration-150 disabled:pointer-events-none disabled:shadow-none disabled:opacity-100",
    input?.newThreadMode
      ? "enabled:cursor-pointer enabled:bg-neutral-600 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-700 disabled:bg-neutral-400 disabled:text-white dark:enabled:bg-neutral-300 dark:enabled:text-neutral-950 dark:enabled:hover:bg-neutral-100 dark:disabled:bg-neutral-600 dark:disabled:text-neutral-300"
      : "enabled:cursor-pointer enabled:bg-neutral-950 enabled:hover:scale-[1.03] enabled:hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-white/85 dark:enabled:bg-neutral-50 dark:enabled:text-neutral-950 dark:enabled:hover:bg-white dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400",
  );

export function ComposerSendArrowIcon({ size = 16 }: { size?: 14 | 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L4.25 7.25M8 3.5L11.75 7.25"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ComposerStopSquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.6" />
    </svg>
  );
}

export function ComposerSpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="20 12"
      />
    </svg>
  );
}
