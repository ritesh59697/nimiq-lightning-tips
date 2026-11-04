/**
 * Dev-only mock of the Lightning backend.
 *
 * Lets the full UI — invoice creation, pending, settlement, and the failure
 * branches — be exercised without an LNbits instance and without spending
 * real money. Enabled with VITE_MOCK_BACKEND=true; never active in a
 * production build.
 *
 * It intercepts fetch() for /api/* only. The Nimiq payment call is NOT
 * mocked: inside Nimiq Pay that still hits the real wallet, and outside it
 * the provider is simply absent.
 */

interface MockInvoice {
  paymentHash: string
  settlesAt: number
}

const SETTLE_DELAY_MS = 6_000

function hex(length: number): string {
  const chars = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

export function installMockBackend(): void {
  const invoices = new Map<string, MockInvoice>()
  const realFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    if (!url.startsWith('/api/')) return realFetch(input, init)

    if (url.startsWith('/api/invoice')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { amountSats?: number }
      const amountSats = Number(body.amountSats)
      if (!Number.isInteger(amountSats) || amountSats <= 0) {
        return new Response('amountSats must be a positive integer.', { status: 400 })
      }

      const paymentHash = hex(64)
      invoices.set(paymentHash, {
        paymentHash,
        settlesAt: Date.now() + SETTLE_DELAY_MS,
      })

      console.info(
        `[mock] invoice for ${amountSats} sats; settles in ${SETTLE_DELAY_MS / 1000}s`,
      )

      return Response.json({
        paymentHash,
        // Structurally invoice-shaped, but deliberately not payable. Nimiq Pay
        // would reject it — which is correct: the mock is for UI flow only.
        paymentRequest: `lnbcmock${amountSats}n1${hex(90)}`,
        amountSats,
      })
    }

    if (url.startsWith('/api/status')) {
      const hash = new URL(url, window.location.origin).searchParams.get('hash')
      const invoice = hash ? invoices.get(hash) : undefined

      if (!invoice) {
        // Mirrors the real backend's 404-to-known mapping.
        return Response.json({ paid: false, known: true })
      }

      const paid = Date.now() >= invoice.settlesAt
      return Response.json({ paid, known: true })
    }

    return realFetch(input, init)
  }

  console.info('[mock] Lightning backend active — no real payments are possible')
}
