// mmdb-lib references `Buffer` at module-eval time. Expose it as a global
// before any module that depends on it loads.
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
