import { describe, test, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { type PropsWithChildren } from 'react'
import { Node, type Descendant, type Editor } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { handleOnKeyDown } from '../lib/components/TextbitEditable/handleOnKeyDown/handleOnKeyDown'
import { registerActions } from '../lib/contexts/PluginRegistry/lib/registerAction'
import { NonBreakingSpace } from '../lib/components/core/NonBreakingSpace'
import { basePlugins } from '../lib/components/core'

const NBSP = String.fromCharCode(0xa0)

type Modifiers = { ctrlKey?: boolean, shiftKey?: boolean, altKey?: boolean, metaKey?: boolean }

function makeSpaceEvent(modifiers: Modifiers) {
  return {
    key: ' ',
    which: 32,
    keyCode: 32,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
    preventDefault: vi.fn()
  } as unknown as React.KeyboardEvent<HTMLDivElement>
}

function makeEditor(): Editor {
  const content: Descendant[] = [
    { type: 'core/text', class: 'text', id: 'a', properties: {}, children: [{ text: '1000' }] } as Descendant
  ]
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <TextbitRoot value={content} onChange={() => { }}>
        <TextbitEditable>{children}</TextbitEditable>
      </TextbitRoot>
    )
  }
  const { result: { current: editor } } = renderHook(() => useSlateStatic(), { wrapper: Wrapper })
  vi.spyOn(editor, 'onChange').mockImplementation(() => { })
  return editor
}

function select(editor: Editor, anchor: number, focus = anchor) {
  editor.selection = {
    anchor: { path: [0, 0], offset: anchor },
    focus: { path: [0, 0], offset: focus }
  }
}

function pressSpace(editor: Editor, modifiers: Modifiers) {
  const event = makeSpaceEvent(modifiers)
  handleOnKeyDown(editor, registerActions([NonBreakingSpace()]), event, null, () => { }, null, () => { })
  return event
}

describe('NonBreakingSpace', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('Ctrl+Shift+Space inserts a non-breaking space at the caret', () => {
    const editor = makeEditor()
    select(editor, 1)

    const event = pressSpace(editor, { ctrlKey: true, shiftKey: true })

    expect(Node.string(editor.children[0])).toBe(`1${NBSP}000`)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  test('replaces an expanded selection', () => {
    const editor = makeEditor()
    select(editor, 1, 3)

    pressSpace(editor, { ctrlKey: true, shiftKey: true })

    expect(Node.string(editor.children[0])).toBe(`1${NBSP}0`)
  })

  test('ignores other modifier combinations', () => {
    const editor = makeEditor()
    select(editor, 1)

    const events = [
      pressSpace(editor, { ctrlKey: true }),
      pressSpace(editor, { shiftKey: true }),
      pressSpace(editor, { ctrlKey: true, altKey: true }),
      pressSpace(editor, { ctrlKey: true, shiftKey: true, altKey: true })
    ]

    expect(Node.string(editor.children[0])).toBe('1000')
    for (const event of events) {
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
  })

  test('has no hotkey on macOS', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' })

    expect(NonBreakingSpace().actions?.[0].hotkey).toBeUndefined()

    const editor = makeEditor()
    select(editor, 1)
    const event = pressSpace(editor, { ctrlKey: true, shiftKey: true })

    expect(Node.string(editor.children[0])).toBe('1000')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('is a base plugin, loaded whatever plugins the implementor passes', () => {
    expect(basePlugins).toContain(NonBreakingSpace)
  })
})
