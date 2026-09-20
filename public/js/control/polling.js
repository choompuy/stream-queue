export function createPoller(tasks, { shouldRun = () => true } = {}) {
  const timers = []
  const running = new Set()

  function start() {
    if (timers.length) return

    for (const task of tasks) {
      timers.push(
        setInterval(async () => {
          if (!shouldRun() || running.has(task)) return

          running.add(task)
          try {
            await task.run()
          } finally {
            running.delete(task)
          }
        }, task.every)
      )
    }
  }

  function stop() {
    timers.forEach(clearInterval)
    timers.length = 0
  }

  return { start, stop }
}
