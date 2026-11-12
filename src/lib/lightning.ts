/**
 * Lightning tip flow.
 *
 * Nimiq Pay resolves `payLightningInvoice` once the *spending* transaction
 * (NIM or USDT on Polygon) has been submitted and the atomic swap started.
 * That is NOT proof the creator received BTC, so settlement is always
 * confirmed against the Lightning backend before we show success.
 */

import { NimiqProviderError, type NimiqProvider } from '@nimiq/mini-app-sdk'

export interface Invoice {
  paymentHash: string
  paymentRequest: string
  amountSats: number
}

export type TipStage =
  | { status: 'idle' }
  | { status: 'creating-invoice' }
  | { status: 'awaiting-approval'; invoice: Invoice }
  | { status: 'confirming'; invoice: Invoice; swapId: string; txHash: string }
  | { status: 'settled'; invoice: Invoice; swapId: string; txHash: string }
  | { status: 'indeterminate'; invoice: Invoice; detail: string }
  | { status: 'failed'; reason: string; recoverable: boolean }

/** Error types Nimiq Pay raises that we handle explicitly. */
const ERROR_COPY: Record<string, { message: string; recoverable: boolean }> = {
  PERMISSION_DENIED: {
    message: 'Payment cancelled. Nothing was sent.',
    recoverable: true,
  },
  DUPLICATE_PAYMENT: {
    message:
      'This invoice was already paid from this wallet. Check the creator before trying again — paying twice would send a second tip.',
    recoverable: false,
  },
  TRANSACTION_OUTCOME_UNKNOWN: {
    message:
      'Nimiq Pay could not confirm whether the payment went through. Do not retry — check the status below first.',
    recoverable: false,
  },
  INVALID_TRANSACTION: {
    message: 'The invoice was rejected as invalid. It may have expired.',
    recoverable: true,
  },
  INVALID_REQUEST: {
    message: 'The invoice was rejected as invalid. It may have expired.',
    recoverable: true,
  },
  // Nimiq Pay also raises this when the swap cannot be prepared, e.g. an empty
  // or too-small balance, so the copy must not claim a connectivity problem.
  NETWORK_ERROR: {
    message:
      'Nimiq Pay could not prepare the payment. Check you have enough NIM or USDT to cover the tip and fees, then try again. Your funds were not moved.',
    recoverable: true,
  },
  UNKNOWN_REQUEST: {
    message:
      'This version of Nimiq Pay does not support Lightning payments. Please update the app.',
    recoverable: false,
  },
  INTERNAL_ERROR: {
    message: 'Nimiq Pay hit an internal error. Your funds were not moved.',
    recoverable: true,
  },
}

/**
 * `TRANSACTION_OUTCOME_UNKNOWN` and `DUPLICATE_PAYMENT` may carry the hash and
 * swapId of the earlier attempt, but only for the same Mini App and wallet.
 */
function extractPriorAttempt(data: unknown): { hash?: string; swapId?: string } {
  if (!data || typeof data !== 'object') return {}
  const { hash, swapId } = data as Record<string, unknown>
  return {
    hash: typeof hash === 'string' ? hash : undefined,
    swapId: typeof swapId === 'string' ? swapId : undefined,
  }
}

/** Nimiq Pay's own wording, appended so a supporter sees the real cause. */
function withWalletReason(message: string, error: NimiqProviderError): string {
  const reason = error.message?.trim()
  // A cancellation needs no explanation beyond our own copy.
  if (error.type === 'PERMISSION_DENIED') return message
  if (!reason || reason === error.type || message.includes(reason)) return message
  const MAX_REASON_LENGTH = 160
  const clipped =
    reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason
  return `${message} Nimiq Pay said: "${clipped}"`
}

export function describeError(error: unknown): {
  type: string
  message: string
  recoverable: boolean
  priorAttempt: { hash?: string; swapId?: string }
} {
  const providerError = NimiqProviderError.is(error)
    ? error
    : NimiqProviderError.from(error)

  if (providerError) {
    const known = ERROR_COPY[providerError.type]
    const copy = known ?? {
      message: providerError.message || 'The payment could not be completed.',
      // Unrecognised failures are treated as unsafe to retry: we cannot prove
      // no money moved, and a wrong retry sends a second real tip.
      recoverable: false,
    }
    return {
      type: providerError.type,
      message: known ? withWalletReason(copy.message, providerError) : copy.message,
      recoverable: copy.recoverable,
      priorAttempt: extractPriorAttempt(providerError.data),
    }
  }

  return {
    type: 'UNEXPECTED',
    message: error instanceof Error ? error.message : 'Something went wrong.',
    recoverable: false,
    priorAttempt: {},
  }
}

export async function createInvoice(amountSats: number, message = ''): Promise<Invoice> {
  const trimmed = message.trim()
  const response = await fetch('/api/invoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trimmed ? { amountSats, message: trimmed } : { amountSats }),
  })

  // A 500 here means the deployment has no Lightning backend configured yet.
  // Say so plainly rather than showing the raw server message to a supporter.
  if (response.status === 500) {
    throw new Error(
      'Tips are not switched on yet — this app still needs its Lightning backend connected.',
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Could not create a Lightning invoice${detail ? `: ${detail}` : '.'}`,
    )
  }

  const data = (await response.json()) as Partial<Invoice>
  if (!data.paymentHash || !data.paymentRequest) {
    throw new Error('The Lightning backend returned an incomplete invoice.')
  }

  return {
    paymentHash: data.paymentHash,
    paymentRequest: data.paymentRequest,
    amountSats,
  }
}

export interface SettlementResult {
  settled: boolean
  /** True when the backend could not be reached, as opposed to "not yet paid". */
  indeterminate: boolean
}

export async function checkSettlement(paymentHash: string): Promise<SettlementResult> {
  try {
    const response = await fetch(
      `/api/status?hash=${encodeURIComponent(paymentHash)}`,
    )
    if (!response.ok) return { settled: false, indeterminate: true }
    const data = (await response.json()) as { paid?: boolean; known?: boolean }
    // `known` marks a definite answer from the backend — including a 404,
    // which means the invoice does not exist rather than that the lookup
    // failed. Without it we cannot tell "not paid" from "could not check".
    return {
      settled: data.paid === true,
      indeterminate: data.known !== true,
    }
  } catch {
    return { settled: false, indeterminate: true }
  }
}

/**
 * Poll the backend until the invoice settles or we run out of patience.
 * Lightning settles in seconds, but an atomic swap adds a leg, so we allow
 * a generous window before declaring the outcome indeterminate.
 */
export async function awaitSettlement(
  paymentHash: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<SettlementResult> {
  const timeoutMs = options.timeoutMs ?? 90_000
  const intervalMs = options.intervalMs ?? 2_000
  const deadline = Date.now() + timeoutMs
  let sawBackendFailure = false

  while (Date.now() < deadline) {
    if (options.signal?.aborted) return { settled: false, indeterminate: true }

    const result = await checkSettlement(paymentHash)
    if (result.settled) return { settled: true, indeterminate: false }
    if (result.indeterminate) sawBackendFailure = true

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  // Timing out without ever reaching the backend is different from timing out
  // on an invoice the backend consistently reported as unpaid.
  return { settled: false, indeterminate: sawBackendFailure }
}

export async function payInvoice(
  nimiq: NimiqProvider,
  invoice: Invoice,
): Promise<{ txHash: string; swapId: string }> {
  const result = await nimiq.payLightningInvoice({ invoice: invoice.paymentRequest })
  return { txHash: result.hash, swapId: result.swapId }
}

/** BTC price in the given currency, or null when it cannot be read. */
export async function fetchBtcPrice(fiat: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/price?fiat=${encodeURIComponent(fiat)}`)
    if (!response.ok) return null
    const data = (await response.json()) as { btcPrice?: unknown }
    const price = Number(data.btcPrice)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

/** Number of tips that have settled in the creator's wallet, or null. */
export async function fetchTipCount(): Promise<number | null> {
  try {
    const response = await fetch('/api/stats')
    if (!response.ok) return null
    const data = (await response.json()) as { tips?: unknown }
    const tips = Number(data.tips)
    return Number.isInteger(tips) && tips >= 0 ? tips : null
  } catch {
    return null
  }
}
