/**
 * Single API entry point.
 *
 * Vercel builds one function per file in `api/`, and its docs recommend
 * keeping related routes in one function so instances are reused across
 * them. Route modules live in `server/` and are imported here.
 */

import { createInvoice } from '../server/invoice'
import { checkStatus } from '../server/status'

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/invoice') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed.', {
          status: 405,
          headers: { allow: 'POST' },
        })
      }
      return createInvoice(request)
    }

    if (pathname === '/api/status') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed.', {
          status: 405,
          headers: { allow: 'GET' },
        })
      }
      return checkStatus(request)
    }

    return new Response('Not found.', { status: 404 })
  },
}
