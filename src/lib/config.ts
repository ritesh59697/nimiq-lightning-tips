/**
 * Public runtime config. Everything here is read from Vite env vars so that
 * nothing about a particular creator or backend is baked into the source.
 * Secrets (LNbits keys) live only in the serverless function environment.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value.trim()
}

function parsePresets(raw: string | undefined): number[] {
  const presets = (raw ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)

  if (presets.length === 0) {
    throw new Error(
      'VITE_TIP_PRESETS_SATS must list at least one positive integer amount in sats.',
    )
  }
  return [...new Set(presets)].sort((a, b) => a - b)
}

export const creator = {
  name: requireEnv('VITE_CREATOR_NAME', import.meta.env.VITE_CREATOR_NAME),
  handle: (import.meta.env.VITE_CREATOR_HANDLE ?? '').trim(),
  blurb: (import.meta.env.VITE_CREATOR_BLURB ?? '').trim(),
  avatarUrl: (import.meta.env.VITE_CREATOR_AVATAR_URL ?? '').trim(),
} as const

export const tipPresetsSats = parsePresets(import.meta.env.VITE_TIP_PRESETS_SATS)

/** Optional Nimiq address used to record a public on-chain tip memo. */
export const memoRecipient = (import.meta.env.VITE_TIP_MEMO_RECIPIENT ?? '').trim() || null
