import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

/** Matches the public Grok CLI OAuth client (xai-grok-shell GrokComConfig::default). */
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_OAUTH_ISSUER = 'https://auth.x.ai'
export const GROK_CLI_CHAT_PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'
export const GROK_TOKEN_AUTH_HEADER = 'xai-grok-cli'
export const GROK_OAUTH_REFERRER = 'kun'

const GROK_OAUTH_HOST = '127.0.0.1'
const GROK_OAUTH_TIMEOUT_MS = 10 * 60 * 1000
const GROK_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'grok-cli:access',
  'api:access',
  'conversations:read',
  'conversations:write',
  'workspaces:read',
  'workspaces:write'
].join(' ')
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export type GrokOAuthCredentials = {
  kind: 'grok-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  userId?: string
  issuer?: string
  clientId?: string
}

export type GrokAuthStartResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number }
  | { ok: false; message: string }

export type GrokAuthPollResult =
  | { done: true; credentials: GrokOAuthCredentials }
  | { done: false; error?: string; slowDown?: boolean }

export type GrokBrowserAuthErrorCode = 'port_in_use'

export type GrokBrowserAuthResult =
  | { ok: true; credentials: GrokOAuthCredentials }
  | { ok: false; message: string; code?: GrokBrowserAuthErrorCode }

type OidcDiscovery = {
  authorization_endpoint: string
  token_endpoint: string
}

class GrokBrowserAuthError extends Error {
  constructor(
    message: string,
    readonly code: GrokBrowserAuthErrorCode
  ) {
    super(message)
    this.name = 'GrokBrowserAuthError'
  }
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split('.')[1]
  if (!part) return undefined
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function extractEmail(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue
    const claims = parseJwtClaims(token)
    if (claims && typeof claims.email === 'string') return claims.email
  }
  return undefined
}

function extractUserId(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue
    const claims = parseJwtClaims(token)
    if (!claims) continue
    if (typeof claims.sub === 'string' && claims.sub) return claims.sub
    if (typeof claims.user_id === 'string' && claims.user_id) return claims.user_id
  }
  return undefined
}

function summarizeAuthErrorBody(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const parts = [
      typeof parsed.error === 'string' ? parsed.error : '',
      typeof parsed.error_description === 'string' ? parsed.error_description : '',
      typeof parsed.message === 'string' ? parsed.message : ''
    ].filter(Boolean)
    if (parts.length) return parts.join(': ').slice(0, 300)
  } catch {
    /* fall through */
  }
  return compact.slice(0, 300)
}

async function postForm(
  url: string,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders
    },
    body: new URLSearchParams(body).toString()
  })
  const text = await res.text()
  if (!res.ok) {
    const detail = summarizeAuthErrorBody(text)
    throw new Error(`Grok subscription auth: ${url} returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Grok subscription auth: unexpected response from ${url}: ${text.slice(0, 200)}`)
  }
}

async function discoverOidc(issuer: string = GROK_OAUTH_ISSUER): Promise<OidcDiscovery> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Grok subscription auth: discovery failed (${res.status}) from ${url}`)
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Grok subscription auth: invalid discovery document from ${url}`)
  }
  const authorization_endpoint =
    typeof parsed.authorization_endpoint === 'string' ? parsed.authorization_endpoint : ''
  const token_endpoint = typeof parsed.token_endpoint === 'string' ? parsed.token_endpoint : ''
  if (!authorization_endpoint || !token_endpoint) {
    throw new Error('Grok subscription auth: discovery document missing endpoints')
  }
  return { authorization_endpoint, token_endpoint }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePkce(): { verifier: string; challenge: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const verifier = Array.from(randomBytes(32), (byte) => chars[byte % chars.length]).join('')
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function grokOAuthRedirect(port: number): string {
  return `http://127.0.0.1:${port}/callback`
}

function buildAuthorizeUrl(
  authorizationEndpoint: string,
  pkceChallenge: string,
  state: string,
  nonce: string,
  redirectUri: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GROK_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: GROK_OAUTH_SCOPES,
    code_challenge: pkceChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    referrer: GROK_OAUTH_REFERRER
  })
  const joiner = authorizationEndpoint.includes('?') ? '&' : '?'
  return `${authorizationEndpoint}${joiner}${params.toString()}`
}

function credentialsFromTokens(
  tokens: Record<string, unknown>,
  issuer: string = GROK_OAUTH_ISSUER
): GrokOAuthCredentials | null {
  const accessToken = tokens.access_token as string | undefined
  const refreshToken = tokens.refresh_token as string | undefined
  const expiresIn = Number(tokens.expires_in) || 3600
  if (!accessToken || !refreshToken) return null
  return {
    kind: 'grok-oauth',
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email: extractEmail(tokens.id_token as string | undefined, accessToken),
    userId: extractUserId(tokens.id_token as string | undefined, accessToken),
    issuer,
    clientId: GROK_OAUTH_CLIENT_ID
  }
}

const GROK_BROWSER_SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Grok 订阅</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5}.box{text-align:center;padding:2rem}h1{margin-bottom:.5rem;font-size:18px}p{color:#a3a3a3;font-size:14px}@media(prefers-color-scheme:light){body{background:#fafafa;color:#171717}p{color:#525252}}</style></head><body><div class="box"><h1>登录成功</h1><p>可以关闭此窗口并返回应用。</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>`

function renderGrokErrorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>Grok 订阅</title></head><body style="font-family:system-ui;padding:2rem;color:#b91c1c"><h1>登录失败</h1><p>${safe}</p></body></html>`
}

/**
 * Browser OAuth (authorization code + PKCE). Binds a random loopback port,
 * opens the browser, exchanges the callback code for tokens.
 */
export async function startGrokBrowserAuth(
  openBrowser: (url: string) => void | Promise<void>
): Promise<GrokBrowserAuthResult> {
  let server: Server | null = null
  const cleanup = (): void => {
    if (server) {
      try {
        server.close(() => {})
      } catch {
        /* ignore */
      }
      server = null
    }
  }

  try {
    const discovery = await discoverOidc()
    const pkce = generatePkce()
    const state = base64UrlEncode(randomBytes(32))
    const nonce = base64UrlEncode(randomBytes(16))

    const credentials = await new Promise<GrokOAuthCredentials>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('授权超时，请重试'))
      }, GROK_OAUTH_TIMEOUT_MS)

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        reject(error)
      }
      const settleResolve = (creds: GrokOAuthCredentials): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        resolve(creds)
      }

      let activePort = 0
      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${activePort}`)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          const message = url.searchParams.get('error_description') || oauthError
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderGrokErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        if (!code || returnedState !== state) {
          const message = !code ? '缺少授权码' : '状态校验失败（可能的 CSRF）'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderGrokErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        postForm(discovery.token_endpoint, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: grokOAuthRedirect(activePort),
          client_id: GROK_OAUTH_CLIENT_ID,
          code_verifier: pkce.verifier
        })
          .then((tokens) => {
            const creds = credentialsFromTokens(tokens)
            if (!creds) throw new Error('令牌交换返回的数据不完整')
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(GROK_BROWSER_SUCCESS_HTML)
            settleResolve(creds)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderGrokErrorHtml(message))
            settleReject(new Error(message))
          })
      })

      const onListenError = (err: NodeJS.ErrnoException): void => {
        server?.off('error', onListenError)
        const message =
          err.code === 'EADDRINUSE' ? '本地回调端口被占用，无法完成登录' : err.message
        settleReject(
          err.code === 'EADDRINUSE' ? new GrokBrowserAuthError(message, 'port_in_use') : new Error(message)
        )
      }

      server.once('error', onListenError)
      // Port 0 = OS assigns a free loopback port (RFC 8252).
      server.listen(0, GROK_OAUTH_HOST, () => {
        server?.off('error', onListenError)
        const addr = server?.address()
        if (!addr || typeof addr === 'string') {
          settleReject(new Error('无法绑定本地回调端口'))
          return
        }
        activePort = addr.port
        const redirectUri = grokOAuthRedirect(activePort)
        const authorizeUrl = buildAuthorizeUrl(
          discovery.authorization_endpoint,
          pkce.challenge,
          state,
          nonce,
          redirectUri
        )
        void Promise.resolve(openBrowser(authorizeUrl)).catch((err: unknown) => {
          settleReject(err instanceof Error ? err : new Error(String(err)))
        })
      })
    })

    return { ok: true, credentials }
  } catch (error) {
    cleanup()
    const message = error instanceof Error ? error.message : String(error)
    return error instanceof GrokBrowserAuthError
      ? { ok: false, message, code: error.code }
      : { ok: false, message }
  }
}

export async function startGrokDeviceAuth(): Promise<GrokAuthStartResult> {
  try {
    const issuer = GROK_OAUTH_ISSUER.replace(/\/$/, '')
    const res = await fetch(`${issuer}/oauth2/device/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-grok-client-surface': 'ui'
      },
      body: new URLSearchParams({
        client_id: GROK_OAUTH_CLIENT_ID,
        scope: GROK_OAUTH_SCOPES,
        referrer: GROK_OAUTH_REFERRER
      }).toString()
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          message: 'Device-code login is not available for this deployment. Try browser login instead.'
        }
      }
      const detail = summarizeAuthErrorBody(text)
      return {
        ok: false,
        message: `Device code request failed (${res.status})${detail ? `: ${detail}` : ''}`
      }
    }
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      return { ok: false, message: 'Invalid device code response' }
    }
    const deviceCode = typeof data.device_code === 'string' ? data.device_code : ''
    const userCode = typeof data.user_code === 'string' ? data.user_code : ''
    const verificationUri =
      typeof data.verification_uri_complete === 'string'
        ? data.verification_uri_complete
        : typeof data.verification_uri === 'string'
          ? data.verification_uri
          : ''
    const interval = Math.max(Number(data.interval) || 5, 1)
    if (!deviceCode || !userCode || !verificationUri) {
      return { ok: false, message: 'Incomplete device auth response' }
    }
    if (!/^[A-Z0-9-]+$/i.test(userCode)) {
      return { ok: false, message: 'Server returned invalid user_code format' }
    }
    return {
      ok: true,
      url: verificationUri,
      deviceCode,
      userCode,
      interval
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Single poll of the device-code token endpoint. The renderer drives the
 * interval (and slow_down backoff) the same way Codex device login does.
 */
export async function pollGrokDeviceAuth(deviceCode: string): Promise<GrokAuthPollResult> {
  try {
    const issuer = GROK_OAUTH_ISSUER.replace(/\/$/, '')
    const res = await fetch(`${issuer}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-grok-client-surface': 'ui'
      },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: GROK_OAUTH_CLIENT_ID
      }).toString()
    })
    const text = await res.text()
    if (res.ok) {
      let tokens: Record<string, unknown>
      try {
        tokens = JSON.parse(text) as Record<string, unknown>
      } catch {
        return { done: false, error: 'Invalid token response' }
      }
      const credentials = credentialsFromTokens(tokens)
      if (!credentials) return { done: false, error: 'Token exchange returned incomplete tokens' }
      return { done: true, credentials }
    }

    let errorCode = ''
    let errorDescription = ''
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      errorCode = typeof parsed.error === 'string' ? parsed.error : ''
      errorDescription =
        typeof parsed.error_description === 'string' ? parsed.error_description : errorCode
    } catch {
      return { done: false, error: `Device authorization failed: ${res.status}` }
    }

    if (errorCode === 'authorization_pending') return { done: false }
    if (errorCode === 'slow_down') return { done: false, slowDown: true }
    if (errorCode === 'access_denied') {
      return { done: false, error: errorDescription || 'Authorization denied' }
    }
    if (errorCode === 'expired_token') {
      return { done: false, error: 'Device code expired. Please try again.' }
    }
    return { done: false, error: errorDescription || `Token exchange error: ${errorCode || res.status}` }
  } catch (error) {
    return { done: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function refreshGrokToken(
  credentials: GrokOAuthCredentials
): Promise<GrokOAuthCredentials | null> {
  try {
    const issuer = (credentials.issuer || GROK_OAUTH_ISSUER).replace(/\/$/, '')
    let tokenEndpoint = `${issuer}/oauth2/token`
    try {
      const discovery = await discoverOidc(issuer)
      tokenEndpoint = discovery.token_endpoint
    } catch {
      /* fall back to /oauth2/token */
    }
    const tokens = await postForm(tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId || GROK_OAUTH_CLIENT_ID
    })
    const next = credentialsFromTokens(tokens, issuer)
    if (!next) return null
    return {
      ...next,
      email: next.email ?? credentials.email,
      userId: next.userId ?? credentials.userId
    }
  } catch {
    return null
  }
}

export function isGrokOAuthCredentials(apiKey: string): boolean {
  if (!apiKey.startsWith('{')) return false
  try {
    return (JSON.parse(apiKey) as Record<string, unknown>).kind === 'grok-oauth'
  } catch {
    return false
  }
}

export function parseGrokCredentials(apiKey: string): GrokOAuthCredentials | null {
  if (!isGrokOAuthCredentials(apiKey)) return null
  const parsed = JSON.parse(apiKey) as GrokOAuthCredentials
  if (!parsed.accessToken || !parsed.refreshToken) return null
  return parsed
}

export function encodeGrokCredentials(creds: GrokOAuthCredentials): string {
  return JSON.stringify(creds)
}

export function grokRequestHeaders(): Record<string, string> {
  return {
    'X-XAI-Token-Auth': GROK_TOKEN_AUTH_HEADER,
    'x-authenticateresponse': 'authenticate-response'
  }
}

/**
 * Unwrap JSON-encoded Grok (or pass-through plain) credentials for runtime
 * clients. Codex credentials are handled separately by resolveCodexOAuthApiKey.
 */
export function resolveGrokOAuthApiKey(rawApiKey: string): { apiKey: string; headers?: Record<string, string> } {
  const key = rawApiKey.trim()
  const grok = isGrokOAuthCredentials(key) ? parseGrokCredentials(key) : null
  if (grok) return { apiKey: grok.accessToken, headers: grokRequestHeaders() }
  return { apiKey: key }
}
