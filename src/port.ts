import net from 'node:net'

// Checks the port the way the server will listen on it: without a host, so on every interface.
// Checking only 127.0.0.1 let a foreign process on 0.0.0.0:<port> pass the check and then make listen() fail
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port)
  })
}

export async function findAvailablePort(startPort: number, maxPort = 65535): Promise<number> {
  let port = startPort

  while (port <= maxPort && !(await isPortAvailable(port))) {
    port++
  }

  if (port > maxPort) {
    throw new Error(`No available port found in range ${startPort}-${maxPort}`)
  }

  return port
}
