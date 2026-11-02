import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEditor, type Descendant, type Editor, type Element } from 'slate'
import { withHistory } from 'slate-history'
import { pipeFromDrop } from '../lib/utils/pipes'
import type { PluginDefinition, Resource } from '../lib/types'

// Characterization tests: pin the document-level contract of a drop pipe so the
// upcoming ephemeral-state rewrite is provably behaviour-preserving. They assert
// only on editor.children (never on the transient placeholder), so they hold for
// both the current loader-node implementation and the ephemeral one.

const DROP_TYPE = 'application/x-test'

// The consume() behaviour is swapped per test.
let consumeImpl: (input: Resource | Resource[]) => Promise<Resource | undefined>

const resultNode: Element = {
  id: 'result-1',
  type: 'test/result',
  class: 'block',
  children: [{ text: 'RESULT' }]
} as unknown as Element

const testConsumerPlugin: PluginDefinition = {
  class: 'block',
  name: 'test/dropee',
  componentEntry: {
    class: 'block',
    component: () => null
  },
  consumer: {
    consumes: ({ input }) => (input.type === DROP_TYPE ? [true, 'test/result', false] : [false]),
    consume: ({ input }) => consumeImpl(input)
  }
}

function makeEditor(): Editor {
  const editor = withHistory(createEditor())
  editor.children = [
    { id: 'p', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'para' }] } as unknown as Descendant
  ]
  return editor
}

function makeEditorWithBlocks(ids: string[]): Editor {
  const editor = withHistory(createEditor())
  editor.children = ids.map((id) => (
    { id, type: 'core/text', class: 'text', properties: {}, children: [{ text: id }] } as unknown as Descendant
  ))
  return editor
}

function dropEvent(type: string, data: string): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: [type],
      items: [{ kind: 'string', type }],
      getData: (t: string) => (t === type ? data : '')
    }
  } as unknown as React.DragEvent
}

// A drop carrying several dataTransfer entries, as a real in-page drag does:
// the payload plus whatever the browser adds for itself.
function multiDropEvent(entries: { type: string, data: string }[]): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: entries.map((e) => e.type),
      items: entries.map((e) => ({ kind: 'string', type: e.type })),
      getData: (t: string) => entries.find((e) => e.type === t)?.data ?? ''
    }
  } as unknown as React.DragEvent
}

// The pipe fires consume() without awaiting; flush enough microtasks for the
// (synchronously-resolving) mock to settle and the follow-up inserts to run.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

const types = (editor: Editor) => editor.children.map((n) => (n as Element).type)
const blockIds = (editor: Editor) => editor.children.map((n) => (n as Element).id)
const hasPlaceholder = (editor: Editor) => types(editor).includes('core/loader')

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

describe('pipeFromDrop — document contract (characterization)', () => {
  test('successful consume inserts the result at the drop position', async () => {
    consumeImpl = () => Promise.resolve({ source: 'drop', type: 'test/result', data: resultNode })
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent(DROP_TYPE, 'payload'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text', 'test/result'])
    expect(hasPlaceholder(editor)).toBe(false)
  })

  test('consume that throws leaves the document unchanged', async () => {
    consumeImpl = () => Promise.reject(new Error('boom'))
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent(DROP_TYPE, 'payload'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text'])
    expect(hasPlaceholder(editor)).toBe(false)
  })

  test('consume that opts out (undefined) leaves the document unchanged', async () => {
    consumeImpl = () => Promise.resolve(undefined)
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent(DROP_TYPE, 'payload'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text'])
    expect(hasPlaceholder(editor)).toBe(false)
  })

  test('consume returning the wrong produces type is discarded', async () => {
    consumeImpl = () => Promise.resolve({ source: 'drop', type: 'wrong/type', data: resultNode })
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent(DROP_TYPE, 'payload'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text'])
    expect(hasPlaceholder(editor)).toBe(false)
  })
})

describe('pipeFromDrop - browser internal drag types', () => {
  test('a drag carrying the browser own entry inserts without warning', async () => {
    // Chromium attaches chromium/x-drag-id to any drag started in the page, so
    // an image dropped from the image search used to insert correctly and warn
    // about the entry alongside it.
    consumeImpl = () => Promise.resolve({ source: 'drop', type: 'test/result', data: resultNode })
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], multiDropEvent([
      { type: DROP_TYPE, data: 'payload' },
      { type: 'chromium/x-drag-id', data: '1234' }
    ]), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text', 'test/result'])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('a real type nothing consumes still warns', async () => {
    // The message earns its place when a user drops something unhandled.
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent('application/pdf', 'payload'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('application/pdf'))
  })

  test('a drop of nothing but the browser own entry warns about neither', async () => {
    const editor = makeEditor()

    pipeFromDrop(editor, [testConsumerPlugin], dropEvent('chromium/x-drag-id', '1234'), 1)
    await flush()

    expect(types(editor)).toEqual(['core/text'])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('a drop of nothing but the browser own entry still prevents the default handling', async () => {
    const editor = makeEditor()
    const event = dropEvent('chromium/x-drag-id', '1234')

    pipeFromDrop(editor, [testConsumerPlugin], event, 1)
    await flush()

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  test('an internal block move alongside the browser own entry still moves the block', async () => {
    const editor = makeEditorWithBlocks(['a', 'b'])

    pipeFromDrop(editor, [testConsumerPlugin], multiDropEvent([
      { type: 'chromium/x-drag-id', data: '1234' },
      { type: 'textbit/droppable-id', data: 'a' }
    ]), 1)
    await flush()

    expect(blockIds(editor)).toEqual(['b', 'a'])
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
