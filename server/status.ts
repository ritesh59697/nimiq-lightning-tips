/**
 * Reports whether a Lightning invoice has actually settled.
 *
 * This is the authoritative check. A resolved `payLightningInvoice` call only
 * means the spending transaction was submitted, so the UI must not claim
 * success until this endpoint reports `paid: true`.
 */

import { json, readConfig } from './lnbits'

export async function checkStatus(request: Request): Promise<Response> {
  let config
  try {
    config = readConfig()
  } catch (error) {
    console.error('[status] configuration error', error)
    return new Response('Lightning backend is not configured.', { status: 500 })
  }

  const hash = new URL(request.url).searchParams.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return new Response('A 64-character hex payment hash is required.', {
      status: 400,
    })
  }

  try {
    const response = await fetch(
      `${config.url}/api/v1/payments/${encodeURIComponent(hash)}`,
      { headers: { 'X-Api-Key': config.invoiceKey } },
    )

    // A 404 is a definite answer, not a failure to read: LNbits says the
    // invoice does not exist. Report it as unpaid-and-known so the client
    // does not fall into the "status unconfirmed" branch.
    if (response.status === 404) {
      return json({ paid: false, known: true })
    }

    if (!response.ok) {
      console.error('[status] LNbits lookup failed', response.status)
      return new Response('Could not read the payment status.', { status: 502 })
    }

    const data = (await response.json()) as Record<string, unknown>

    // `paid` is the only field LNbits sets consistently across settled,
    // failed and pending responses. `details.status` is present only for
    // failed payments and for wallet owners on a successful refresh, so it
    // is not safe to treat its absence as "unpaid" or its presence as truth.
    return json({ paid: data.paid === true, known: true })
  } catch (error) {
    console.error('[status] request failed', error)
    return new Response('Could not reach the Lightning backend.', { status: 502 })
  }
}
