import net from 'node:net'

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, '127.0.0.1')
  })
}

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort

  while (!(await isPortAvailable(port))) {
    port++
  }

  return port
}
