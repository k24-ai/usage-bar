import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-bar', key: 'limits' } as const, [] as Limit[])
const contextPercent = atom({ plugin: 'usage-bar', key: 'contextPercent' } as const, null as number | null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)

const NAMES: Record<string, string> = { five_hour: 'Session', seven_day: 'Week' }

export function label(kind: string): string {
  return NAMES[kind] ?? kind.replace(/_/g, ' ')
}

export function untilReset(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - nowMs
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

export function summary(ls: Limit[], nowMs: number): string {
  return ls
    .map(l => {
      const r = untilReset(l.resetsAt, nowMs)
      return `${label(l.kind)} ${Math.round(l.percentUsed)}%${r ? ` (${r})` : ''}`
    })
    .join('  ·  ')
}

const WARN_AT = [80, 90, 100]

const warned: Record<string, number> = {}

async function apply($: EngineInterface, ls: Limit[], ctx: number | null) {
  await update($, limits, () => ls)
  await update($, contextPercent, () => ctx)
  const now = await $.clock.now()
  $.ui.status(ls.length ? summary(ls, now) : undefined)
  for (const l of ls) {
    const level = WARN_AT.filter(t => l.percentUsed >= t).pop() ?? 0
    if (level > (warned[l.kind] ?? 0)) {
      warned[l.kind] = level
      $.ui.toast(`${label(l.kind)} usage at ${Math.round(l.percentUsed)}%`)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-bar', description: 'Show or hide the plan usage bar' })
    const r = await next(e)
    try {
      const u = await $.session.usage()
      await apply($, u.rateLimits ?? [], u.context?.percent ?? null)
    } catch (err) {
      $.ui.toast(`usage-bar could not read usage: ${String(err)}`)
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    await apply($, e.rateLimits ?? [], e.context?.percent ?? null)
    return next(e)
  })

  on('command.run', { name: 'usage-bar' }, async ($) => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)
    return { text: hidden ? 'Usage bar shown.' : 'Usage bar hidden. Run /usage-bar again to show it.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ls = await read($, limits)
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const ctx = await read($, contextPercent)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    if (ls.length === 0) {
      return (
        <Box>
          <Text dimColor>Usage: waiting for the first reading{ctx !== null ? `  ·  Chat context ${Math.round(ctx)}%` : ''}</Text>
        </Box>
      )
    }
    const worst = Math.max(...ls.map(l => l.percentUsed))
    const color = worst >= 90 ? 'error' : worst >= 75 ? 'warning' : undefined
    return (
      <Box>
        <Text color={color} dimColor={!color}>
          {summary(ls, now)}
          {ctx !== null ? `  ·  Chat context ${Math.round(ctx)}%` : ''}
        </Text>
      </Box>
    )
  })
}
