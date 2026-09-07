import { expect, type Locator } from '@playwright/test'
import { CHART_SVG } from './browser'

export async function assertLabelGeometry(region: Locator) {
  const problems = await region.locator(CHART_SVG).evaluateAll(svgs => {
    const failures: string[] = []
    const tolerance = 1.5
    const contains = (outer: DOMRect, inner: DOMRect) => inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance
    const overlaps = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance
    for (const svg of svgs) {
      const viewport = svg.getBoundingClientRect()
      const texts = Array.from(svg.querySelectorAll('text')).filter(text => {
        const box = text.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && getComputedStyle(text).visibility !== 'hidden'
      })
      for (const text of texts) {
        const box = text.getBoundingClientRect()
        if (!contains(viewport, box)) failures.push(`SVG-clipped label: ${text.textContent}`)
        for (let parent = svg.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          const clipX = /hidden|clip|auto|scroll/.test(style.overflowX)
          const clipY = /hidden|clip|auto|scroll/.test(style.overflowY)
          const parentBox = parent.getBoundingClientRect()
          if ((clipX && (box.left < parentBox.left - tolerance || box.right > parentBox.right + tolerance)) || (clipY && (box.top < parentBox.top - tolerance || box.bottom > parentBox.bottom + tolerance))) {
            failures.push(`Ancestor-clipped label: ${text.textContent}`)
            break
          }
        }
      }
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        if (overlaps(texts[i].getBoundingClientRect(), texts[j].getBoundingClientRect())) failures.push(`Labels overlap: ${texts[i].textContent} / ${texts[j].textContent}`)
      }
      const markers = Array.from(svg.querySelectorAll('[data-extreme]'))
      const boxes = markers.map(marker => marker.querySelector('rect')!.getBoundingClientRect())
      markers.forEach((marker, index) => {
        const text = marker.querySelector('text')!
        if (!contains(boxes[index], text.getBoundingClientRect())) failures.push(`Extreme label overflows its box: ${text.textContent}`)
        if (!contains(viewport, boxes[index])) failures.push(`Extreme box clipped: ${text.textContent}`)
        for (const other of texts.filter(label => !marker.contains(label))) {
          if (overlaps(boxes[index], other.getBoundingClientRect())) failures.push(`Extreme box occludes label: ${other.textContent}`)
        }
      })
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i], boxes[j])) failures.push('Extreme label boxes overlap')
      }
    }
    return failures
  })
  expect.soft(problems, 'Chart text must remain legible, unclipped and non-overlapping').toEqual([])
}

export async function assertFiniteGeometry(region: Locator) {
  const invalid = await region.locator('path,polyline').evaluateAll(elements => elements.flatMap(element => {
    const geometry = element.getAttribute('d') ?? element.getAttribute('points') ?? ''
    return /NaN|Infinity|undefined/.test(geometry) ? [geometry] : []
  }))
  expect(invalid, 'No invalid chart coordinates').toEqual([])
}
