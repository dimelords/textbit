import type { PluginInitFunction } from '../../types'
import { isMac } from '../../utils/modifier'

// Non-breaking space (U+00A0). Built from its char code so the source stays
// readable, a literal one looks just like a regular space.
const NBSP = String.fromCharCode(0xa0)

/**
 * Insert a non-breaking space with Ctrl+Shift+Space, the shortcut Word uses.
 *
 * No hotkey on macOS, where Option+Space already types a non-breaking space
 * and the OS should keep its own shortcuts.
 */
export const NonBreakingSpace: PluginInitFunction = () => {
  return {
    class: 'generic',
    name: 'non-breaking-space',
    actions: [
      {
        name: 'insert',
        hotkey: isMac() ? undefined : 'ctrl+shift+space',
        handler: ({ editor, event }) => {
          event?.preventDefault()
          editor.insertText(NBSP)
        }
      }
    ]
  }
}
