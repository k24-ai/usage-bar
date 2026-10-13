import { describe, expect, mock, test } from 'claude-code/testing'
import { summary, untilReset } from './register'

describe('formatting', () => {
  test('reset time', async () => {
    const now = Date.parse('2026-10-14T00:00:00Z')
    expect(untilReset('2026-10-14T02:10:00Z', now)).toBe('resets in 2h 10m')
    expect(untilReset('2026-10-17T05:00:00Z', now)).toBe('resets in 3d 5h')
    expect(untilReset(undefined, now)).toBe('')
  })
  test('summary line', async () => {
    const now = Date.parse('2026-10-14T00:00:00Z')
    expect(summary([
      { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-14T01:30:00Z' },
      { kind: 'seven_day', percentUsed: 17 },
    ], now)).toBe('Session 42% (resets in 1h 30m)  ·  Week 17%')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band on ${surface}`, async ($, on) => {
    mock.clock(on, { now: Date.parse('2026-10-14T00:00:00Z') })
    on('session.measure', ($, e) => ({ changed: e.changed }))
    const toasts: string[] = []
    on('ui.status', () => ({ value: undefined }) as never)
    on('ui.toast', ($, e) => { toasts.push(JSON.stringify(e)); return ({ value: undefined }) as never })
    await $.session.measure({
      context: { percent: 30 } as never,
      rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-14T01:00:00Z' }, { kind: 'seven_day', percentUsed: 40 }],
      changed: ['rateLimits'],
    })
    const ui = await $.ui.mount({
      plugin: 'usage-bar', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, rows: 10, columns: 100 } as never,
    })
    const t = await ui.find({ type: 'Text' })
    expect(t?.text).toContain('Session 92% (resets in 1h 0m)')
    expect(t?.text).toContain('Week 40%')
    expect(t?.text).toContain('Chat context 30%')
    expect(toasts.join()).toContain('Session usage at 92%')
  })
}
