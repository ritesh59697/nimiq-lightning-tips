/**
 * Shared LNbits access.
 *
 * Only the invoice (read) key is ever used: it can create invoices and read
 * their status, but cannot send payments. It stays in the function
 * environment and never reaches the client bundle.
 */

export interface LnbitsConfig {
  url: string
  invoiceKey: string
}

export function readConfig(): LnbitsConfig {
  const url = process.env.LNBITS_URL?.trim().replace(/\/+$/, '')
  const invoiceKey = process.env.LNBITS_INVOICE_KEY?.trim()

  if (!url || !invoiceKey) {
    throw new Error(
      'Missing LNBITS_URL or LNBITS_INVOICE_KEY in the function environment.',
    )
  }
  return { url, invoiceKey }
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...init?.headers,
    },
  })
}
