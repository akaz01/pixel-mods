import { expect, test } from 'claude-code/testing'
import { bubbleParts, hasFiveLimit, modelName, phaseOf, restWord, stateRoom } from '../hooks/view'

const PANE_PROPS = {
  title: 'Work Board',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('the board draws on the terminal', async $ => {
  const ui = await $.ui.mount({ plugin: 'work-board', surface: 'terminal', component: 'Pane', requestId: 'work-board', props: PANE_PROPS } as never)
  expect(await ui.find({ type: 'Text', text: /WORK-BOARD/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /RUNNING/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /STATUS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CLAUDE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PLAN/ })).toBeDefined()
  await ui.unmount()
})

test('every tab draws', async $ => {
  const ui = await $.ui.mount({ plugin: 'work-board', surface: 'terminal', component: 'Pane', requestId: 'work-board', props: PANE_PROPS } as never)
  for (const key of ['tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6', 'tab-1']) {
    await ui.press({ key })
    expect(await ui.find({ type: 'Text', text: /WORK-BOARD/ })).toBeDefined()
  }
  await ui.unmount()
})

test('the state icon follows the phase of the work', () => {
  const step = (tool: string, target: string, status: 'running' | 'done') => ({ id: tool, tool, target, at: 0, status })
  expect(phaseOf([])).toBe('THINKING')
  expect(phaseOf([step('TodoWrite', '', 'running')])).toBe('PLANNING')
  expect(phaseOf([step('Edit', 'view.tsx', 'running')])).toBe('CODING')
  expect(phaseOf([step('Bash', 'claude plugin test', 'running')])).toBe('TESTING')
  expect(phaseOf([step('Read', 'a.ts', 'done')])).toBe('WRAPPING')
})

test('the idle bubble always says something: HELLO, how the turn ended, READY, SLEEPING', () => {
  const turn = (status: 'done' | 'aborted' | 'error') => ({ id: 't', at: 0, prompt: '', ms: 1000, tools: [], steps: [], blocked: 0, status })
  expect(restWord(turn('done'), 5000)).toBe('DONE')
  expect(restWord(turn('aborted'), 5000)).toBe('STOPPED')
  expect(restWord(turn('error'), 5000)).toBe('FAILED')
  expect(restWord(turn('done'), 61_000)).toBe('READY')
  expect(restWord(turn('done'), 31 * 60_000)).toBe('SLEEPING')
  expect(restWord(undefined, 0)).toBe('HELLO!')
})

test('the bubble holds the word exactly in its middle, its edges as wide as its body', () => {
  for (const word of ['DONE', 'CODING', 'RUNNING', 'WRAPPING', 'THINKING']) {
    const parts = bubbleParts(word, 40)
    if (!parts) throw new Error('no bubble')
    const { top, body, bottom, width } = parts
    expect(top.length).toBe(body.length + 2)
    expect(bottom.length).toBe(body.length + 2)
    expect(width).toBe(body.length + 3)
    expect(body.indexOf(word)).toBe(body.length - word.length - body.indexOf(word))
  }
})
test('the bubble is left out when the board has no room for it', () => {
  expect(stateRoom(68, 17)).toBeGreaterThanOrEqual(14)
  expect(stateRoom(40, 17)).toBeLessThan(14)
})
test('the model line names the main model with its version', () => {
  expect(modelName('claude-opus-5-5')).toBe('OPUS 5.5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('SONNET 4.5')
  expect(modelName('claude-haiku-5-5[1m]')).toBe('HAIKU 5.5')
  expect(modelName(undefined)).toBe('—')
})

test('the mod tells a plan without a 5-hour limit by its name or its readings', () => {
  expect(hasFiveLimit('Ultra', { five: {}, weekly: {} })).toBe(false)
  expect(hasFiveLimit('Max', { weekly: {} })).toBe(false)
  expect(hasFiveLimit('Max', { five: {}, weekly: {} })).toBe(true)
  expect(hasFiveLimit(undefined, {})).toBe(true)
})

test('the bubble shrinks to the room it has, and gives way to the bare word when none fits', () => {
  expect(bubbleParts('RUNNING', 40)?.width).toBe(14)
  expect(bubbleParts('RUNNING', 13)?.width).toBe(12)
  expect(bubbleParts('RUNNING', 10)).toBeUndefined()
})
