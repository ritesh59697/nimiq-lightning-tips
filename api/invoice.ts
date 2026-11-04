/**
 * Creates a fixed-amount BOLT11 invoice via LNbits.
 *
 * Nimiq Pay only accepts fixed-amount invoices, so the amount is always set
 * server-side. The LNbits invoice key stays in the function environment and
 * never reaches the client bundle.
 */

interface InvoiceRequestBody {
  amountSats?: unknown
}

function readEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value.trim().replace(/\/+$/, '')
}

export async function POST(request: Request): Promise<Response> {
  let lnbitsUrl: string
  let invoiceKey: string
  try {
    lnbitsUrl = readEnv('LNBITS_URL')
    invoiceKey = readEnv('LNBITS_INVOICE_KEY')
  } catch (error) {
    console.error('[invoice] configuration error', error)
    return new Response('Lightning backend is not configured.', { status: 500 })
  }

  let body: InvoiceRequestBody
  try {
    body = (await request.json()) as InvoiceRequestBody
  } catch {
    return new Response('Expected a JSON body.', { status: 400 })
  }

  const amountSats = Number(body.amountSats)
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return new Response('amountSats must be a positive integer.', { status: 400 })
  }

  try {
    const lnbitsResponse = await fetch(`${lnbitsUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Api-Key': invoiceKey,
      },
      body: JSON.stringify({
        out: false,
        amount: amountSats,
        memo: 'Lightning tip',
        unit: 'sat',
      }),
    })

    if (!lnbitsResponse.ok) {
      const detail = await lnbitsResponse.text().catch(() => '')
      console.error('[invoice] LNbits rejected request', lnbitsResponse.status, detail)
      return new Response('The Lightning backend rejected the request.', {
        status: 502,
      })
    }

    const data = (await lnbitsResponse.json()) as Record<string, unknown>

    // LNbits has shipped several field spellings across versions; accept the
    // known ones rather than pinning to one release.
    const paymentHash = data.payment_hash ?? data.checking_id
    const paymentRequest = data.payment_request ?? data.bolt11

    if (typeof paymentHash !== 'string' || typeof paymentRequest !== 'string') {
      console.error('[invoice] unexpected LNbits payload shape', Object.keys(data))
      return new Response('The Lightning backend returned an unexpected response.', {
        status: 502,
      })
    }

    return Response.json({ paymentHash, paymentRequest, amountSats })
  } catch (error) {
    console.error('[invoice] request failed', error)
    return new Response('Could not reach the Lightning backend.', { status: 502 })
  }
}
