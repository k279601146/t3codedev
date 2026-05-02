import { env } from "../utils/env.ts"

// The former is better vertically aligned, but isn't usually supported on Windows/Linux
export const BLACK_CIRCLE = env.platform === 'darwin' ? '‚è? : '‚ó?
export const BULLET_OPERATOR = '‚à?
export const TEARDROP_ASTERISK = '‚ú?
export const UP_ARROW = '\u2191' // ‚Ü?- used for opus 1m merge notice
export const DOWN_ARROW = '\u2193' // ‚Ü?- used for scroll hint
export const LIGHTNING_BOLT = '‚Ü? // \u21af - used for fast mode indicator
export const EFFORT_LOW = '‚ó? // \u25cb - effort level: low
export const EFFORT_MEDIUM = '‚ó? // \u25d0 - effort level: medium
export const EFFORT_HIGH = '‚ó? // \u25cf - effort level: high
export const EFFORT_XHIGH = '‚¶? // \u29bf - effort level: xhigh (Opus 4.7 only)
export const EFFORT_MAX = '‚ó? // \u25c9 - effort level: max (Opus 4.6/4.7 only)

// Media/trigger status indicators
export const PLAY_ICON = '\u25b6' // ‚ñ?
export const PAUSE_ICON = '\u23f8' // ‚è?

// MCP subscription indicators
export const REFRESH_ARROW = '\u21bb' // ‚Ü?- used for resource update indicator
export const CHANNEL_ARROW = '\u2190' // ‚Ü?- inbound channel message indicator
export const INJECTED_ARROW = '\u2192' // ‚Ü?- cross-session injected message indicator
export const FORK_GLYPH = '\u2442' // ‚ë?- fork directive indicator

// Review status indicators (ultrareview diamond states)
export const DIAMOND_OPEN = '\u25c7' // ‚ó?- running
export const DIAMOND_FILLED = '\u25c6' // ‚ó?- completed/failed
export const REFERENCE_MARK = '\u203b' // ‚Ä?- komejirushi, away-summary recap marker

// Issue flag indicator
export const FLAG_ICON = '\u2691' // ‚ö?- used for issue flag banner

// Blockquote indicator
export const BLOCKQUOTE_BAR = '\u258e' // ‚ñ?- left one-quarter block, used as blockquote line prefix
export const HEAVY_HORIZONTAL = '\u2501' // ‚î?- heavy box-drawing horizontal

// Bridge status indicators
export const BRIDGE_SPINNER_FRAMES = [
  '\u00b7|\u00b7',
  '\u00b7/\u00b7',
  '\u00b7\u2014\u00b7',
  '\u00b7\\\u00b7',
]
export const BRIDGE_READY_INDICATOR = '\u00b7\u2714\ufe0e\u00b7'
export const BRIDGE_FAILED_INDICATOR = '\u00d7'

