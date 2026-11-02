import { describe, test, expect, afterEach } from 'vitest'
import { createEditor, Node, type Editor } from 'slate'
import * as Y from 'yjs'
import {
  withYjs,
  YjsEditor,
  slateNodesToInsertDelta,
  type YjsEditor as YjsEditorType
} from '@slate-yjs/core'

/**
 * Guards the pnpm patch on @slate-yjs/core (patches/@slate-yjs__core@1.0.2.patch,
 * ELELOG-765).
 *
 * Unpatched, applyDelta reverses a remote event's delta IN PLACE. Yjs computes an
 * event's delta once and hands the same cached array to every observer, so with
 * two editors bound to one shared root the second editor re-reverses the array
 * and applies the change front to back: it consumes the insert before the retain
 * and writes the text at offset 0 instead of where the remote user typed it. The
 * corruption lands in shared, persisted state.
 *
 * These tests bind two editors to one shared root and apply remote changes at
 * NON-ZERO offsets (an offset-0 change produces a one-element delta, and
 * reversing that is a no-op, so such a test passes even when the defect is
 * present). If they fail with the second editor holding text in the wrong order,
 * the patch has stopped applying - do not work around it here; restore the patch.
 */

const connected: YjsEditorType[] = []

afterEach(() => {
  for (const editor of connected.splice(0)) {
    YjsEditor.disconnect(editor)
  }
})

/** One shared doc with a single paragraph, and two editors bound to its root. */
function setup(text: string) {
  const doc = new Y.Doc()
  const root = doc.get('content', Y.XmlText)

  root.applyDelta(
    slateNodesToInsertDelta([
      { id: 'p1', type: 'core/text', class: 'text', children: [{ text }] } as unknown as Node
    ])
  )

  const bind = (): Editor => {
    const editor = withYjs(createEditor(), root, { localOrigin: Symbol('editor') })
    YjsEditor.connect(editor)
    connected.push(editor)
    return editor
  }

  return { doc, editor1: bind(), editor2: bind() }
}

/** Apply `change` to a synced replica and feed the resulting update back. */
function remoteChange(doc: Y.Doc, change: (paragraph: Y.XmlText) => void) {
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))

  const remoteRoot = replica.get('content', Y.XmlText)
  const [first] = remoteRoot.toDelta() as { insert: Y.XmlText }[]
  change(first.insert)

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica, Y.encodeStateVector(doc)))
}

const textOf = (editor: Editor) => editor.children.map((n) => Node.string(n)).join('')

describe('two editors on one shared root receiving remote changes', () => {
  test('a remote insert at a non-zero offset lands at that offset in both editors', () => {
    const { doc, editor1, editor2 } = setup('test')

    remoteChange(doc, (paragraph) => paragraph.insert(2, '9'))

    expect(textOf(editor1)).toBe('te9st')
    expect(textOf(editor2)).toBe('te9st')
  })

  test('a remote insert at the end stays at the end in both editors', () => {
    // Mirrors the live reproduction in ELELOG-765: typing ABC at the end of a
    // field showed CBAtest / tsetABC in other views of the same document.
    const { doc, editor1, editor2 } = setup('test')

    remoteChange(doc, (paragraph) => paragraph.insert(4, 'ABC'))

    expect(textOf(editor1)).toBe('testABC')
    expect(textOf(editor2)).toBe('testABC')
  })

  test('a remote selection replacement lands correctly in both editors', () => {
    const { doc, editor1, editor2 } = setup('abcdef')

    remoteChange(doc, (paragraph) => {
      paragraph.delete(2, 2)
      paragraph.insert(2, 'XY')
    })

    expect(textOf(editor1)).toBe('abXYef')
    expect(textOf(editor2)).toBe('abXYef')
  })

  test('consecutive remote changes do not diverge the editors', () => {
    const { doc, editor1, editor2 } = setup('test')

    remoteChange(doc, (paragraph) => paragraph.insert(4, 'A'))
    remoteChange(doc, (paragraph) => paragraph.insert(5, 'B'))
    remoteChange(doc, (paragraph) => paragraph.delete(0, 1))

    expect(textOf(editor1)).toBe('estAB')
    expect(textOf(editor2)).toBe('estAB')
  })
})
