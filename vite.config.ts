import { Buffer } from 'node:buffer'
import type { IncomingMessage } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

function localFetchProxy(options: {
  prefix: string
  target: string
  headers?: Record<string, string>
}): Plugin {
  return {
    name: `local-fetch-proxy-${options.prefix.replace(/\W+/g, '-')}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url || ''
        if (!requestUrl.startsWith(options.prefix)) {
          next()
          return
        }

        try {
          const upstreamUrl = new URL(requestUrl.slice(options.prefix.length) || '/', options.target)
          const headers = new Headers()
          Object.entries(request.headers).forEach(([name, value]) => {
            if (!value || ['host', 'content-length', 'connection'].includes(name.toLowerCase())) return
            headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          })
          Object.entries(options.headers || {}).forEach(([name, value]) => headers.set(name, value))

          const upstreamResponse = await fetch(upstreamUrl, {
            method: request.method,
            headers,
            body: await readRequestBody(request),
            redirect: 'manual'
          })
          response.statusCode = upstreamResponse.status
          response.statusMessage = upstreamResponse.statusText
          upstreamResponse.headers.forEach((value, name) => {
            // Node fetch transparently decompresses the body. Forwarding the
            // original encoding/length would make the browser decode it twice.
            if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) return
            response.setHeader(name, value)
          })
          response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unknown proxy error'
          console.error(`[local proxy ${options.prefix}] ${detail}`)
          if (!response.headersSent) {
            response.statusCode = 502
            response.setHeader('Content-Type', 'text/plain; charset=utf-8')
          }
          response.end('本地代理暂时无法连接上游服务')
        }
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const isPublicRelease = mode === 'public' || mode.endsWith('-public')
  const localApiKey = isPublicRelease ? undefined : env.OPENCODE_API_KEY?.trim()
  const nutstoreUsername = isPublicRelease ? undefined : env.NUTSTORE_USERNAME?.trim()
  const nutstorePassword = isPublicRelease ? undefined : env.NUTSTORE_PASSWORD?.trim()
  const nutstoreAuth = nutstoreUsername && nutstorePassword
    ? `Basic ${Buffer.from(`${nutstoreUsername}:${nutstorePassword}`).toString('base64')}`
    : undefined

  return {
    // These defaults are deliberately compiled into the personal desktop/mobile
    // build. They remain editable in the admin screen, while .env.local stays
    // outside Git and avoids leaking credentials into logs or documentation.
    define: {
      __BUILTIN_NUTSTORE_USERNAME__: JSON.stringify(nutstoreUsername || ''),
      __BUILTIN_NUTSTORE_PASSWORD__: JSON.stringify(nutstorePassword || ''),
      __BUILTIN_OPENCODE_API_KEY__: JSON.stringify(localApiKey || '')
    },
    plugins: [
      react(),
      tailwindcss(),
      localFetchProxy({
        prefix: '/dav',
        target: 'https://dav.jianguoyun.com',
        headers: {
          Origin: 'https://dav.jianguoyun.com',
          ...(nutstoreAuth ? { Authorization: nutstoreAuth } : {})
        }
      }),
      localFetchProxy({
        prefix: '/zen-api',
        target: 'https://opencode.ai',
        headers: localApiKey
          ? { Authorization: `Bearer ${localApiKey}`, 'x-api-key': localApiKey }
          : {}
      })
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
    }
  }
})
