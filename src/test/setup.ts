import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

class MockResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
