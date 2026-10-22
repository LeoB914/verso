import { protocol, net, session } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { resolveInProject } from './util/paths'

/**
 * Custom protocol `openleaf://project/<relative-path>` serving files from the
 * currently open project only — never `file://`.
 */

let currentProjectRoot: string | null = null

export function setProtocolProjectRoot(root: string | null): void {
  currentProjectRoot = root
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.eps': 'application/postscript',
  '.css': 'text/css',
  '.html': 'text/html',
}

export function registerProjectProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'openleaf',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // pdf.js fetches PDFs via XHR from the renderer origin — without this
        // the browser rejects every cross-origin request to openleaf://.
        corsEnabled: true,
      },
    },
  ])
}

/** Reflect the request origin so the sandboxed renderer may read the response. */
function corsOrigin(request: Request): string {
  return request.headers.get('origin') ?? '*'
}

let protocolHandlerInstalled = false

export async function handleProjectProtocol(): Promise<void> {
  if (protocolHandlerInstalled) return
  protocolHandlerInstalled = true
  for (const ses of [session.defaultSession]) {
    ses.protocol.handle('openleaf', async (request) => {
      try {
        const url = new URL(request.url)
        // host = 'project', pathname = /<relative path>
        if (url.host !== 'project') {
          return new Response('Only openleaf://project/… is allowed', { status: 403 })
        }
        const relPath = decodeURIComponent(url.pathname.replace(/^\//, ''))
        if (!currentProjectRoot) {
          return new Response('No project open', { status: 404 })
        }
        const absolute = await resolveInProject(currentProjectRoot, relPath)
        const stat = await fs.stat(absolute)
        if (!stat.isFile()) return new Response('Not a file', { status: 404 })
        const mime = MIME_TYPES[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream'
        const data = await fs.readFile(absolute)
        // pdf.js fetches via XHR from the renderer origin; without a CORS
        // header the browser blocks the response (file:// origin ≠ openleaf://).
        return new Response(new Uint8Array(data), {
          headers: {
            'content-type': mime,
            'content-length': String(data.length),
            'access-control-allow-origin': corsOrigin(request),
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Not found'
        const status = message.includes('escape') || message.includes('Unsafe') ? 403 : 404
        return new Response(message, { status })
      }
    })
  }
}

/** Build a URL for a project-relative file (for pdfjs / img tags). */
export function projectFileUrl(relPath: string): string {
  return `openleaf://project/${relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

// Keep `net` referenced so bundlers do not drop the import used indirectly.
void net
