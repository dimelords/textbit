import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { NodeEntry } from 'slate'
import { Menu } from '../lib/components/ContextMenu/Menu'
import {
  ContextMenuHintsContext,
  type ContextMenuHints
} from '../lib/components/ContextMenu/ContextMenuHintsContext'

let menuHeight = 40
let resizeCallbacks: Array<() => void> = []

class MockResizeObserver {
  private callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
  }

  observe() {
    resizeCallbacks.push(this.callback)
  }

  unobserve() {}

  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.callback)
  }
}

function renderMenu(y: number) {
  const menu: ContextMenuHints = {
    position: { x: 100, y },
    target: document.createElement('div'),
    originalEvent: new MouseEvent('contextmenu'),
    nodeEntry: [{ text: '' }, [0, 0]] as NodeEntry
  }

  const { unmount } = render(
    <ContextMenuHintsContext.Provider value={{ menu, dispatch: () => { } }}>
      <Menu className='menu'>Suggestions</Menu>
    </ContextMenuHintsContext.Provider>
  )

  const el = document.body.querySelector<HTMLElement>('.menu')
  if (!el) {
    throw new Error('Menu did not render')
  }

  return { el, unmount }
}

function resizeTo(height: number) {
  menuHeight = height
  act(() => {
    resizeCallbacks.forEach((cb) => cb())
  })
}

describe('ContextMenu.Root positioning', () => {
  beforeEach(() => {
    menuHeight = 40
    resizeCallbacks = []
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('innerHeight', 700)
    vi.stubGlobal('innerWidth', 1000)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => (
      new DOMRect(0, 0, 200, menuHeight)
    ))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('opens below the cursor when it fits', () => {
    const { el } = renderMenu(300)

    expect(el.style.transform).toBe('translate(100px, 308px)')
  })

  test('scrolls instead of growing past the viewport', () => {
    const { el } = renderMenu(300)

    expect(el.style.maxHeight).toBe('calc(100vh - 16px)')
    expect(el.style.overflowY).toBe('auto')
  })

  test('flips above the cursor when it grows past the bottom edge', () => {
    const { el } = renderMenu(500)
    expect(el.style.transform).toBe('translate(100px, 508px)')

    resizeTo(200)

    expect(el.style.transform).toBe('translate(100px, 292px)')
  })

  test('clamps to the top edge when it fits neither below nor above', () => {
    const { el } = renderMenu(500)

    resizeTo(600)

    expect(el.style.transform).toBe('translate(100px, 8px)')
  })

  test('stops observing size changes once the menu closes', () => {
    const { unmount } = renderMenu(300)
    expect(resizeCallbacks).toHaveLength(1)

    unmount()

    expect(resizeCallbacks).toHaveLength(0)
  })
})
