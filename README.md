# Lightning Tips

A Nimiq Pay Mini App that lets anyone tip a creator over Bitcoin Lightning,
paid from their NIM or USDT balance via a self-custodial atomic swap.

Submitted to the [Nimiq Mini Apps Competition](https://miniappscompetition.com)
Cycle III.

**Live:** open <https://nimiq-lightning-tips.vercel.app> in Nimiq Pay → Mini Apps.

## How it works

1. The Mini App asks its backend for a fixed-amount BOLT11 invoice.
2. It calls `payLightningInvoice({ invoice })` on the Nimiq provider.
3. Nimiq Pay asks the user to pick NIM or USDT, shows the swap amount and fees,
   and takes approval. Keys never leave the wallet.
4. Nimiq Pay runs the atomic swap and submits the spending transaction.
5. The app polls its backend until the Lightning invoice actually settles.

### Settlement is confirmed, not assumed

A resolved `payLightningInvoice` call means the spending transaction was
*submitted* — not that the creator received Bitcoin. The UI never claims success
on that promise alone; it waits for the Lightning backend to report the invoice
as paid.

### Double-payment safety

Nimiq Pay refuses to re-submit an invoice while an earlier attempt is on record.
When `DUPLICATE_PAYMENT` or `TRANSACTION_OUTCOME_UNKNOWN` comes back, the app
does **not** offer a retry — money may already have moved. It checks settlement
against the backend first, reports success if the tip landed, and otherwise
shows an explicit "do not pay again" warning. Unrecognised errors are treated as
unsafe to retry for the same reason.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev -- --host
```

Open the printed **Network** URL (e.g. `http://192.168.1.2:5173`) in Nimiq Pay
under Mini Apps, with your phone on the same Wi-Fi.

### Configuration

No values are hardcoded. Creator details and tip presets come from `VITE_*` env
vars; the LNbits URL and invoice key stay server-side in the deployed
functions and never enter the client bundle.

See `.env.example` for the full list.

### Testing without a backend

Set `VITE_MOCK_BACKEND=true` in `.env.local` and run `npm run dev`. A dev-only
mock intercepts `/api/*`, issues fake invoices and settles them after six
seconds, so the whole UI flow can be exercised with no LNbits instance and no
real money. It is excluded from production builds.

The mock does **not** stub the Nimiq payment call — inside Nimiq Pay that still
reaches the real wallet, and its invoices are deliberately not payable.

### Lightning backend

There are two ways to receive tips. A Lightning address is simpler and is
used whenever `LIGHTNING_ADDRESS` is set.

#### Option A: a Lightning address (recommended)

Set `LIGHTNING_ADDRESS` to your address, e.g. `you@coinos.io` or `you@blink.sv`.
No key is stored: each tip requests a fresh fixed-amount invoice through
LNURL-pay, and settlement is read from the
[LUD-21](https://github.com/lnurl/luds/blob/luds/21.md) `verify` URL the wallet
returns. The tip message is passed as an LNURL comment (LUD-12).

The wallet must support LUD-21, otherwise the app cannot confirm a tip arrived
and refuses to create invoices. Blink, Coinos and Alby support it. The public
tip counter is hidden in this mode, because an address gives no access to the
wallet's history.

#### Option B: LNbits

`api/invoice.ts` and `api/status.ts` talk to an [LNbits](https://lnbits.com)
instance.

1. Create a free account at [demo.lnbits.com](https://demo.lnbits.com) (or run
   your own instance — see the [LNbits install docs](https://docs.lnbits.com/guide/installation/)).
2. Open the wallet and copy the **Invoice/read key** from the API info panel.
3. Set `LNBITS_URL` and `LNBITS_INVOICE_KEY` in your deployment environment.

Only the **invoice key** is used. It can create invoices and read their status
but cannot send payments, so a leak could not drain the wallet. Never use the
admin key here.

> `legend.lnbits.com`, named in many older tutorials, is no longer reachable.
> Demo instances are custodial and meant for testing — do not leave meaningful
> funds in one. `demo.lnbits.com` also deletes wallets without notice, which is
> why Option A is recommended for anything that has to stay up.

#### API behaviour this relies on

- `POST /api/v1/payments` with `{ out: false, amount, unit: 'sat' }` returns
  both `payment_hash` and `payment_request`.
- `GET /api/v1/payments/{hash}` returns `paid: true` once settled, and **404**
  when the invoice does not exist. The 404 is mapped to a definite
  "not paid" rather than an unreadable status, so a missing invoice is never
  confused with an unreachable backend.
- `details.status` is deliberately not trusted: LNbits sets it only for failed
  payments and for wallet owners on a successful refresh.

## Constraints

- **Mainnet only.** Lightning swaps fail on testnet with "Cannot create swap".
  The app detects testnet via `getHostNetwork()` and says so up front.
- **Fixed-amount invoices only.** Amounts are always set server-side.
- Secure-context APIs are unavailable over a plain-HTTP local network URL, so
  `randomId()` falls back when `crypto.randomUUID` is missing.

## Stack

Vite + React + TypeScript, `@nimiq/mini-app-sdk` 0.2.4.

## Licence

MIT — see [LICENSE](LICENSE).
