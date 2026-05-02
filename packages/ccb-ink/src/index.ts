/**
 * @anthropic/ink 鈥?Terminal React rendering framework
 *
 * Three-layer architecture:
 *   core/        鈥?Rendering engine (reconciler, layout, terminal I/O, screen buffer)
 *   components/  鈥?UI primitives (Box, Text, ScrollBox, App, hooks)
 *   theme/       鈥?Theme system (ThemeProvider, ThemedBox, ThemedText, design-system)
 */

// ============================================================
// Core API (render/createRoot)
// ============================================================
export {
  default as wrappedRender,
  renderSync,
  createRoot,
} from "./core/root.ts"
export type { RenderOptions, Instance, Root } from "./core/root.ts"
export * from "./theme/theme-types.ts"
// InkCore class
export { default as Ink } from "./core/ink.tsx"

// ============================================================
// Keybindings
// ============================================================
export { useKeybinding, useKeybindings } from "./keybindings/useKeybinding.ts"
export {
  KeybindingProvider,
  useKeybindingContext,
  useOptionalKeybindingContext,
  useRegisterKeybindingContext,
} from "./keybindings/KeybindingContext.tsx"
export {
  resolveKey,
  resolveKeyWithChordState,
  getBindingDisplayText,
  keystrokesEqual,
  type ResolveResult,
  type ChordResolveResult,
} from "./keybindings/resolver.ts"
export {
  parseKeystroke,
  parseChord,
  keystrokeToString,
  chordToString,
  keystrokeToDisplayString,
  chordToDisplayString,
  parseBindings,
} from "./keybindings/parser.ts"
export {
  getKeyName,
  matchesKeystroke,
  matchesBinding,
} from "./keybindings/match.ts"
export {
  KeybindingSetup,
  type KeybindingSetupProps,
} from "./keybindings/KeybindingSetup.tsx"
export type {
  ParsedBinding,
  ParsedKeystroke,
  KeybindingContextName,
  KeybindingBlock,
  Chord,
  KeybindingAction,
  KeybindingWarningType,
  KeybindingWarning,
  KeybindingsLoadResult,
} from "./keybindings/types.ts"

// ============================================================
// Core types
// ============================================================
export type {
  DOMElement,
  TextNode,
  ElementNames,
  DOMNodeAttribute,
} from "./core/dom.ts"
export type {
  Styles,
  TextStyles,
  Color,
  RGBColor,
  HexColor,
  Ansi256Color,
  AnsiColor,
} from "./core/styles.ts"
export type { Key } from "./core/events/input-event.ts"
export type { FlickerReason, FrameEvent } from "./core/frame.ts"
export type { MatchPosition } from "./core/render-to-screen.ts"
export type { SelectionState, FocusMove } from "./core/selection.ts"
export type { Progress } from "./core/terminal.ts"

// ============================================================
// Core modules
// ============================================================
export { ClickEvent } from "./core/events/click-event.ts"
export { EventEmitter } from "./core/events/emitter.ts"
export { Event } from "./core/events/event.ts"
export { InputEvent } from "./core/events/input-event.ts"
export {
  TerminalFocusEvent,
  type TerminalFocusEventType,
} from "./core/events/terminal-focus-event.ts"
export { KeyboardEvent } from "./core/events/keyboard-event.ts"
export { FocusEvent } from "./core/events/focus-event.ts"
export { FocusManager } from "./core/focus.ts"
export { Ansi } from "./core/Ansi.tsx"
export { stringWidth } from "./core/stringWidth.ts"
export { default as wrapText } from "./core/wrap-text.ts"
export { default as measureElement } from "./core/measure-element.ts"
export { supportsTabStatus } from "./core/termio/osc.ts"
export {
  setClipboard,
  getClipboardPath,
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TAB_STATUS,
  CLEAR_TERMINAL_TITLE,
  wrapForMultiplexer,
} from "./core/termio/osc.ts"
export {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
} from "./core/termio/csi.ts"
export {
  SHOW_CURSOR,
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  EXIT_ALT_SCREEN,
  HIDE_CURSOR,
  ENTER_ALT_SCREEN,
  ENABLE_MOUSE_TRACKING,
} from "./core/termio/dec.ts"
export { default as instances } from "./core/instances.ts"
export {
  default as renderBorder,
  type BorderTextOptions,
} from "./core/render-border.ts"
export {
  isSynchronizedOutputSupported,
  isXtermJs,
  hasCursorUpViewportYankBug,
  writeDiffToTerminal,
} from "./core/terminal.ts"
export {
  colorize,
  applyColor,
  applyTextStyles,
  type ColorType,
} from "./core/colorize.ts"
export { wrapAnsi } from "./core/wrapAnsi.ts"
export { default as styles } from "./core/styles.ts"
export { clamp } from "./core/layout/geometry.ts"
export {
  getTerminalFocusState,
  getTerminalFocused,
  subscribeTerminalFocus,
} from "./core/terminal-focus-state.ts"
export { supportsHyperlinks } from "./core/supports-hyperlinks.ts"

// ============================================================
// Components (Layer 2)
// ============================================================
export { default as BaseBox } from "./components/Box.tsx"
export type { Props as BaseBoxProps } from "./components/Box.tsx"
export { default as BaseText } from "./components/Text.tsx"
export type { Props as BaseTextProps } from "./components/Text.tsx"
export {
  default as Button,
  type ButtonState,
  type Props as ButtonProps,
} from "./components/Button.tsx"
export { default as Link } from "./components/Link.tsx"
export type { Props as LinkProps } from "./components/Link.tsx"
export { default as Newline } from "./components/Newline.tsx"
export type { Props as NewlineProps } from "./components/Newline.tsx"
export { default as Spacer } from "./components/Spacer.tsx"
export { NoSelect } from "./components/NoSelect.tsx"
export { RawAnsi } from "./components/RawAnsi.tsx"
export {
  default as ScrollBox,
  type ScrollBoxHandle,
} from "./components/ScrollBox.tsx"
export { AlternateScreen } from "./components/AlternateScreen.tsx"

// App types
export type { Props as AppProps } from "./components/AppContext.ts"
export type { Props as StdinProps } from "./components/StdinContext.ts"
export {
  TerminalSizeContext,
  type TerminalSize,
} from "./components/TerminalSizeContext.tsx"

// ============================================================
// Hooks
// ============================================================
export { default as useApp } from "./hooks/use-app.ts"
export { default as useInput } from "./hooks/use-input.ts"
export { useAnimationFrame } from "./hooks/use-animation-frame.ts"
export { useAnimationTimer, useInterval } from "./hooks/use-interval.ts"
export { useSelection, useHasSelection } from "./hooks/use-selection.ts"
export { default as useStdin } from "./hooks/use-stdin.ts"
export { useTerminalSize } from "./hooks/useTerminalSize.ts"
export { useTimeout } from "./hooks/useTimeout.ts"
export { useMinDisplayTime } from "./hooks/useMinDisplayTime.ts"
export {
  useDoublePress,
  DOUBLE_PRESS_TIMEOUT_MS,
} from "./hooks/useDoublePress.ts"
export { useTabStatus, type TabStatusKind } from "./hooks/use-tab-status.ts"
export { useTerminalFocus } from "./hooks/use-terminal-focus.ts"
export { useTerminalTitle } from "./hooks/use-terminal-title.ts"
export { useTerminalViewport } from "./hooks/use-terminal-viewport.ts"
export { useSearchHighlight } from "./hooks/use-search-highlight.ts"
export { useDeclaredCursor } from "./hooks/use-declared-cursor.ts"
export {
  TerminalWriteProvider,
  useTerminalNotification,
  type TerminalNotification,
} from "./hooks/useTerminalNotification.ts"

// ============================================================
// Theme (Layer 3)
// ============================================================
export {
  ThemeProvider,
  setThemeConfigCallbacks,
  usePreviewTheme,
  useTheme,
  useThemeSetting,
} from "./theme/ThemeProvider.tsx"
export { default as Box } from "./theme/ThemedBox.tsx"
export type { Props as BoxProps } from "./theme/ThemedBox.tsx"
export { default as Text, TextHoverColorContext } from "./theme/ThemedText.tsx"
export type { Props as TextProps } from "./theme/ThemedText.tsx"
export { color } from "./theme/color.ts"

// Theme sub-components
export { SearchBox } from "./theme/SearchBox.tsx"
export { Dialog } from "./theme/Dialog.tsx"
export { Divider } from "./theme/Divider.tsx"
export { FuzzyPicker } from "./theme/FuzzyPicker.tsx"
export { ListItem } from "./theme/ListItem.tsx"
export { LoadingState } from "./theme/LoadingState.tsx"
export { Pane } from "./theme/Pane.tsx"
export { ProgressBar } from "./theme/ProgressBar.tsx"
export { Ratchet } from "./theme/Ratchet.tsx"
export { StatusIcon } from "./theme/StatusIcon.tsx"
export { Tabs, Tab, useTabsWidth, useTabHeaderFocus } from "./theme/Tabs.tsx"
export { Byline } from "./theme/Byline.tsx"
export { KeyboardShortcutHint } from "./theme/KeyboardShortcutHint.tsx"
