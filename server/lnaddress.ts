/**
 * Lightning address backend (LNURL-pay, LUD-06/16, with LUD-21 verify).
 *
 * The creator configures only a public Lightning address, e.g. name@blink.sv.
 * No API key is stored anywhere. Each tip asks the address's wallet for a
 * fresh fixed-amount invoice, and settlement is read from the LUD-21 `verify`
 * URL that the wallet returns with it. Wallets without LUD-21 are rejected,
 * because without it the app could not confirm that a tip actually arrived.
 *
 * The settlement reference handed to the client is the verify URL itself,
 * base64url-encoded, so the server stays stateless. Before fetching one, the
 * server checks it points at the configured wallet's own host, so the status
 * endpoint cannot be used to make requests anywhere else.
 */

const ADDRESS_PATTERN = /^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i
const METADATA_TTL_MS = 5 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 10_000
const MSATS_PER_SAT = 1_000

export interface LightningAddress {
  user: string
  host: string
}

interface PayMetadata {
  callback: URL
  minSendableMsat: number
  maxSendableMsat: number
  commentAllowed: number
}

/** Returns the configured address, or null when this backend is not in use. */
export function readLightningAddress(): LightningAddress | null {
  const raw = process.env.LIGHTNING_ADDRESS?.trim()
  if (!raw) return null
  const match = ADDRESS_PATTERN.exec(raw)
  if (!match) {
    throw new Error('LIGHTNING_ADDRESS must look like name@wallet.example.')
  }
  return { user: match[1], host: match[2].toLowerCase() }
}

async function getJson(url: URL): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url.hostname} returned ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

let cachedMetadata: { key: string; value: PayMetadata; expires: number } | null = null

async function getPayMetadata(address: LightningAddress): Promise<PayMetadata> {
  const key = `${address.user}@${address.host}`
  if (cachedMetadata && cachedMetadata.key === key && cachedMetadata.expires > Date.now()) {
    return cachedMetadata.value
  }

  const data = await getJson(
    new URL(`https://${address.host}/.well-known/lnurlp/${encodeURIComponent(address.user)}`),
  )
  if (data.tag !== 'payRequest' || typeof data.callback !== 'string') {
    throw new Error('The Lightning address did not return a pay request.')
  }
  const callback = new URL(data.callback)
  if (callback.protocol !== 'https:') {
    throw new Error('The Lightning address callback is not HTTPS.')
  }

  const value: PayMetadata = {
    callback,
    minSendableMsat: Number(data.minSendable) || 0,
    maxSendableMsat: Number(data.maxSendable) || Number.MAX_SAFE_INTEGER,
    commentAllowed: Math.max(0, Math.floor(Number(data.commentAllowed) || 0)),
  }
  cachedMetadata = { key, value, expires: Date.now() + METADATA_TTL_MS }
  return value
}

export class AddressBackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function createAddressInvoice(
  address: LightningAddress,
  amountSats: number,
  message: string,
): Promise<{ paymentHash: string; paymentRequest: string }> {
  const metadata = await getPayMetadata(address)
  const amountMsat = amountSats * MSATS_PER_SAT
  if (amountMsat < metadata.minSendableMsat || amountMsat > metadata.maxSendableMsat) {
    throw new AddressBackendError(
      `This wallet accepts tips between ${Math.ceil(metadata.minSendableMsat / MSATS_PER_SAT)} and ${Math.floor(metadata.maxSendableMsat / MSATS_PER_SAT)} sats.`,
      400,
    )
  }

  const url = new URL(metadata.callback)
  url.searchParams.set('amount', String(amountMsat))
  // LUD-12: only send a comment the wallet says it accepts, trimmed to its limit.
  if (message && metadata.commentAllowed > 0) {
    url.searchParams.set('comment', [...message].slice(0, metadata.commentAllowed).join(''))
  }

  const data = await getJson(url)
  if (data.status === 'ERROR') {
    throw new AddressBackendError(
      typeof data.reason === 'string' ? data.reason : 'The wallet refused the request.',
      502,
    )
  }
  if (typeof data.pr !== 'string' || !data.pr) {
    throw new Error('The wallet returned no invoice.')
  }
  if (typeof data.verify !== 'string' || !data.verify) {
    throw new Error(
      'This wallet does not support LUD-21 payment verification, so tips could not be confirmed. Use a Lightning address from a wallet that does (for example Blink, Coinos or Alby).',
    )
  }

  return {
    paymentHash: Buffer.from(data.verify, 'utf8').toString('base64url'),
    paymentRequest: data.pr,
  }
}

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{16,2048}$/

/** True when the client-supplied value has the shape of a verify reference. */
export function isAddressReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value)
}

/**
 * Reads LUD-21 settlement for a reference produced by createAddressInvoice.
 * Returns null when the reference does not point at the configured wallet.
 */
export async function checkAddressSettlement(
  address: LightningAddress,
  reference: string,
): Promise<{ paid: boolean; known: boolean } | null> {
  let verify: URL
  try {
    verify = new URL(Buffer.from(reference, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const metadata = await getPayMetadata(address)
  const allowedHosts = new Set([address.host, metadata.callback.hostname])
  if (verify.protocol !== 'https:' || !allowedHosts.has(verify.hostname)) {
    return null
  }

  const data = await getJson(verify)
  if (data.status === 'ERROR') {
    // The wallet answered, but does not know this invoice: a definite "unpaid".
    return { paid: false, known: true }
  }
  return { paid: data.settled === true, known: data.status === 'OK' }
}
