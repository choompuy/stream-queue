// What the process is told from outside. The executable has no .env file next to it, so the values it needs are baked
// in when it is built (scripts/build-sea.mjs): the environment wins, the baked value is the fallback
declare const __BAKED_ENV__: Record<string, string> | undefined

const baked = (key: string): string => (typeof __BAKED_ENV__ !== 'undefined' ? __BAKED_ENV__[key] : '')

export const getTwitchClientId = (): string => process.env.TWITCH_CLIENT_ID?.trim() || baked('TWITCH_CLIENT_ID') || ''
