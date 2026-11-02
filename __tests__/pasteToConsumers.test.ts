import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEditor, Node, type Descendant, type Editor, type Element } from 'slate'
import { pasteToConsumers } from '../lib/utils/pasteToConsumer'
import { withInsertText } from '../lib/with/withInsertText'
import type { PluginDefinition, Resource } from '../lib/types'

const input: Resource = {
  source: 'html',
  type: 'text/html',
  data: 'payload'
}

const resultNode = {
  id: 'result-1',
  type: 'test/result',
  class: 'block',
  children: [{ text: 'RESULT' }]
} as unknown as Element

function makeEditor(): Editor {
  const editor = createEditor()
  editor.children = [
    {
      id: 'p',
      type: 'core/text',
      class: 'text',
      properties: {},
      children: [{ text: '' }]
    } as unknown as Descendant
  ]
  editor.selection = {
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 0 }
  }
  return editor
}

const consumers = (consume: (args: unknown) => Promise<Resource | undefined>) => [{
  consumes: () => [true, 'test/result'] as [boolean, string],
  consume
}]

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

describe('pasteToConsumers', () => {
  test('a throwing consume settles the promise and warns instead of rejecting', async () => {
    // Regression test for ELELOG-902: the paste path had no catch, so a
    // throwing consume left the promise unsettled - the paste was silently
    // discarded and the caller's continuation never ran. The drop path
    // (executePipeItem in pipes.ts) has always handled this; the two gestures
    // must agree.
    const editor = makeEditor()

    const handle = pasteToConsumers(editor, consumers(() => Promise.reject(new Error('boom'))), input)

    await expect(handle).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('boom')
    expect(editor.children).toHaveLength(1)
  })

  test('a successful consume inserts the produced node', async () => {
    const editor = makeEditor()

    const handle = pasteToConsumers(
      editor,
      consumers(() => Promise.resolve({ source: 'html', type: 'test/result', data: resultNode })),
      input
    )

    await expect(handle).resolves.toBeUndefined()
    expect(editor.children.some((n) => (n as Element).type === 'test/result')).toBe(true)
  })

  test('a consume producing text resolves with the text for further handling', async () => {
    const editor = makeEditor()
    const textConsumers = [{
      consumes: () => [true, 'text/plain'] as [boolean, string],
      consume: () => Promise.resolve({ ...input, type: 'text/plain', data: 'transformed' })
    }]

    await expect(pasteToConsumers(editor, textConsumers, input)).resolves.toBe('transformed')
  })

  test('a result of the wrong type warns and resolves without inserting', async () => {
    const editor = makeEditor()

    const handle = pasteToConsumers(
      editor,
      consumers(() => Promise.resolve({ source: 'html', type: 'text/html', data: resultNode })),
      input
    )

    await expect(handle).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(editor.children).toHaveLength(1)
  })

  test('returns false when no consumer accepts the input', () => {
    const editor = makeEditor()
    const noConsumers = [{
      consumes: () => [false] as [boolean],
      consume: () => Promise.resolve(undefined)
    }]

    expect(pasteToConsumers(editor, noConsumers, input)).toBe(false)
  })
})

describe('withInsertText via a throwing consumer', () => {
  // Driven through the real editor.insertText rather than by calling
  // pasteToConsumers and repeating what withInsertText does with the answer.
  // Repeating it would assert that the copy in this file works, and would keep
  // passing if the fallback were taken out of withInsertText itself.
  const throwingPlugin = (message: string) => ([{
    class: 'text',
    name: 'test/throwing',
    consumer: {
      consumes: () => [true, 'test/result'] as [boolean, string],
      consume: () => Promise.reject(new Error(message))
    }
  }] as unknown as PluginDefinition[])

  test('a typed character is still inserted when the consumer throws', async () => {
    // withInsertText routes every typed character through pasteToConsumers,
    // so a consumer that accepts single characters (LocalizedQuotationMarks
    // takes ' " and -) sits on the typing path. Before ELELOG-902 a throwing
    // consume left the promise unsettled, insertText never ran, and the
    // keystroke was lost. It must fall back to the literal character.
    const editor = withInsertText(makeEditor(), throwingPlugin('consumer failed'))

    editor.insertText('"')

    // The insert happens in the promise's continuation, so it lands a tick
    // after the call rather than during it.
    await vi.waitFor(() => {
      expect(Node.string(editor)).toBe('"')
    })
    expect(warnSpy).toHaveBeenCalledWith('consumer failed')
  })

  test('typing keeps working after a consumer has thrown', async () => {
    // The unsettled promise took the keystroke with it and left nothing behind,
    // so the character after it went in as normal and the loss read as a
    // one-off. Typing through the failure is what an editor actually does.
    const editor = withInsertText(makeEditor(), throwingPlugin('consumer failed'))

    editor.insertText('"')
    await vi.waitFor(() => {
      expect(Node.string(editor)).toBe('"')
    })

    editor.insertText('a')
    await vi.waitFor(() => {
      expect(Node.string(editor)).toBe('"a')
    })
  })
})
