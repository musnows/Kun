import { get as httpGet } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeGrokCredentials,
  isGrokOAuthCredentials,
  parseGrokCredentials,
  resolveGrokOAuthApiKey,
  startGrokBrowserAuth,
  startGrokDeviceAuth,
  pollGrokDeviceAuth,
  GROK_OAUTH_CLIENT_ID,
  GROK_OAUTH_ISSUER
} from './grok-auth'

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

function successfulTokenBody() {
  const claims = { email: 'grok@example.com', sub: 'user_123' }
  return {
    access_token: encodeJwt(claims),
    refresh_token: 'refresh-token',
    id_token: encodeJwt(claims),
    expires_in: 3600
  }
}

function discoveryBody() {
  return {
    authorization_endpoint: `${GROK_OAUTH_ISSUER}/oauth2/auth`,
    token_endpoint: `${GROK_OAUTH_ISSUER}/oauth2/token`
  }
}

function hitCallback(redirectUri: string, state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUri)
    url.searchParams.set('code', 'auth-code')
    url.searchParams.set('state', state)
    const req = httpGet(url, (res) => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('error', reject)
  })
}

describe('startGrokBrowserAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes browser OAuth with a random loopback callback', async () => {
    const tokenRequests: Array<{ url: string; body: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url)
      if (urlString.includes('openid-configuration')) {
        return new Response(JSON.stringify(discoveryBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      tokenRequests.push({ url: urlString, body: String(init?.body ?? '') })
      return new Response(JSON.stringify(successfulTokenBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    let authUrlString = ''
    const result = await startGrokBrowserAuth(async (url) => {
      authUrlString = url
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({
      ok: true,
      credentials: {
        kind: 'grok-oauth',
        email: 'grok@example.com',
        userId: 'user_123',
        refreshToken: 'refresh-token'
      }
    })
    const authUrl = new URL(authUrlString)
    expect(authUrl.searchParams.get('client_id')).toBe(GROK_OAUTH_CLIENT_ID)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('referrer')).toBe('kun')
    expect(authUrl.searchParams.get('scope')).toContain('grok-cli:access')
    const redirectUri = authUrl.searchParams.get('redirect_uri') ?? ''
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const tokenBody = new URLSearchParams(tokenRequests[0]?.body ?? '')
    expect(tokenBody.get('redirect_uri')).toBe(redirectUri)
    expect(tokenBody.get('client_id')).toBe(GROK_OAUTH_CLIENT_ID)
    expect(tokenBody.get('code_verifier')).toBeTruthy()
  })

  it('includes token endpoint error details when the exchange is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url)
      if (urlString.includes('openid-configuration')) {
        return new Response(JSON.stringify(discoveryBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response(
        JSON.stringify({
          error: 'access_denied',
          error_description: 'team disallowed'
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    })

    const result = await startGrokBrowserAuth(async (url) => {
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (!redirectUri || !state) throw new Error('missing OAuth redirect data')
      await hitCallback(redirectUri, state)
    })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toContain('returned 403: access_denied: team disallowed')
    }
  })
})

describe('startGrokDeviceAuth / pollGrokDeviceAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests a device code and completes on successful poll', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url)
      if (urlString.endsWith('/oauth2/device/code')) {
        const body = String(init?.body ?? '')
        expect(body).toContain(`client_id=${GROK_OAUTH_CLIENT_ID}`)
        return new Response(
          JSON.stringify({
            device_code: 'device-abc',
            user_code: 'ABCD-1234',
            verification_uri: 'https://accounts.x.ai/device',
            verification_uri_complete: 'https://accounts.x.ai/device?user_code=ABCD-1234',
            expires_in: 600,
            interval: 5
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (urlString.endsWith('/oauth2/token')) {
        return new Response(JSON.stringify(successfulTokenBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      throw new Error(`unexpected url ${urlString}`)
    })

    const start = await startGrokDeviceAuth()
    expect(start).toMatchObject({
      ok: true,
      deviceCode: 'device-abc',
      userCode: 'ABCD-1234',
      interval: 5
    })
    if (!start.ok) return

    const poll = await pollGrokDeviceAuth(start.deviceCode)
    expect(poll).toMatchObject({
      done: true,
      credentials: { kind: 'grok-oauth', email: 'grok@example.com' }
    })
  })

  it('returns pending / slow_down without finishing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'authorization_pending' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    await expect(pollGrokDeviceAuth('device-abc')).resolves.toEqual({ done: false })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'slow_down' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    await expect(pollGrokDeviceAuth('device-abc')).resolves.toEqual({ done: false, slowDown: true })
  })
})

describe('credential helpers', () => {
  it('round-trips encode/parse and materializes proxy headers', () => {
    const encoded = encodeGrokCredentials({
      kind: 'grok-oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      email: 'a@b.c',
      userId: 'u1'
    })
    expect(isGrokOAuthCredentials(encoded)).toBe(true)
    expect(parseGrokCredentials(encoded)?.email).toBe('a@b.c')
    expect(resolveGrokOAuthApiKey(encoded)).toEqual({
      apiKey: 'access',
      headers: {
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-authenticateresponse': 'authenticate-response'
      }
    })
    expect(resolveGrokOAuthApiKey('plain-key')).toEqual({ apiKey: 'plain-key' })
  })
})
