/**
 * Public count of tips that actually settled in the creator's wallet. It is
 * read straight from LNbits, so it only ever reflects real, paid invoices.
 * The invoice key cannot send, so every settled payment is an incoming tip.
 */

import { cachedJson, readConfig } from './lnbits.js'
import { readLightningAddress } from './lnaddress.js'

const CACHE_SECONDS = 60

export async function getStats(): Promise<Response> {
  // A Lightning address gives no read access to the wallet's history, so
  // there is nothing honest to count. The page simply hides the counter.
  try {
    if (readLightningAddress()) {
      return new Response('Tip count is not available for this wallet.', { status: 404 })
    }
  } catch {
    return new Response('Lightning backend is not configured.', { status: 500 })
  }

  let config
  try {
    config = readConfig()
  } catch (error) {
    console.error('[stats] configuration error', error)
    return new Response('Lightning backend is not configured.', { status: 500 })
  }

  try {
    const response = await fetch(
      `${config.url}/api/v1/payments/paginated?status=success&limit=1`,
      { headers: { 'X-Api-Key': config.invoiceKey } },
    )
    if (!response.ok) {
      console.error('[stats] LNbits returned', response.status)
      return new Response('Could not read tip stats.', { status: 502 })
    }
    const page = (await response.json()) as { total?: unknown }
    const tips = Number(page.total)
    if (!Number.isInteger(tips) || tips < 0) {
      return new Response('Unexpected stats response.', { status: 502 })
    }
    return cachedJson({ tips }, CACHE_SECONDS)
  } catch (error) {
    console.error('[stats] request failed', error)
    return new Response('Could not read tip stats.', { status: 502 })
  }
}
