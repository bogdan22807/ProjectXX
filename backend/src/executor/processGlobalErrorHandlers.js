import { errorMessage, errorStack, errorType, serializeErrorJson } from './errorLogFormat.js'

let registered = false

/**
 * Register once: uncaughtException / unhandledRejection with full diagnostics on stderr.
 */
export function registerProcessGlobalErrorHandlers() {
  if (registered) return
  registered = true

  process.on('uncaughtException', (err, origin) => {
    const where =
      typeof origin === 'string' && origin
        ? origin
        : 'process.on(uncaughtException) — event may have occurred in any tick'
    console.error('[uncaughtException]', where)
    console.error('ERROR_TYPE=', errorType(err))
    console.error('ERROR_MESSAGE=', errorMessage(err))
    console.error('ERROR_STACK=', errorStack(err) || '(no stack)')
    console.error('SERIALIZED=', serializeErrorJson(err))
    process.exit(1)
  })

  process.on('unhandledRejection', (reason, promise) => {
    const where =
      promise && typeof promise === 'object' && 'catch' in promise
        ? 'unhandledRejection (Promise without catch)'
        : 'unhandledRejection'
    console.error('[unhandledRejection]', where)
    console.error('ERROR_TYPE=', errorType(reason))
    console.error('ERROR_MESSAGE=', errorMessage(reason))
    console.error('ERROR_STACK=', errorStack(reason) || '(no stack)')
    console.error('SERIALIZED=', serializeErrorJson(reason))
  })
}
