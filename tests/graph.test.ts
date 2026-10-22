import { expect, test } from 'vitest'
import { callSiteLines, diffPseudocode, type DiffLine } from '../src/graph.ts'

const groups = (lines: DiffLine[]) => lines.map((line) => line.group)

test('unchanged lines share a group with their exact counterpart', () => {
  const diff = diffPseudocode('a\nb', 'a\nb')
  expect(groups(diff.before)).toEqual(groups(diff.after))
  expect(diff.before[0].group).not.toBe(diff.before[1].group)
})

test('a replacement hunk groups its removed and added lines together', () => {
  const diff = diffPseudocode('a\nold\nz', 'a\nnew1\nnew2\nz')
  expect(diff.before.map((line) => line.type)).toEqual(['unchanged', 'removed', 'unchanged'])
  const hunk = diff.before[1].group
  expect(diff.after[1].group).toBe(hunk)
  expect(diff.after[2].group).toBe(hunk)
  expect(diff.before[0].group).not.toBe(hunk)
  expect(diff.before[2].group).not.toBe(hunk)
  expect(diff.before[2].group).toBe(diff.after[3].group)
})

test('pure insertion and pure deletion form groups with no counterpart', () => {
  const inserted = diffPseudocode('a\nz', 'a\nnew\nz')
  expect(groups(inserted.before)).not.toContain(inserted.after[1].group)

  const deleted = diffPseudocode('a\nold\nz', 'a\nz')
  expect(groups(deleted.after)).not.toContain(deleted.before[1].group)
})

test('separate hunks get separate groups', () => {
  const diff = diffPseudocode('x\na\ny', 'p\na\nq')
  expect(diff.before[0].group).toBe(diff.after[0].group)
  expect(diff.before[2].group).toBe(diff.after[2].group)
  expect(diff.before[0].group).not.toBe(diff.before[2].group)
})

test('trailing changes after the last unchanged line are grouped', () => {
  const diff = diffPseudocode('a\nold', 'a\nnew')
  expect(diff.before[1].group).toBe(diff.after[1].group)
  expect(diff.before[0].group).not.toBe(diff.before[1].group)
})

test('a repeated line pairs with the counterpart the diff aligned it to', () => {
  const diff = diffPseudocode('a\nx\na', 'a\na')
  expect(diff.before[0].group).toBe(diff.after[0].group)
  expect(diff.before[2].group).toBe(diff.after[1].group)
  expect(groups(diff.after)).not.toContain(diff.before[1].group)
})

test('an empty side yields one group covering the populated side', () => {
  const diff = diffPseudocode('', 'a\nb')
  expect(diff.before).toEqual([])
  expect(new Set(groups(diff.after)).size).toBe(1)
  expect(diff.after.map((line) => line.type)).toEqual(['added', 'added'])
})

test('an edited line pairs with its counterpart inside a hunk', () => {
  const diff = diffPseudocode(
    'heading = h()\ntotal = formatTotal(order.subtotal)\nreturn total',
    'heading = h()\ntotal = formatTotal(order.subtotal, order.tax)\nreturn total',
  )
  expect(diff.before[1].pair).not.toBeNull()
  expect(diff.before[1].pair).toBe(diff.after[1].pair)
})

test('unchanged lines pair with their exact counterpart', () => {
  const diff = diffPseudocode('a\nb', 'a\nb')
  expect(diff.before[0].pair).toBe(diff.after[0].pair)
  expect(diff.before[0].pair).not.toBe(diff.before[1].pair)
})

test('a dissimilar replacement stays unpaired but keeps its hunk group', () => {
  const diff = diffPseudocode(
    'a\nlegacyReceipt = chargeCard(customer.card, total)\nz',
    'a\npayment = processPayment(customer, total, retry = false)\nz',
  )
  expect(diff.before[1].pair).toBeNull()
  expect(diff.after[1].pair).toBeNull()
  expect(diff.before[1].group).toBe(diff.after[1].group)
})

test('pairs inside a hunk keep their order', () => {
  const diff = diffPseudocode(
    'a\nfirst = alpha(x)\nsecond = beta(y)\nz',
    'a\nsecond = beta(y, extra)\nfirst = alpha(x, extra)\nz',
  )
  const paired = [...diff.before, ...diff.after].filter((line) => line.type !== 'unchanged' && line.pair != null)
  expect(paired).toHaveLength(2)
})

test('one removed line pairs with the best of several similar added lines', () => {
  const diff = diffPseudocode(
    'a\norder = saveOrder(cart, customer, legacyReceipt)\nz',
    'a\nreceipt = createReceipt(payment, cart, customer)\norder = saveOrder(cart, customer, receipt)\nz',
  )
  expect(diff.before[1].pair).toBe(diff.after[2].pair)
  expect(diff.after[1].pair).toBeNull()
})

test('lines without identifiers never pair by similarity', () => {
  const diff = diffPseudocode('a\n}\nz', 'a\n)\nz')
  expect(diff.before[1].pair).toBeNull()
  expect(diff.after[1].pair).toBeNull()
})

test('call site lines are those mentioning the callee name before its parameter list', () => {
  const lines = ['validateCart(cart)', 'receipt = chargeCard(customer.card, total)', 'return receipt']
  expect(callSiteLines(lines, { id: 'charge-card', name: 'chargeCard(card, amount)' })).toEqual([1])
})

test('call site matching requires the whole identifier', () => {
  const lines = ['legacy = chargeCardLegacy(card)', 'other = prechargeCard(card)', 'done = chargeCard']
  expect(callSiteLines(lines, { id: 'charge-card', name: 'chargeCard(card)' })).toEqual([2])
})

test('a callee name without a parameter list is matched literally', () => {
  const lines = ['charge-card()', 'chargecard()']
  expect(callSiteLines(lines, { id: 'charge-card', name: 'charge-card' })).toEqual([0])
})

test('a method call site matches on the member name', () => {
  const lines = ['self.chargeCard(card)', 'gateway.charge(card)']
  expect(callSiteLines(lines, { id: 'c', name: 'Payments.chargeCard(card)' })).toEqual([0])
})
