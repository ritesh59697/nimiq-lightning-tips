/**
 * Creates a fixed-amount BOLT11 invoice via LNbits.
 *
 * Nimiq Pay only accepts fixed-amount invoices, so the amount is always set
 * server-side and never taken from a client-supplied invoice string.
 */

import { json, readConfig, readLimits } from './lnbits.js'

/** Control characters would corrupt the memo shown in the creator's wallet. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

export async function createInvoice(request: Request): Promise<Response> {
  // Validate the request before touching configuration, so a malformed
  // request is reported as a 400 rather than blamed on the backend.
  let body: { amountSats?: unknown; message?: unknown }
  try {
    body = (await request.json()) as { amountSats?: unknown; message?: unknown }
  } catch {
    return new Response('Expected a JSON body.', { status: 400 })
  }

  const limits = readLimits()
  const amountSats = Number(body.amountSats)
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return new Response('amountSats must be a positive integer.', { status: 400 })
  }
  if (amountSats < limits.minSats || amountSats > limits.maxSats) {
    return new Response(
      `amountSats must be between ${limits.minSats} and ${limits.maxSats}.`,
      { status: 400 },
    )
  }

  if (body.message !== undefined && typeof body.message !== 'string') {
    return new Response('message must be a string.', { status: 400 })
  }
  const message = (body.message ?? '').replace(CONTROL_CHARS, ' ').trim()
  if ([...message].length > limits.messageMaxChars) {
    return new Response(
      `message must be at most ${limits.messageMaxChars} characters.`,
      { status: 400 },
    )
  }

  let config
  try {
    config = readConfig()
  } catch (error) {
    console.error('[invoice] configuration error', error)
    return new Response('Lightning backend is not configured.', { status: 500 })
  }

  try {
    const response = await fetch(`${config.url}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Api-Key': config.invoiceKey,
      },
      body: JSON.stringify({
        out: false,
        amount: amountSats,
        memo: message ? `Lightning tip: ${message}` : 'Lightning tip',
        unit: 'sat',
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('[invoice] LNbits rejected request', response.status, detail)
      return new Response('The Lightning backend rejected the request.', {
        status: 502,
      })
    }

    const data = (await response.json()) as Record<string, unknown>

    // LNbits has shipped several field spellings across versions; accept the
    // known ones rather than pinning to one release.
    const paymentHash = data.payment_hash ?? data.checking_id
    const paymentRequest = data.payment_request ?? data.bolt11

    if (typeof paymentHash !== 'string' || typeof paymentRequest !== 'string') {
      console.error('[invoice] unexpected LNbits payload', Object.keys(data))
      return new Response('The Lightning backend returned an unexpected response.', {
        status: 502,
      })
    }

    return json({ paymentHash, paymentRequest, amountSats })
  } catch (error) {
    console.error('[invoice] request failed', error)
    return new Response('Could not reach the Lightning backend.', { status: 502 })
  }
}
