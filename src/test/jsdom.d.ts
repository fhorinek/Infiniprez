declare module 'jsdom' {
  export interface JSDOMOptions {
    runScripts?: string
    url?: string
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    window: Window & typeof globalThis
  }
}
