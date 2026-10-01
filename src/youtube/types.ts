export type PlaylistItem = {
  snippet?: {
    resourceId?: {
      videoId?: string
    }
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
  }
}

export type VideoItem = {
  id: string
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
    categoryId?: string
    liveBroadcastContent?: string // 'live' | 'upcoming' | 'none'
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
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: {
      medium?: {
        url?: string
      }
    }
  }
}
