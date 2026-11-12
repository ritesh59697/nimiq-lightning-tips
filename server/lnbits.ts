/**
 * Shared LNbits access.
 *
 * Only the invoice (read) key is ever used: it can create invoices and read
 * their status, but cannot send payments. It stays in the function
 * environment and never reaches the client bundle.
 */

export interface LnbitsConfig {
  url: string
  invoiceKey: string
}

export function readConfig(): LnbitsConfig {
  const url = process.env.LNBITS_URL?.trim().replace(/\/+$/, '')
  const invoiceKey = process.env.LNBITS_INVOICE_KEY?.trim()

  if (!url || !invoiceKey) {
    throw new Error(
      'Missing LNBITS_URL or LNBITS_INVOICE_KEY in the function environment.',
    )
  }
  return { url, invoiceKey }
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...init?.headers,
    },
  })
}

export interface TipLimits {
  minSats: number
  maxSats: number
  messageMaxChars: number
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * Server-side bounds on what a supporter can request. The client applies the
 * same limits for feedback, but this is the authority. Defaults apply only
 * when the environment does not set them.
 */
export function readLimits(): TipLimits {
  return {
    minSats: positiveInt(process.env.TIP_MIN_SATS, 1_000),
    maxSats: positiveInt(process.env.TIP_MAX_SATS, 100_000),
    messageMaxChars: positiveInt(process.env.TIP_MESSAGE_MAX_CHARS, 140),
  }
}

/** Short-lived public caching for data that is the same for every visitor. */
export function cachedJson(body: unknown, seconds: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
    },
  })
}
