import type { Page } from '@playwright/test'

interface SimplePdfPageInput {
  height?: number
  text: string
  width?: number
}

export async function openFileThroughFloatingMenu(
  page: Page,
  file: { name: string, mimeType: string, buffer: Buffer },
): Promise<void> {
  await page.getByTestId('floating-affordance-button').click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /打开文件/ }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(file)
}

export function createSimplePdfBuffer(text: string | Array<string | SimplePdfPageInput>): Buffer {
  const pages = (Array.isArray(text) ? text : [text]).map((page): Required<SimplePdfPageInput> => {
    if (typeof page === 'string') {
      return { height: 792, text: page, width: 612 }
    }

    return {
      height: page.height ?? 792,
      text: page.text,
      width: page.width ?? 612,
    }
  })
  const pageObjectOffset = 4
  const contentObjectOffset = pageObjectOffset + pages.length
  const kids = pages.map((_, index) => `${pageObjectOffset + index} 0 R`).join(' ')
  const streams = pages.map(page => `BT /F1 24 Tf 72 ${Math.max(72, page.height - 72)} Td (${escapePdfText(page.text)}) Tj ET`)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ...pages.map((page, index) =>
      `${pageObjectOffset + index} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectOffset + index} 0 R >>\nendobj\n`,
    ),
    ...streams.map((stream, index) =>
      `${contentObjectOffset + index} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    ),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf)
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}
