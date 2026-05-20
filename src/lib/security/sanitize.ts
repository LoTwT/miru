import DOMPurify from 'dompurify'

import type { TrustedHtml } from '@/types/reader'
import type { Config } from 'dompurify'

const htmlConfig: Config = {
  ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'loading', 'decoding', 'data-src'],
  ADD_URI_SAFE_ATTR: ['target', 'rel', 'referrerpolicy', 'loading', 'decoding'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|data|blob):|[./#]|\/|[^a-z])/i,
}

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (
    node.tagName === 'INPUT'
    && data.attrName === 'type'
    && data.attrValue === 'checkbox'
    && node.classList.contains('task-list-item-checkbox')
  ) {
    data.forceKeepAttr = true
  }
})

export function toTrustedHtml(value: string): TrustedHtml {
  return {
    value: String(DOMPurify.sanitize(value, htmlConfig)),
  } as unknown as TrustedHtml
}
