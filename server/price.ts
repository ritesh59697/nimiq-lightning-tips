/**
 * Live BTC price in the supporter's currency, so sats can be shown with a
 * familiar value next to them. Read from a public rates API (configurable via
 * PRICE_API_URL) and cached briefly at the edge so visitors share one lookup.
 */

import { cachedJson } from './lnbits.js'

const DEFAULT_PRICE_API_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC'
const CACHE_SECONDS = 60
const CURRENCY_CODE = /^[A-Z]{3}$/

export async function getPrice(request: Request): Promise<Response> {
  const fiat = (new URL(request.url).searchParams.get('fiat') ?? '').toUpperCase()
  if (!CURRENCY_CODE.test(fiat)) {
    return new Response('fiat must be a three-letter currency code.', { status: 400 })
  }

  const source = process.env.PRICE_API_URL?.trim() || DEFAULT_PRICE_API_URL
  try {
    const response = await fetch(source)
    if (!response.ok) {
      console.error('[price] rates source returned', response.status)
      return new Response('Price source unavailable.', { status: 502 })
    }
    const data = (await response.json()) as { data?: { rates?: Record<string, unknown> } }
    const btcPrice = Number(data.data?.rates?.[fiat])
    if (!Number.isFinite(btcPrice) || btcPrice <= 0) {
      return new Response('No rate for that currency.', { status: 404 })
    }
    return cachedJson({ fiat, btcPrice }, CACHE_SECONDS)
  } catch (error) {
    console.error('[price] request failed', error)
    return new Response('Price source unavailable.', { status: 502 })
  }
}
