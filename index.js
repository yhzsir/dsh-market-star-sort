/**
 * Adds a GitHub star-count order to the Web Plugins page's Discover tab.
 *
 * The Discover tab builds its sort menu from the sort keys the selected plugin
 * market index declares, and sorts by each entry's declared value. The stock
 * market index (awesome-dsh-plugin.com) declares none, so this Host half
 * enriches every fetch of a configured index document: it declares one extra
 * `stars` sort key and fills each entry's value from the index site's public
 * catalog. The page itself is untouched, so the key shows up natively in the
 * sort menu and the Host orders and pages the result.
 *
 * Nothing leaves the machine except the catalog download, and no other fetch
 * is altered: the wrapper only rebuilds a body it successfully recognized as a
 * format-1 plugin market index.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Sort key id declared on the index; also the field name in each entry's metadata. */
const SORT_KEY = 'stars'
/** Declaration shown in the sort menu, localized the way index declarations are. */
const SORT_TITLE = { en: 'Stars', zh: 'Star 数' }
/** Public catalog of the default index; `items` entries carry `slug` and `stars`. */
const DEFAULT_CATALOG_URL = 'https://awesome-dsh-plugin.com/catalog.json'
/** Index sources whose documents this plugin enriches. */
const DEFAULT_INDEX_URLS = [
  'https://awesome-dsh-plugin.com/index.json',
  'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json',
]
/** Star snapshot shipped with the plugin, so the sort key exists before the first download. */
const SEED_PATH = fileURLToPath(new URL('./data/stars.json', import.meta.url))
/** Directory under the profile that keeps the last refreshed snapshot. */
const CACHE_DIR_NAME = '.market-star-sort'

/**
 * Read a JSON file, treating every failure (missing, unreadable, malformed) as absent.
 * @param {string | undefined} path - absolute path, or undefined to skip the read.
 * @returns {unknown} the parsed value, or undefined.
 */
function readJsonFile(path) {
  if (path === undefined) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** The lowercased `owner/repo` key shared by catalog items and index entries. */
function slugOf(value) {
  if (typeof value !== 'string') return undefined
  const slug = value.trim().toLowerCase().replace(/\/+$/u, '')
  return slug === '' ? undefined : slug
}

/** The localized title of an index entry as one string, preferring English. */
function titleTextOf(title) {
  if (typeof title === 'string') return title
  if (title === null || typeof title !== 'object') return undefined
  if (typeof title.en === 'string') return title.en
  for (const value of Object.values(title)) if (typeof value === 'string') return value
  return undefined
}

/**
 * Build the `owner/repo` → stars map from a catalog document.
 * Accepts the site's `{ items: [{ slug, stars }] }`, the npm package's
 * `{ plugins: [...] }`, and a flat `{ stars: { "owner/repo": n } }` snapshot.
 * @param {unknown} payload - a parsed catalog or snapshot document.
 * @returns {Map<string, number>} the star counts keyed by lowercased slug.
 */
function starMapOf(payload) {
  const map = new Map()
  if (payload === null || typeof payload !== 'object') return map
  const flat = payload.stars
  const entries = Array.isArray(flat) ? flat : flat ?? payload.items ?? payload.plugins
  if (entries === null || typeof entries !== 'object') return map
  if (Array.isArray(entries)) {
    for (const item of entries) {
      if (item === null || typeof item !== 'object') continue
      const slug = slugOf(item.slug) ?? slugOf(item.name) ?? slugOf(item.title)
      const stars = item.stars
      if (slug !== undefined && typeof stars === 'number' && Number.isFinite(stars)) map.set(slug, stars)
    }
    return map
  }
  for (const [rawSlug, stars] of Object.entries(entries)) {
    const slug = slugOf(rawSlug)
    if (slug !== undefined && typeof stars === 'number' && Number.isFinite(stars)) map.set(slug, stars)
  }
  return map
}

/**
 * The star count of one index entry: by its `owner/repo` title, else by its
 * repository URL, else by the index site's entry page URL.
 * @param {Record<string, unknown>} plugin - one parsed index entry.
 * @param {Map<string, number>} stars - star counts keyed by lowercased slug.
 * @returns {number | undefined} the count, or undefined when the entry is unknown.
 */
function starOf(plugin, stars) {
  const candidates = []
  const title = slugOf(titleTextOf(plugin.title))
  if (title !== undefined) {
    candidates.push(title)
    // A monorepo entry titles itself `owner/repo#path/to/package`; the catalog
    // flattens that path into the slug `owner/repo--path-to-package`.
    const hash = title.indexOf('#')
    if (hash !== -1) candidates.push(`${title.slice(0, hash)}--${title.slice(hash + 1).replaceAll('/', '-')}`)
  }
  const repository = plugin.repository
  const url = repository !== null && typeof repository === 'object' ? repository.url : undefined
  if (typeof url === 'string') {
    const match = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/iu.exec(url)
    if (match !== null) candidates.push(slugOf(`${match[1]}/${match[2]}`))
  }
  if (typeof plugin.homepage === 'string') {
    const match = /\/p\/([^/]+)\/([^/]+)\/?$/u.exec(plugin.homepage)
    if (match !== null) candidates.push(slugOf(`${match[1]}/${match[2]}`))
  }
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const value = stars.get(candidate)
    if (value !== undefined) return value
  }
  return undefined
}

/** An own, enumerable record used where a plain `{}` would inherit prototype keys. */
function record() {
  return Object.create(null)
}

/**
 * Declare the star sort key on one parsed index document and fill each entry's
 * value, in place. Returns false, leaving the document untouched, unless the
 * document is a format-1 index whose entries mostly match the catalog: an
 * unrelated index must not gain a sort key whose values are all missing.
 * @param {unknown} document - one parsed index document.
 * @param {Map<string, number>} stars - star counts keyed by lowercased slug.
 * @returns {boolean} whether the document now declares the key.
 */
function enrichIndex(document, stars) {
  if (document === null || typeof document !== 'object') return false
  const index = document
  if (index.format !== 1 || !Array.isArray(index.plugins) || index.plugins.length === 0) return false
  const declared = index.metadata !== null && typeof index.metadata === 'object' ? index.metadata : undefined
  if (declared !== undefined && declared.sortKeys !== undefined) {
    const keys = declared.sortKeys
    if (keys !== null && typeof keys === 'object' && Object.hasOwn(keys, SORT_KEY)) return false
  }
  let matched = 0
  for (const plugin of index.plugins) {
    if (plugin === null || typeof plugin !== 'object') continue
    const value = starOf(plugin, stars)
    if (value === undefined) continue
    matched += 1
    if (plugin.metadata === null || typeof plugin.metadata !== 'object') plugin.metadata = record()
    const metadata = plugin.metadata
    if (metadata.sortKeys === null || typeof metadata.sortKeys !== 'object') metadata.sortKeys = record()
    if (!Object.hasOwn(metadata.sortKeys, SORT_KEY)) metadata.sortKeys[SORT_KEY] = value
  }
  if (matched === 0 || matched * 2 < index.plugins.length) return false
  if (index.metadata === null || typeof index.metadata !== 'object') index.metadata = record()
  const metadata = index.metadata
  if (metadata.sortKeys === null || typeof metadata.sortKeys !== 'object') metadata.sortKeys = record()
  metadata.sortKeys[SORT_KEY] = { title: { ...SORT_TITLE }, order: 'desc' }
  return true
}

/** The URL a `fetch` call addresses, as a string. */
function fetchUrlOf(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') return input.url
  return undefined
}

/** A URL in canonical form, so a configured source and a fetch argument compare equal. */
function canonicalUrl(value) {
  try {
    return new URL(value).href
  } catch {
    return value
  }
}

/** A positive number from plugin configuration, else the fallback. */
function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Host half: enrich configured plugin market index documents with a star sort key.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin's context.
 * @param {Record<string, unknown>} [config] - the row's configuration.
 */
export function apply(ctx, config = {}) {
  const catalogUrl = typeof config.catalogUrl === 'string' && config.catalogUrl !== '' ? config.catalogUrl : DEFAULT_CATALOG_URL
  const refreshHours = positiveNumber(config.refreshHours, 24)
  const fetchTimeoutMs = positiveNumber(config.fetchTimeoutMs, 180_000)
  const extraIndexUrls = Array.isArray(config.indexUrls) ? config.indexUrls.filter((url) => typeof url === 'string') : []
  const profileDir = (() => {
    const context = ctx.get('profileContext')
    if (context !== undefined && typeof context.dir === 'string') return context.dir
    return process.env.DSH_PROFILE_DIR
  })()
  const cacheFile = profileDir === undefined ? undefined : join(profileDir, CACHE_DIR_NAME, 'stars.json')

  let stars = new Map()
  let refreshedAt = 0
  const cached = readJsonFile(cacheFile)
  if (cached !== undefined) {
    stars = starMapOf(cached)
    const stamp = Date.parse(String(cached.updated ?? ''))
    if (Number.isFinite(stamp)) refreshedAt = stamp
  }
  if (stars.size === 0) stars = starMapOf(readJsonFile(SEED_PATH))

  const configuredUrls = new Set([...DEFAULT_INDEX_URLS, ...extraIndexUrls].map(canonicalUrl))
  /** Whether this URL is a configured plugin market index source worth enriching. */
  const shouldEnrich = (url) => {
    if (configuredUrls.has(canonicalUrl(url))) return true
    let sources
    try {
      sources = ctx.get('pluginMarket')?.listIndexes() ?? []
    } catch {
      return false
    }
    for (const source of sources) if (source.error === undefined && canonicalUrl(source.url) === canonicalUrl(url)) return true
    return false
  }

  const previousFetch = globalThis.fetch
  const wrappedFetch = async (input, init) => {
    const response = await previousFetch(input, init)
    try {
      if (!response.ok || stars.size === 0) return response
      const url = fetchUrlOf(input)
      if (url === undefined || !shouldEnrich(url)) return response
      const document = JSON.parse(await response.clone().text())
      if (!enrichIndex(document, stars)) return response
      const headers = new Headers(response.headers)
      headers.delete('content-length')
      headers.delete('content-encoding')
      headers.set('content-type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(document), { status: response.status, statusText: response.statusText, headers })
    } catch {
      return response
    }
  }
  ctx.effect(() => {
    globalThis.fetch = wrappedFetch
    return () => {
      if (globalThis.fetch === wrappedFetch) globalThis.fetch = previousFetch
    }
  })

  /** Download the catalog and adopt it, keeping it as the next start's snapshot. */
  const refresh = async () => {
    try {
      const response = await previousFetch(catalogUrl, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(fetchTimeoutMs),
      })
      if (!response.ok) return
      const next = starMapOf(JSON.parse(await response.text()))
      if (next.size === 0) return
      stars = next
      refreshedAt = Date.now()
      if (cacheFile === undefined) return
      mkdirSync(dirname(cacheFile), { recursive: true })
      const temporary = `${cacheFile}.tmp`
      writeFileSync(temporary, JSON.stringify({ updated: new Date(refreshedAt).toISOString(), source: catalogUrl, stars: Object.fromEntries(next) }))
      renameSync(temporary, cacheFile)
    } catch {
      /* A failed refresh keeps the snapshot already in use. */
    }
  }

  let timer
  let disposed = false
  const scheduleRefresh = (delayMs) => {
    if (disposed) return
    timer = setTimeout(() => {
      void refresh().then(() => scheduleRefresh(refreshHours * 3_600_000))
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
  }
  ctx.effect(() => {
    const staleMs = refreshedAt === 0 ? 0 : refreshedAt + refreshHours * 3_600_000 - Date.now()
    scheduleRefresh(Math.max(2_000, staleMs))
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  })
}