// One snippet shape: YouTube sends the same object for search results, playlist items and videos.
// Every field is optional, because a part can be missing from the response, and each consumer reads only its own.
export type Snippet = {
  title?: string
  channelTitle?: string
  thumbnails?: {
    medium?: {
      url?: string
    }
  }
  categoryId?: string
  // 'live' | 'upcoming' | 'none'
  liveBroadcastContent?: string
  // playlist items carry the video they point at here
  resourceId?: {
    videoId?: string
  }
}

export type PlaylistItem = {
  snippet?: Snippet
}

export type VideoItem = {
  id: string
  snippet?: Snippet
  topicDetails?: {
    topicCategories?: string[]
  }
  contentDetails?: {
    duration?: string
    regionRestriction?: {
      allowed?: string[]
      blocked?: string[]
    }
    contentRating?: { ytRating?: string } // 'ytAgeRestricted'
  }
  statistics?: {
    viewCount?: string
  }
  status?: {
    embeddable?: boolean
    privacyStatus?: string // 'public' | 'private' | 'unlisted'
    uploadStatus?: string // 'processed' | 'failed' | 'rejected' | 'deleted' | ...
  }
}

export type SearchItem = {
  id?: {
    videoId?: string
  }
  snippet?: Snippet
}
