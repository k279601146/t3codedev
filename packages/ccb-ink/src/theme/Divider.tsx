import React from 'react';
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import { stringWidth } from "../core/stringWidth.ts";
import { Ansi, Text } from "../index.ts";
import type { Theme } from "./theme-types.ts";

type DividerProps = {
  /**
   * Width of the divider in characters.
   * Defaults to terminal width.
   */
  width?: number;

  /**
   * Theme color for the divider.
   * If not provided, dimColor is used.
   */
  color?: keyof Theme;

  /**
   * Character to use for the divider line.
   * @default '鈹€'
   */
  char?: string;

  /**
   * Padding to subtract from the width (e.g., for indentation).
   * @default 0
   */
  padding?: number;

  /**
   * Title shown in the middle of the divider.
   * May contain ANSI codes (e.g., chalk-styled text).
   *
   * @example
   * // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ Title 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
   * <Divider title="Title" />
   */
  title?: string;
};

/**
 * A horizontal divider line.
 *
 * @example
 * // Full-width dimmed divider
 * <Divider />
 *
 * @example
 * // Colored divider
 * <Divider color="suggestion" />
 *
 * @example
 * // Fixed width
 * <Divider width={40} />
 *
 * @example
 * // Full width minus padding (for indented content)
 * <Divider padding={4} />
 *
 * @example
 * // With centered title
 * <Divider title="3 new messages" />
 */
export function Divider({ width, color, char = '鈹€', padding = 0, title }: DividerProps): React.ReactNode {
  const { columns: terminalWidth } = useTerminalSize();
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding);

  if (title) {
    const titleWidth = stringWidth(title) + 2; // +2 for spaces around title
    const sideWidth = Math.max(0, effectiveWidth - titleWidth);
    const leftWidth = Math.floor(sideWidth / 2);
    const rightWidth = sideWidth - leftWidth;
    return (
      <Text color={color} dimColor={!color}>
        {char.repeat(leftWidth)}{' '}
        <Text dimColor>
          <Ansi>{title}</Ansi>
        </Text>{' '}
        {char.repeat(rightWidth)}
      </Text>
    );
  }

  return (
    <Text color={color} dimColor={!color}>
      {char.repeat(effectiveWidth)}
    </Text>
  );
}
