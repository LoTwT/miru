const searchMatchSelector = 'mark[data-reader-search-match]'
const skippedSearchContentSelector = `button, script, style, svg, ${searchMatchSelector}`

export function highlightMarkdownSearchMatches(content: HTMLElement, query: string): HTMLElement[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  const ownerDocument = content.ownerDocument
  const queryLower = normalizedQuery.toLocaleLowerCase()
  const walker = ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || shouldSkipSearchNode(parent) || !node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT
      }

      return node.nodeValue.toLocaleLowerCase().includes(queryLower)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  const textNodes: Text[] = []
  let node = walker.nextNode()

  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  return textNodes.flatMap(textNode => highlightTextNode(textNode, normalizedQuery, queryLower))
}

export function clearMarkdownSearchHighlights(content: HTMLElement): void {
  const parents = new Set<Node>()

  for (const mark of content.querySelectorAll<HTMLElement>(searchMatchSelector)) {
    const parent = mark.parentNode
    if (parent) {
      parents.add(parent)
    }
    mark.replaceWith(content.ownerDocument.createTextNode(mark.textContent ?? ''))
  }

  for (const parent of parents) {
    parent.normalize()
  }
}

export function updateActiveMarkdownSearchMatch(
  matches: readonly HTMLElement[],
  previousIndex: number,
  nextIndex: number,
): void {
  if (previousIndex !== nextIndex) {
    matches[previousIndex]?.classList.remove('reader-search-match--active')
  }
  matches[nextIndex]?.classList.add('reader-search-match--active')
}

function highlightTextNode(node: Text, query: string, queryLower: string): HTMLElement[] {
  const text = node.nodeValue ?? ''
  const textLower = text.toLocaleLowerCase()
  const fragment = node.ownerDocument.createDocumentFragment()
  const matches: HTMLElement[] = []
  let cursor = 0
  let index = textLower.indexOf(queryLower)

  while (index !== -1) {
    if (index > cursor) {
      fragment.append(node.ownerDocument.createTextNode(text.slice(cursor, index)))
    }

    const mark = node.ownerDocument.createElement('mark')
    mark.className = 'reader-search-match'
    mark.dataset.readerSearchMatch = ''
    mark.textContent = text.slice(index, index + query.length)
    fragment.append(mark)
    matches.push(mark)

    cursor = index + query.length
    index = textLower.indexOf(queryLower, cursor)
  }

  if (cursor < text.length) {
    fragment.append(node.ownerDocument.createTextNode(text.slice(cursor)))
  }

  node.replaceWith(fragment)
  return matches
}

function shouldSkipSearchNode(element: HTMLElement): boolean {
  return element.closest(skippedSearchContentSelector) !== null
}
