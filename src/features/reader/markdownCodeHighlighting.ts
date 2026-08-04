interface EnhanceMarkdownCodeBlocksOptions {
  isCurrent?: () => boolean
}

export async function enhanceMarkdownCodeBlocks(
  content: HTMLElement,
  options: EnhanceMarkdownCodeBlocksOptions = {},
): Promise<boolean> {
  const codeBlocks = [...content.querySelectorAll<HTMLElement>('pre:not(.shiki) > code')]
  if (codeBlocks.length === 0) {
    return false
  }

  try {
    const [{ highlightMarkdownCodeFences }, { toTrustedHtml }] = await Promise.all([
      import('@/lib/markdown/syntaxHighlighter'),
      import('@/lib/security/sanitize'),
    ])
    const highlighted = await highlightMarkdownCodeFences(codeBlocks.map((code, index) => ({
      code: code.textContent ?? '',
      index,
      info: getCodeLanguage(code),
    })))

    if (options.isCurrent && !options.isCurrent()) {
      return false
    }

    let changed = false
    for (const [index, code] of codeBlocks.entries()) {
      if (options.isCurrent && !options.isCurrent()) {
        return changed
      }

      const currentPre = code.parentElement
      const highlightedHtml = highlighted.get(index)
      if (!currentPre || currentPre.tagName !== 'PRE' || !currentPre.isConnected || !highlightedHtml) {
        continue
      }

      const template = content.ownerDocument.createElement('template')
      template.innerHTML = toTrustedHtml(highlightedHtml).value
      const highlightedPre = template.content.firstElementChild
      if (!highlightedPre || highlightedPre.tagName !== 'PRE') {
        continue
      }

      currentPre.replaceWith(highlightedPre)
      changed = true
    }

    return changed
  }
  catch {
    return false
  }
}

function getCodeLanguage(code: HTMLElement): string {
  const languageClass = [...code.classList].find(className => className.startsWith('language-'))
  return languageClass?.slice('language-'.length) ?? ''
}
