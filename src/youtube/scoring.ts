import { Song } from '../types.js'

const SCORE = {
  EXACT_MATCH: 1500,
  CONTAINS_QUERY: 1000,
  ALL_WORDS_PRESENT: 700,
  PER_MATCHED_WORD: 180,
  PARTIAL_WORD_BONUS: 40,
  VERSION_PENALTY: 220,
  OFFICIAL_CHANNEL_BONUS: 50
} as const

const OFFICIAL_CHANNEL_KEYWORDS = ['official', 'topic', 'vevo']

// Words that usually mark a title as a *different version* of a song rather than the song itself. Only
// penalized when the query itself does not ask for that version - someone searching "song remix" should
// still find the remix
const VERSION_KEYWORDS = [
  'remix',
  'mashup',
  'bootleg',
  'edit',
  'rework',
  'flip',
  'cover',
  'tribute',
  'karaoke',
  'instrumental',
  'acapella',
  'nightcore',
  'sped',
  'slowed',
  'reverb',
  'live',
  'acoustic',
  'unplugged',
  'remaster',
  'remastered',
  'extended',
  '8bit',
  'chipmunk',
  'reaction',
  'react',
  'reacting',
  'tutorial',
  'lesson',
  'review',
  'lyrics',
  'lyric'
]
const VERSION_KEYWORD_SET = new Set(VERSION_KEYWORDS)
// "8-bit" normalizes to two words ("8", "bit"); treat that pair as a single unit like the rest of the list
const VERSION_KEYWORD_PAIRS: Array<[string, string]> = [
  ['8', 'bit'],
  ['lo', 'fi'],
  ['chill', 'out'],
  ['space', 'out']
]

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isoDurationToSeconds(value = ''): number {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)

  if (!match) {
    return Infinity
  }

  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

function unrequestedVersionWordCount(titleWords: string[], queryWordSet: Set<string>): number {
  let count = 0
  let skipNext = false

  for (let i = 0; i < titleWords.length; i++) {
    if (skipNext) {
      skipNext = false
      continue
    }

    const word = titleWords[i]
    const next = titleWords[i + 1]
    const pairMatch = next && VERSION_KEYWORD_PAIRS.some(([a, b]) => a === word && b === next)

    if (pairMatch) {
      if (!queryWordSet.has(word) || !queryWordSet.has(next!)) count++
      skipNext = true
      continue
    }

    if (VERSION_KEYWORD_SET.has(word) && !queryWordSet.has(word)) count++
  }

  return count
}

function titleScore(title: string, query: string, channelTitle?: string): number {
  const normalizedTitle = normalize(title)
  const normalizedQuery = normalize(query)

  if (!normalizedTitle || !normalizedQuery) {
    return 0
  }

  const titleWords = normalizedTitle.split(' ')
  const queryWords = normalizedQuery.split(' ')
  const queryWordSet = new Set(queryWords)
  const meaningfulWords = queryWords.filter((word) => word.length >= 2)
  const versionPenalty = unrequestedVersionWordCount(titleWords, queryWordSet) * SCORE.VERSION_PENALTY

  const coverage = normalizedQuery.length / normalizedTitle.length
  const normalizedChannel = channelTitle ? normalize(channelTitle) : ''
  const isOfficialChannel = normalizedChannel !== '' && OFFICIAL_CHANNEL_KEYWORDS.some((keyword) => normalizedChannel.includes(keyword))
  const channelBonus = isOfficialChannel ? SCORE.OFFICIAL_CHANNEL_BONUS : 0

  if (normalizedTitle === normalizedQuery) {
    return SCORE.EXACT_MATCH - versionPenalty + channelBonus
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return SCORE.CONTAINS_QUERY * coverage - versionPenalty + channelBonus
  }

  const titleWordSet = new Set(titleWords)
  const channelWordSet = isOfficialChannel ? new Set(normalizedChannel.split(' ')) : new Set()
  const isWordMatched = (word: string) => titleWordSet.has(word) || channelWordSet.has(word)
  const matchedWords = meaningfulWords.filter(isWordMatched).length
  const allWordsPresent = meaningfulWords.length > 0 && matchedWords === meaningfulWords.length

  if (allWordsPresent) {
    return SCORE.ALL_WORDS_PRESENT * coverage - versionPenalty + channelBonus
  }

  let score = matchedWords * SCORE.PER_MATCHED_WORD

  for (const word of meaningfulWords) {
    if (normalizedTitle.includes(word)) {
      score += SCORE.PARTIAL_WORD_BONUS
    }
  }

  return score - versionPenalty + channelBonus
}

function popularityScore(views: number): number {
  return Math.log10(views + 1) * 50
}

function durationScore(duration: number): number {
  if (duration >= 150 && duration <= 420) {
    return 100
  }

  if (duration < 150) {
    return Math.max(0, 100 - (150 - duration) * 0.5)
  }

  return Math.max(0, 100 - (duration - 420) * 0.5)
}

function relevanceScore(rank: number | undefined, totalCandidates: number): number {
  if (rank === undefined) return 0
  return Math.max(0, 100 - (rank / totalCandidates) * 100)
}

export function combinedScore(song: Song, query: string, relevanceRank?: number, totalCandidates = 20): number {
  return (
    titleScore(song.title, query, song.channelTitle) +
    popularityScore(song.views) +
    durationScore(song.duration) +
    relevanceScore(relevanceRank, totalCandidates)
  )
}

export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`
  return views.toString()
}
