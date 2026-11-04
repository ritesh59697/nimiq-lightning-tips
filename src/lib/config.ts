/**
 * Public runtime config. Everything here is read from Vite env vars so that
 * nothing about a particular creator or backend is baked into the source.
 * Secrets (LNbits keys) live only in the serverless function environment.
 */

/**
 * VITE_* vars are inlined at build time, so a deployment built without them
 * would otherwise throw during module init and render a blank page. Presentation
 * values fall back to a sensible default and warn instead, so a misconfigured
 * deploy still shows a working app rather than nothing at all.
 */
function readEnv(name: string, value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  console.warn(`[config] ${name} is not set; falling back to "${fallback}".`)
  return fallback
}

const DEFAULT_PRESETS_SATS = [1_000, 5_000, 21_000]

function parsePresets(raw: string | undefined): number[] {
  const presets = (raw ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)

  if (presets.length === 0) {
    console.warn(
      '[config] VITE_TIP_PRESETS_SATS is unset or invalid; using defaults.',
    )
    return DEFAULT_PRESETS_SATS
  }
  return [...new Set(presets)].sort((a, b) => a - b)
}

export const creator = {
  name: readEnv('VITE_CREATOR_NAME', import.meta.env.VITE_CREATOR_NAME, 'This creator'),
  handle: (import.meta.env.VITE_CREATOR_HANDLE ?? '').trim(),
  blurb: (import.meta.env.VITE_CREATOR_BLURB ?? '').trim(),
  avatarUrl: (import.meta.env.VITE_CREATOR_AVATAR_URL ?? '').trim(),
} as const

export const tipPresetsSats = parsePresets(import.meta.env.VITE_TIP_PRESETS_SATS)

/** Optional Nimiq address used to record a public on-chain tip memo. */
export const memoRecipient = (import.meta.env.VITE_TIP_MEMO_RECIPIENT ?? '').trim() || null
