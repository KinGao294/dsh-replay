/**
 * Local type shims for the dsh web host environment.
 *
 * The published `@deepseek-ai/dsh-host-webserver` types declare the service
 * as `ctx.httpServer`; the dsh web composition exposes it as `ctx.webServer`.
 * This augmentation aligns the shared Context for this plugin's type-check.
 */
import type { HttpServerService } from '@deepseek-ai/dsh-host-webserver'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: HttpServerService
  }
}
