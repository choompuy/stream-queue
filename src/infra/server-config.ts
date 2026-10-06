import { createConfigModule, rules } from './config-helper.js'
import { dataPath } from './persist.js'

export type ServerConfig = {
  port: number
}

// 4747: not assigned to a well-known service, and below the ranges the OS hands out for temporary connections
// (49152+ on Windows, 32768+ on Linux), so it rarely clashes with anything
export const DEFAULT_PORT = 4747

// Edit data/server.json to change the port; the file also remembers the port the server actually got,
// so the overlay URL in OBS stays the same between launches
export const { getConfig: getServerConfig, updateConfig: updateServerConfig } = createConfigModule<ServerConfig>({
  filePath: () => dataPath('server.json'),
  defaults: { port: DEFAULT_PORT },
  schema: { port: rules.integer(1024, 65535) }
})
