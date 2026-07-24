/**
 * Retries a function multiple times with optional error handling and abort signal.
 *
 * @param fn_ - The function to be retried.
 * @param maxAttempts_ - The maximum number of attempts to execute the function.
 * @param _cbErr - An optional callback function to be executed after each failed attempt.
 * @param abs_ - An optional AbortSignal to abort the retry process.
 * @returns The result of the function if it succeeds within the allowed attempts.
 * @throws If the maximum number of attempts is exceeded or if the operation is aborted.
 */
export async function retry<T>(fn_: () => T, maxAttempts_: number, _cbErr?: () => unknown, abs_?: AbortSignal): Promise<T> {
  while (--maxAttempts_ >= 0 && !(abs_?.aborted ?? false))
    try {
      return await fn_()
    } catch (err: unknown) {
      if (maxAttempts_ === 0)
        throw err
      await _cbErr?.()
    }
  if (maxAttempts_ < 0)
    throw new InsErr("Max attempts exceeded")
  else
    throw new InsErr("Operation aborted")
}



/**
 * Asynchronously sleeps for a specified duration, with optional abort signal support.
 *
 * @param ms_ - The number of milliseconds to sleep.
 * @param abs_ - An optional AbortSignal to abort the sleep.
 * @returns A Promise that resolves after the specified duration or rejects if aborted.
 */
export async function sleep(ms_: number, abs_?: AbortSignal): Promise<void> {
  if (abs_?.aborted)
    return Promise.reject(new InsErr("Sleep aborted before start"))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      abs_?.removeEventListener("abort", onAbort)
      resolve()
    }, ms_)

    function onAbort() {
      clearTimeout(timeout)
      abs_?.removeEventListener("abort", onAbort)
      reject(new InsErr("Sleep aborted during wait"))
    }
    abs_?.addEventListener("abort", onAbort, { once: true })
  })
}



/**
 * Helper type to build a tuple of a specified length.
 *
 * @template N - The desired length of the tuple.
 * @template T - The tuple being built (used for recursion).
 */
type BuildTuple<N extends number, T extends number[] = []> =
  T['length'] extends N ? T : BuildTuple<N, [...T, T['length']]>


/**
 * Helper type to add two number types together.
 *
 * @template A - The first number type.
 * @template B - The second number type.
 */
export type Add<A extends number, B extends number> =
  [...BuildTuple<A>, ...BuildTuple<B>]['length']


/**
 * Helper type to enumerate numbers from 0 to N-1.
 *
 * @template N - The upper limit (exclusive) for the enumeration.
 * @template A - The accumulator array used for recursion.
 */
export type Enumerate<N extends number, A extends number[] = []> =
A['length'] extends N ? A[number] : Enumerate<N, [...A, A['length']]>



/**
 * A benchmarking class that provides various time units for measuring elapsed time.
 *
 * The class starts a timer upon instantiation and provides properties to access the elapsed time in different units (milliseconds, seconds, minutes, etc.).
 * The `round` method can be called to record the current elapsed time and restart the timer.
 *
 * @property {@link rounds} - An array that stores the recorded elapsed times from each round.
 * @property {@link timer} - The initial timestamp when the benchmark was created or last reset.
 * @method {@link round} - Records the current elapsed time and restarts the timer.
 * @method {@link reset} - Resets the benchmark timer to the current time and clears recorded rounds.
 * @accessor {@link y} - Elapsed time in years (assuming 365.25 days per year).
 * @accessor {@link mn} - Elapsed time in months (assuming 30.44 days per month).
 * @accessor {@link w} - Elapsed time in weeks.
 * @accessor {@link d} - Elapsed time in days.
 * @accessor {@link h} - Elapsed time in hours.
 * @accessor {@link m} - Elapsed time in minutes.
 * @accessor {@link s} - Elapsed time in seconds.
 * @accessor {@link ms} - Elapsed time in milliseconds.
 * @accessor {@link μs} - Elapsed time in microseconds.
 * @accessor {@link ns} - Elapsed time in nanoseconds.
 * @accessor {@link ps} - Elapsed time in picoseconds.
 */
export class Benchmark {
  /** An array that stores the recorded elapsed times from each round. */
  rounds: number[] = []
  /** Initializes the benchmark timer to the current time using `performance.now()`. */
  timer = performance.now()
  /** Records the current elapsed time and restarts the timer. */
  round() { this.rounds.push(this.ms); this.timer = performance.now() }
  /** Resets the benchmark timer to the current time and clears recorded rounds. */
  reset() { this.rounds = []; this.timer = performance.now() }
  /** Elapsed time in years (assuming 365.25 days per year). */
  get y() { return this.mn / 12 }
  /** Elapsed time in months (assuming 30.44 days per month). */
  get mn() { return this.w / 4 }
  /** Elapsed time in weeks. */
  get w() { return this.d / 7 }
  /** Elapsed time in days. */
  get d() { return this.h / 24 }
  /** Elapsed time in hours. */
  get h() { return this.m / 60 }
  /** Elapsed time in minutes. */
  get m() { return this.s / 60 }
  /** Elapsed time in seconds. */
  get s() { return this.ms / 1000 }
  /** Elapsed time in milliseconds. */
  get ms() { return performance.now() - this.timer }
  /** Elapsed time in microseconds. */
  get μs() { return this.ms * 1e3 }
  /** Elapsed time in nanoseconds. */
  get ns() { return this.μs * 1e3 }
  /** Elapsed time in picoseconds. */
  get ps() { return this.ns * 1e3 }
}



/**
 * Helper type that represents a view of a Uint8Array, exposing only view methods and properties, along with a readonly index signature for accessing elements.
 */
export type Uint8ArrayView = Pick<Uint8Array,
  | "at"
  | "includes"
  | "indexOf"
  | "lastIndexOf"
  | "find"
  | "findIndex"
  | "findLast"
  | "findLastIndex"
  | "every"
  | "some"
  | "forEach"
  | "entries"
  | "keys"
  | "values"
  | typeof Symbol.iterator
  | "reduce"
  | "reduceRight"
  | "join"
  | "toLocaleString"
  | "toString"
  | "map"
  | "filter"
  | "slice"
  | "toReversed"
  | "toSorted"
  | "with"
  | "length"
  | "byteLength"
  | "byteOffset"
> & { readonly [n: number]: number }



/**
 * The default character set used for generating random strings, consisting all safe characters for URLs and file names, excluding special characters.
 */
export const SAFE_ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" as const 
/**
 * Extension of {@link SAFE_ASCII} that includes additional special characters that can be printed but not safely used in URLs or file names, such as whitespace and certain punctuation marks.
 */
export const DEFAULT_ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!@#$%^&*()[]{}|;:,.<>?/~`+=\\\"' " as const


/**
 * Generate a random combination of characters from a given character set.
 *
 * @param length_ - The length of the random string to generate.
 * @param charset_ - A string containing the set of characters to choose from. Defaults to {@link DEFAULT_ASCII}.
 * @returns A random string of the specified length composed of characters from the provided character set.
 * @throws If {@link length_} is not a non-negative finite number.
*/
export function randStr(length_: number, charset_: string  = DEFAULT_ASCII): string {
  if (!Number.isFinite(length_) || length_ < 0)
    throw new InsErr("Length must be a valid non-negative finite number")
  const charsetLength = charset_.length
  if (charsetLength === 0)
    return ""
  let result = ""
  for (let i = 0; i < length_; i++)
    result += charset_[Math.floor(Math.random() * charsetLength)]
  return result
}



/**
 * Subclass of {@link Error} that represents an error thrown from this library, providing a specific name for easier identification.
 */
export class InsErr extends Error { override name = "Instrumentality-Error" }