export function truncateTextForPreview(input: {
  text: string;
  maxChars: number;
  maxLines: number;
}): { text: string; truncated: boolean } {
  if (input.text.length <= input.maxChars) {
    const lineCount = input.text.split("\n").length;
    if (lineCount <= input.maxLines) {
      return { text: input.text, truncated: false };
    }
  }

  const lines = input.text.split("\n");
  let visibleChars = 0;
  const visibleLines: string[] = [];
  for (const line of lines) {
    if (visibleLines.length >= input.maxLines) {
      break;
    }
    const nextLength = visibleChars + line.length + (visibleLines.length > 0 ? 1 : 0);
    if (nextLength > input.maxChars) {
      const remaining = input.maxChars - visibleChars;
      if (remaining > 0) {
        visibleLines.push(line.slice(0, remaining));
      }
      break;
    }
    visibleLines.push(line);
    visibleChars = nextLength;
  }

  const text = visibleLines.join("\n").trimEnd();
  return { text, truncated: text.length < input.text.length };
}
