export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ISO 8601 duration as YouTube sends it: "PT4M13S", "PT1H", "P1DT2H", and "P0D" for a live stream or a premiere that has no length yet.
// Anything that is not a duration is Infinity (unknown, so out of any allowed range)
export function isoDurationToSeconds(value = ''): number {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)

  if (!match || value === 'P' || value.endsWith('T')) {
    return Infinity
  }

  const [, days, hours, minutes, seconds] = match
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
}

export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`
  return views.toString()
}
