import { useCallback, useEffect, useRef, useState } from 'react'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { creator, tipPresetsSats } from './lib/config'
import {
  awaitSettlement,
  createInvoice,
  describeError,
  payInvoice,
  type TipStage,
} from './lib/lightning'
import { formatSats, insideNimiqPay, lightningAvailable } from './lib/host'
import './App.css'

type ProviderState =
  | { status: 'connecting' }
  | { status: 'ready'; nimiq: NimiqProvider }
  | { status: 'unavailable'; reason: string }

export default function App() {
  const [provider, setProvider] = useState<ProviderState>({ status: 'connecting' })
  const [stage, setStage] = useState<TipStage>({ status: 'idle' })
  const [selectedSats, setSelectedSats] = useState<number>(tipPresetsSats[0])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!insideNimiqPay) {
      setProvider({
        status: 'unavailable',
        reason: 'Open this page inside Nimiq Pay to send a tip.',
      })
      return
    }

    let cancelled = false
    init({ timeout: 10_000 })
      .then((nimiq) => {
        if (!cancelled) setProvider({ status: 'ready', nimiq })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setProvider({
          status: 'unavailable',
          reason:
            error instanceof Error
              ? error.message
              : 'Could not reach the Nimiq Pay wallet.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  const sendTip = useCallback(async () => {
    if (provider.status !== 'ready') return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStage({ status: 'creating-invoice' })

    let invoice
    try {
      invoice = await createInvoice(selectedSats)
    } catch (error) {
      setStage({
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Could not create an invoice.',
        recoverable: true,
      })
      return
    }

    setStage({ status: 'awaiting-approval', invoice })

    let payment
    try {
      payment = await payInvoice(provider.nimiq, invoice)
    } catch (error) {
      const described = describeError(error)

      // A duplicate or unknown-outcome error may mean money already moved.
      // Verify against the backend instead of inviting a second payment.
      if (
        described.type === 'DUPLICATE_PAYMENT' ||
        described.type === 'TRANSACTION_OUTCOME_UNKNOWN'
      ) {
        const settlement = await awaitSettlement(invoice.paymentHash, {
          timeoutMs: 20_000,
          signal: controller.signal,
        })
        if (settlement.settled) {
          setStage({
            status: 'settled',
            invoice,
            swapId: described.priorAttempt.swapId ?? 'unknown',
            txHash: described.priorAttempt.hash ?? 'unknown',
          })
          return
        }
        setStage({ status: 'indeterminate', invoice, detail: described.message })
        return
      }

      setStage({
        status: 'failed',
        reason: described.message,
        recoverable: described.recoverable,
      })
      return
    }

    setStage({ status: 'confirming', invoice, ...payment })

    const settlement = await awaitSettlement(invoice.paymentHash, {
      signal: controller.signal,
    })

    if (settlement.settled) {
      setStage({ status: 'settled', invoice, ...payment })
    } else {
      setStage({
        status: 'indeterminate',
        invoice,
        detail: settlement.indeterminate
          ? 'We could not reach the Lightning backend to confirm settlement.'
          : 'The payment was submitted but has not settled yet.',
      })
    }
  }, [provider, selectedSats])

  const busy =
    stage.status === 'creating-invoice' ||
    stage.status === 'awaiting-approval' ||
    stage.status === 'confirming'

  const disabled = provider.status !== 'ready' || busy || !lightningAvailable

  return (
    <main className="app">
      <header className="creator">
        {creator.avatarUrl ? (
          <img className="avatar" src={creator.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar--fallback" aria-hidden="true">
            {creator.name.slice(0, 1)}
          </div>
        )}
        <h1>{creator.name}</h1>
        {creator.handle ? <p className="handle">{creator.handle}</p> : null}
        {creator.blurb ? <p className="blurb">{creator.blurb}</p> : null}
      </header>

      {!lightningAvailable ? (
        <p className="notice notice--warn" role="status">
          Nimiq Pay is on testnet. Lightning tips need mainnet — switch networks to
          send one.
        </p>
      ) : null}

      {provider.status === 'unavailable' ? (
        <p className="notice" role="status">
          {provider.reason}
        </p>
      ) : null}

      <section className="amounts" aria-label="Tip amount">
        {tipPresetsSats.map((sats) => (
          <button
            key={sats}
            type="button"
            className={sats === selectedSats ? 'amount amount--active' : 'amount'}
            aria-pressed={sats === selectedSats}
            onClick={() => setSelectedSats(sats)}
            disabled={busy}
          >
            {formatSats(sats)} <span className="unit">sats</span>
          </button>
        ))}
      </section>

      <button type="button" className="pay" onClick={sendTip} disabled={disabled}>
        {stageLabel(stage, selectedSats)}
      </button>

      <StageDetail stage={stage} onReset={() => setStage({ status: 'idle' })} />

      <footer className="footer">
        <p>
          Paid in NIM or USDT from your Nimiq Pay balance and delivered over
          Bitcoin Lightning by a self-custodial atomic swap. Your keys never leave
          the wallet.
        </p>
      </footer>
    </main>
  )
}

function stageLabel(stage: TipStage, selectedSats: number): string {
  switch (stage.status) {
    case 'creating-invoice':
      return 'Preparing invoice…'
    case 'awaiting-approval':
      return 'Approve in Nimiq Pay…'
    case 'confirming':
      return 'Confirming settlement…'
    case 'settled':
      return 'Send another tip'
    default:
      return `Tip ${formatSats(selectedSats)} sats`
  }
}

function StageDetail({
  stage,
  onReset,
}: {
  stage: TipStage
  onReset: () => void
}) {
  if (stage.status === 'idle') return null

  if (stage.status === 'settled') {
    return (
      <div className="result result--ok" role="status">
        <h2>Tip delivered</h2>
        <p>
          {formatSats(stage.invoice.amountSats)} sats reached {creator.name}.
          Thank you.
        </p>
        <dl className="receipt">
          <dt>Swap</dt>
          <dd>{stage.swapId}</dd>
          <dt>Transaction</dt>
          <dd className="mono">{stage.txHash}</dd>
        </dl>
      </div>
    )
  }

  if (stage.status === 'indeterminate') {
    return (
      <div className="result result--warn" role="alert">
        <h2>Status unconfirmed</h2>
        <p>{stage.detail}</p>
        <p className="emphasis">
          Do not pay this invoice again — that would send a second tip. Check with
          the creator if it does not appear shortly.
        </p>
      </div>
    )
  }

  if (stage.status === 'failed') {
    return (
      <div className="result result--error" role="alert">
        <h2>Payment not completed</h2>
        <p>{stage.reason}</p>
        {stage.recoverable ? (
          <button type="button" className="retry" onClick={onReset}>
            Try again
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <p className="result result--pending" role="status">
      {stage.status === 'creating-invoice'
        ? 'Asking the Lightning backend for a fresh invoice.'
        : stage.status === 'awaiting-approval'
          ? 'Choose NIM or USDT and approve the swap in Nimiq Pay.'
          : 'Payment submitted. Waiting for the creator to receive the Bitcoin.'}
    </p>
  )
}
