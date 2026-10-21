// Runs the task one at a time. A request that comes while it is running makes it run once more afterwards,
// so the last thing shown is always the answer to the last request, never an older one that arrived late.
// Every caller gets the promise of the run that is going on. A failed run does not drop a request that came during it:
// the task runs again, and the promise is rejected only if the last run failed
export function serialized(task) {
  let current = null
  let again = false

  return () => {
    if (current) {
      again = true
      return current
    }

    current = (async () => {
      try {
        let failure = null

        do {
          again = false

          try {
            await task()
            failure = null
          } catch (error) {
            failure = { error }
          }
        } while (again)

        if (failure) throw failure.error
      } finally {
        current = null
      }
    })()

    return current
  }
}
