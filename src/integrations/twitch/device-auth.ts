import { createLogger } from '../../logger.js'
import { AppError } from '../../types.js'
import type { TwitchDeviceCodeResponse, TwitchUserInfo } from './types.js'
import type { TwitchOAuth } from './oauth.js'

const log = createLogger('TWITCH DEVICE AUTH')

export class DeviceAuthorization {
  private oauth: TwitchOAuth
  private onConnected: () => Promise<TwitchUserInfo>
  private promise: Promise<unknown> | null = null
  private generation = 0

  constructor(oauth: TwitchOAuth, onConnected: () => Promise<TwitchUserInfo>) {
    this.oauth = oauth
    this.onConnected = onConnected
  }

  async start(): Promise<TwitchDeviceCodeResponse> {
    if (this.promise) {
      throw new AppError('TWITCH_AUTH_ERROR', 'Twitch authorization is already in progress')
    }

    const device = await this.oauth.requestDeviceCode()
    const generation = ++this.generation

    this.promise = this.oauth
      .pollForToken(device.device_code, device.interval, device.expires_in)
      .then(async () => {
        if (generation !== this.generation) {
          throw new Error('Device authorization was cancelled')
        }
        const userInfo = await this.onConnected!()
        log.log(`Twitch account connected: ${userInfo?.displayName}`)
        return userInfo
      })
      .catch((error) => {
        if (generation === this.generation) log.error(`Twitch authorization failed: ${error instanceof Error ? error.message : error}`)
        else log.log('Twitch authorization was cancelled')
      })
      .finally(() => {
        if (generation === this.generation) this.promise = null
      })

    return device
  }

  cancel(): void {
    this.generation++
    this.promise = null
    log.log('Device authorization cancelled')
  }

  isActive(): boolean {
    return this.promise !== null
  }
}
