/**
 * Reports whether a Lightning invoice has actually settled.
 *
 * This is the authoritative check. A resolved `payLightningInvoice` call only
 * means the spending transaction was submitted, so the UI must not claim
 * success until this endpoint reports `paid: true`.
 */

function readEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value.trim().replace(/\/+$/, '')
}

export async function GET(request: Request): Promise<Response> {
  let lnbitsUrl: string
  let invoiceKey: string
  try {
    lnbitsUrl = readEnv('LNBITS_URL')
    invoiceKey = readEnv('LNBITS_INVOICE_KEY')
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
    const lnbitsResponse = await fetch(
      `${lnbitsUrl}/api/v1/payments/${encodeURIComponent(hash)}`,
      { headers: { 'X-Api-Key': invoiceKey } },
    )

    // A 404 is a definite answer, not a failure to read: LNbits says the
    // invoice does not exist. Report it as unpaid-and-known so the client
    // does not fall into the "status unconfirmed" branch.
    if (lnbitsResponse.status === 404) {
      return Response.json(
        { paid: false, known: true },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    if (!lnbitsResponse.ok) {
      console.error('[status] LNbits lookup failed', lnbitsResponse.status)
      return new Response('Could not read the payment status.', { status: 502 })
    }

    const data = (await lnbitsResponse.json()) as Record<string, unknown>

    // `paid` is the only field LNbits sets consistently across settled,
    // failed and pending responses. `details.status` is present only for
    // failed payments and for wallet owners on a successful refresh, so it
    // is not safe to treat its absence as "unpaid" or its presence as truth.
    const paid = data.paid === true

    return Response.json(
      { paid, known: true },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    console.error('[status] request failed', error)
    return new Response('Could not reach the Lightning backend.', { status: 502 })
  }
}
