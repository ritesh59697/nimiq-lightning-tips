import { useCallback, useEffect, useRef, useState } from 'react'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { creator, tipPresetsSats, walletStallMs } from './lib/config'
import {
  awaitSettlement,
  checkSettlement,
  createInvoice,
  describeError,
  payInvoice,
  type TipStage,
} from './lib/lightning'
import { formatSats, insideNimiqPay, lightningAvailable } from './lib/host'
import {
  ArrowLeftRight,
  Check,
  CircleCheck,
  CircleX,
  Loader2,
  RefreshCw,
  RotateCcw,
  Smartphone,
  TriangleAlert,
  Wallet,
  Zap,
} from 'lucide-react'
import './App.css'

/** Progress of the "Nimiq Pay has gone quiet" fallback. */
type StallState = 'none' | 'stalled' | 'checking' | 'not-yet' | 'unreachable'

type ProviderState =
  | { status: 'connecting' }
  | { status: 'ready'; nimiq: NimiqProvider }
  | { status: 'unavailable'; reason: string }

export default function App() {
  const [provider, setProvider] = useState<ProviderState>({ status: 'connecting' })
  const [stage, setStage] = useState<TipStage>({ status: 'idle' })
  const [selectedSats, setSelectedSats] = useState<number>(tipPresetsSats[0])
  const abortRef = useRef<AbortController | null>(null)
  const [stall, setStall] = useState<StallState>('none')
  // Set when a manual status check proves the tip arrived while the wallet
  // call was still pending, so a late reply cannot overwrite that result.
  const settledByCheckRef = useRef<string | null>(null)

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

  // Nimiq Pay has been seen never returning from payLightningInvoice. Rather
  // than spin forever, offer a status check after a while. It never offers a
  // new tip: the pending payment could still complete and send a second one.
  useEffect(() => {
    if (stage.status !== 'awaiting-approval') return
    const timer = setTimeout(() => setStall('stalled'), walletStallMs)
    return () => {
      clearTimeout(timer)
      setStall('none')
    }
  }, [stage])

  const checkStalledPayment = useCallback(async () => {
    if (stage.status !== 'awaiting-approval') return
    const { invoice } = stage
    setStall('checking')
    const result = await checkSettlement(invoice.paymentHash)
    if (result.settled) {
      settledByCheckRef.current = invoice.paymentHash
      setStage({ status: 'settled', invoice, swapId: 'unknown', txHash: 'unknown' })
      return
    }
    setStall(result.indeterminate ? 'unreachable' : 'not-yet')
  }, [stage])

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
      if (settledByCheckRef.current === invoice.paymentHash) return
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

    if (settledByCheckRef.current === invoice.paymentHash) return
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

  const showProgress = busy || stage.status === 'settled'

  return (
    <main className="app">
      <header className="creator">
        <div className="avatar-ring">
          {creator.avatarUrl ? (
            <img className="avatar" src={creator.avatarUrl} alt="" />
          ) : (
            <div className="avatar avatar--fallback" aria-hidden="true">
              {creator.name.slice(0, 1)}
            </div>
          )}
          <span className="avatar-badge" aria-hidden="true">
            <Zap size={14} strokeWidth={2.5} />
          </span>
        </div>
        <h1>{creator.name}</h1>
        {creator.handle ? <p className="handle">{creator.handle}</p> : null}
        {creator.blurb ? <p className="blurb">{creator.blurb}</p> : null}
      </header>

      {!lightningAvailable ? (
        <p className="notice notice--warn" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <span>
            Nimiq Pay is on testnet. Lightning tips need mainnet, so switch networks
            to send one.
          </span>
        </p>
      ) : null}

      {provider.status === 'unavailable' ? (
        <p className="notice" role="status">
          <Smartphone size={18} aria-hidden="true" />
          <span>{provider.reason}</span>
        </p>
      ) : null}

      <section className="tip-card" aria-labelledby="tip-heading">
        <h2 id="tip-heading" className="tip-heading">
          Choose an amount
        </h2>

        <p className="amount-display" aria-live="polite">
          <span className="amount-value">{formatSats(selectedSats)}</span>
          <span className="amount-unit">sats</span>
        </p>

        <div className="amounts" role="group" aria-label="Tip amount">
          {tipPresetsSats.map((sats) => (
            <button
              key={sats}
              type="button"
              className={sats === selectedSats ? 'amount amount--active' : 'amount'}
              aria-pressed={sats === selectedSats}
              onClick={() => setSelectedSats(sats)}
              disabled={busy}
            >
              {formatSats(sats)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="pay"
          onClick={stage.status === 'settled' ? () => setStage({ status: 'idle' }) : sendTip}
          disabled={disabled}
        >
          {busy ? (
            <Loader2 className="spin" size={20} aria-hidden="true" />
          ) : (
            <Zap size={20} aria-hidden="true" />
          )}
          <span>{stageLabel(stage, selectedSats)}</span>
        </button>

        {showProgress ? <Progress stage={stage} /> : null}
      </section>

      {stage.status === 'awaiting-approval' && stall !== 'none' ? (
        <StallNotice stall={stall} onCheck={checkStalledPayment} />
      ) : null}

      <StageDetail stage={stage} onReset={() => setStage({ status: 'idle' })} />

      <footer className="how">
        <h2 className="how-heading">How it works</h2>
        <ol className="how-steps">
          <li>
            <Wallet size={18} aria-hidden="true" />
            <span>You pay in NIM or USDT from your Nimiq Pay balance.</span>
          </li>
          <li>
            <ArrowLeftRight size={18} aria-hidden="true" />
            <span>An atomic swap converts it to Bitcoin. Your keys never leave the wallet.</span>
          </li>
          <li>
            <Zap size={18} aria-hidden="true" />
            <span>The tip arrives over Lightning, and we confirm it before saying so.</span>
          </li>
        </ol>
      </footer>
    </main>
  )
}

const PROGRESS_STEPS = ['Invoice', 'Approve', 'Swap', 'Delivered'] as const

function progressIndex(stage: TipStage): number {
  switch (stage.status) {
    case 'creating-invoice':
      return 0
    case 'awaiting-approval':
      return 1
    case 'confirming':
      return 2
    case 'settled':
      return PROGRESS_STEPS.length
    default:
      return -1
  }
}

function Progress({ stage }: { stage: TipStage }) {
  const current = progressIndex(stage)
  return (
    <ol className="progress" aria-label="Payment progress">
      {PROGRESS_STEPS.map((label, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        return (
          <li
            key={label}
            className={`progress-step progress-step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="progress-dot" aria-hidden="true">
              {state === 'done' ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className="progress-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Long hashes are unreadable on a phone; keep both ends for recognition. */
function shorten(value: string): string {
  const KEEP = 8
  return value.length > KEEP * 2 + 1 ? `${value.slice(0, KEEP)}…${value.slice(-KEEP)}` : value
}

function stageLabel(stage: TipStage, selectedSats: number): string {
  switch (stage.status) {
    case 'creating-invoice':
      return 'Preparing invoice…'
    case 'awaiting-approval':
      return 'Approve in Nimiq Pay…'
    case 'confirming':
      return 'Confirming delivery…'
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
    const receipt = [
      { label: 'Swap', value: stage.swapId },
      { label: 'Transaction', value: stage.txHash },
    ].filter((row) => row.value && row.value !== 'unknown')

    return (
      <div className="result result--ok" role="status">
        <CircleCheck className="result-icon" size={28} aria-hidden="true" />
        <div className="result-body">
          <h2>Tip delivered</h2>
          <p>
            {formatSats(stage.invoice.amountSats)} sats reached {creator.name}. Thank
            you.
          </p>
          {receipt.length > 0 ? (
            <dl className="receipt">
              {receipt.map((row) => (
                <div key={row.label} className="receipt-row">
                  <dt>{row.label}</dt>
                  <dd className="mono" title={row.value}>
                    {shorten(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    )
  }

  if (stage.status === 'indeterminate') {
    return (
      <div className="result result--warn" role="alert">
        <TriangleAlert className="result-icon" size={28} aria-hidden="true" />
        <div className="result-body">
          <h2>Status unconfirmed</h2>
          <p>{stage.detail}</p>
          <p className="emphasis">
            Do not pay this invoice again, as that would send a second tip. Check
            with the creator if it does not appear shortly.
          </p>
        </div>
      </div>
    )
  }

  if (stage.status === 'failed') {
    return (
      <div className="result result--error" role="alert">
        <CircleX className="result-icon" size={28} aria-hidden="true" />
        <div className="result-body">
          <h2>Payment not completed</h2>
          <p>{stage.reason}</p>
          {stage.recoverable ? (
            <button type="button" className="retry" onClick={onReset}>
              <RotateCcw size={16} aria-hidden="true" />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <p className="pending-note" role="status">
      {stage.status === 'creating-invoice'
        ? 'Asking the Lightning backend for a fresh invoice.'
        : stage.status === 'awaiting-approval'
          ? 'Choose NIM or USDT and approve the payment in Nimiq Pay.'
          : 'Payment sent. Waiting for the Bitcoin to reach the creator.'}
    </p>
  )
}

function StallNotice({ stall, onCheck }: { stall: StallState; onCheck: () => void }) {
  const checking = stall === 'checking'
  return (
    <div className="result result--warn" role="status">
      <TriangleAlert className="result-icon" size={28} aria-hidden="true" />
      <div className="result-body">
        <h2>Nimiq Pay hasn&apos;t responded</h2>
        <p>
          If you approved the payment, it may still go through, so don&apos;t start
          a new tip. Check whether it reached the creator instead.
        </p>
        {stall === 'not-yet' ? (
          <p className="emphasis">
            Not received yet. Check again in a moment. If you never approved
            anything in Nimiq Pay, you can reopen the mini app to start over.
          </p>
        ) : null}
        {stall === 'unreachable' ? (
          <p className="emphasis">
            Couldn&apos;t reach the creator&apos;s Lightning wallet to check. Try again
            in a moment.
          </p>
        ) : null}
        <button type="button" className="retry" onClick={onCheck} disabled={checking}>
          {checking ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {checking ? 'Checking…' : 'Check if the tip arrived'}
        </button>
      </div>
    </div>
  )
}
