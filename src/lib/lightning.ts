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
  NETWORK_ERROR: {
    message: 'Network problem reaching Nimiq Pay. Your funds were not moved.',
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
    const copy = ERROR_COPY[providerError.type] ?? {
      message: providerError.message || 'The payment could not be completed.',
      // Unrecognised failures are treated as unsafe to retry: we cannot prove
      // no money moved, and a wrong retry sends a second real tip.
      recoverable: false,
    }
    return {
      type: providerError.type,
      message: copy.message,
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

export async function createInvoice(amountSats: number): Promise<Invoice> {
  const response = await fetch('/api/invoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountSats }),
  })

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
    const data = (await response.json()) as { paid?: boolean }
    return { settled: data.paid === true, indeterminate: false }
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
