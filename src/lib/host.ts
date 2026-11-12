/**
 * Nimiq Pay host context.
 *
 * Language, fiat and network are seeded synchronously before the Mini App's
 * page script runs, so they are safe to read during module init.
 */

import { getHostFiat, getHostLanguage, getHostNetwork } from '@nimiq/mini-app-sdk'

export const hostLanguage = getHostLanguage()
export const hostFiat = getHostFiat()
export const hostNetwork = getHostNetwork()

/** A Mini App only has a Nimiq provider when it runs inside Nimiq Pay. */
export const insideNimiqPay = typeof window !== 'undefined' && Boolean(window.nimiqPay)

/**
 * Lightning payments are mainnet-only — Nimiq Pay fails them on testnet with
 * "Cannot create swap". Surface that up front rather than at approval time.
 */
export const lightningAvailable = hostNetwork !== 'testnet'

export function formatSats(sats: number): string {
  return new Intl.NumberFormat(hostLanguage ?? undefined).format(sats)
}

/**
 * Secure-context APIs are unavailable over a plain-HTTP local network URL,
 * which is exactly how mini apps are tested during development.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const SATS_PER_BTC = 100_000_000

/** Fiat value of an amount of sats, formatted for the host's language. */
export function formatFiat(sats: number, btcPrice: number, currency: string): string {
  const value = (sats / SATS_PER_BTC) * btcPrice
  return new Intl.NumberFormat(hostLanguage ?? undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: value < 1 ? 2 : value < 100 ? 2 : 0,
  }).format(value)
}
