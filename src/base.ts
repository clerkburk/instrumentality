/** Subclass of {@link Error} that represents an error thrown from this library, providing a specific name for easier identification. */
export class InsErr extends Error { override name = "Instrumentality-Error" }




/**
 * Retries a function multiple times with optional error handling and abort signal.
 *
 * @param fn_ - The function to be retried.
 * @param maxAttempts_ - The maximum number of attempts to execute the function.
 * @param cbErr_ - An optional callback function to be executed after each failed attempt.
 * @param abs_ - An optional AbortSignal to abort the retry process.
 * @returns The result of {@link fn_} if it succeeds within the allowed attempts.
 * @throws {unknown} If {@link fn_} fails after the maximum attempts, the last error thrown by {@link fn_} is re-thrown.
 * @throws {InsErr} If the maximum attempts is less than 1 or if the operation is aborted.
 */
export async function retry<T>(fn_: () => T, maxAttempts_: number, cbErr_?: () => unknown, abs_?: AbortSignal): Promise<T> {
  while (--maxAttempts_ >= 0 && !(abs_?.aborted ?? false))
    try {
      return await fn_()
    } catch (err: unknown) {
      if (maxAttempts_ <= 0)
        throw err
      await cbErr_?.()
    }
  if (maxAttempts_ < 0)
    throw new InsErr("Max attempts must be at least 1")
  else
    throw new InsErr("Operation aborted")
}



/**
 * Asynchronously sleep.
 *
 * @param ms_ - The number of milliseconds to sleep.
 * @param abs_ - An optional AbortSignal to abort the sleep.
 * @throws {InsErr} If the sleep is aborted before or during the wait.
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
 * Build a tuple of a specified length.
 *
 * @template N - The desired length of the tuple.
 * @template T - The tuple being built (used for recursion).
 */
type BuildTuple<N extends number, T extends number[] = []> =
  T['length'] extends N ? T : BuildTuple<N, [...T, T['length']]>


/**
 * Add two number types together.
 *
 * @template A - The first number type.
 * @template B - The second number type.
 */
export type Add<A extends number, B extends number> =
  [...BuildTuple<A>, ...BuildTuple<B>]['length']


/**
 * Enumerate numbers from 0 to N-1 as a union type.
 *
 * @template N - The upper limit (exclusive) for the enumeration.
 * @template A - The accumulator array used for recursion.
 */
export type Enumerate<N extends number, A extends number[] = []> =
A['length'] extends N ? A[number] : Enumerate<N, [...A, A['length']]>



/**
 * Wrapper around {@link performance.now}
 *
 * @property {@link rounds} - An array that stores the recorded elapsed times from each round.
 * @property {@link timer} - The initial timestamp when the benchmark was created or last reset.
 * @method {@link round} - Records the current elapsed time and restarts the timer.
 * @method {@link reset} - Resets the benchmark timer to the current time and clears recorded rounds.
 * @accessor {@link y} (years)
 * @accessor {@link mn} (months)
 * @accessor {@link w} (weeks)
 * @accessor {@link d} (days)
 * @accessor {@link h} (hours)
 * @accessor {@link m} (minutes)
 * @accessor {@link s} (seconds)
 * @accessor {@link ms} (milliseconds)
 * @accessor {@link μs} (microseconds)
 * @accessor {@link ns} (nanoseconds)
 * @accessor {@link ps} (picoseconds)
 */
export class Benchmark {
  /** An array that stores the recorded elapsed times from each round (relative to the previous). */
  rounds: number[] = []
  /** The initial timestamp when the benchmark was created or last reset. */
  timer = performance.now()
  /** Records the current elapsed time and restarts the timer. */
  round() { this.rounds.push(this.ms); this.timer = performance.now() }
  /** Resets the benchmark timer to the current time and clears recorded rounds. */
  reset() { this.rounds = []; this.timer = performance.now() }
  /** Elapsed time in years, assuming 12 28-day months per year. */
  get y() { return this.mn / 12 }
  /** Elapsed time in months, assuming each month has 28 days. */
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
export { Benchmark as Bench, Benchmark as Timer, Benchmark as Stopwatch }



/** Compiler sugar to hide mutating methods/properties for read-only operations (no runtime effect). */
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



/** Specific reserved 7-bit values codes that must be escaped when encoding data into base-122, as they are considered illegal in the encoding scheme. */
export const BASE122_ILLEGAL = [0, 10, 13, 34, 38, 92] as const
/** Mapping of illegal ascii codes to their corresponding indices in {@link BASE122_ILLEGAL} (reverse lookup). */
export const BASE122_ILLEGAL_INDEX: Readonly<Record<number, number>> = {
  0: 0,
  10: 1,
  13: 2,
  34: 3,
  38: 4,
  92: 5,
} as const
/** Shortened payload marker used when escaping an illegal 7-bit value and no subsequent 7-bit chunk is available (the current chunk is reused as payload). */
export const BASE122_SHORT = 0b111 as const


/**
 * Encodes indexed data into a base-122 representation.
 *
 * @param data_ - An array-like object containing the data to be encoded.
 * @returns A string representing the base-122 encoded data.
 * @throws If somehow malformed UTF-8 data is generated, the {@link TextDecoder} will throw an error (shouldn't happen if the input is valid).
 * @remarks The high density might not be suitable for all use cases, especially if the medium used to transmit the data has limitations on character sets or encoding.
 * @see {@link TextDecoder} how the output string is generated from the byte array (this step is necessary for accurate translation to a string).
 */
export function encode122(data_: ArrayLike<number>): string {
  const out: number[] = []
  let byteIndex = 0
  let bitIndex = 0

  function next7(): number | undefined {
    if (byteIndex >= data_.length)
      return undefined
    const first = data_[byteIndex]!
    const head = (((0b11111110 >>> bitIndex) & first) << bitIndex) >>> 1
    bitIndex += 7
    if (bitIndex < 8)
      return head
    bitIndex -= 8
    byteIndex++
    if (byteIndex >= data_.length)
      return head
    const tail = ((((0xff00 >>> bitIndex) & data_[byteIndex]!) & 0xff) >>> (8 - bitIndex))
    return head | tail
  }

  for (let value = next7(); value !== undefined; value = next7()) {
    const illegalIndex = BASE122_ILLEGAL_INDEX[value]
    if (illegalIndex === undefined)
      out.push(value)
    else {
      const next = next7()
      const payload = next ?? value
      out.push(
        0b11000010 | ((next === undefined ? BASE122_SHORT : illegalIndex) << 2) | (payload >>> 6),
        0b10000000 | (payload & 0b00111111),
      )
    }
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(out))
}


/**
 * Decodes a base-122 encoded string back into its original byte representation.
 * 
 * @param base122_ - The base-122 encoded string to decode.
 * @returns A Uint8Array containing the original byte data.
 * @throws If an invalid base-122 illegal index is encountered during decoding (shouldn't happen if the input was generated by {@link encode122}).
 */
export function decode122(base122_: string) {
  const out: number[] = []
  let current = 0
  let bitIndex = 0

  function push7(value_: number) {
    let bits = (value_ & 0b01111111) << 1
    current |= bits >>> bitIndex
    bitIndex += 7
    if (bitIndex < 8)
      return
    out.push(current & 0xff)
    bitIndex -= 8
    bits = (bits << (7 - bitIndex)) & 0xff
    current = bits
  }

  for (let i = 0; i < base122_.length; i++) {
    const code = base122_.charCodeAt(i)
    if (code <= 0x7f) {
      push7(code)
      continue
    }
    const illegalIndex = (code >>> 8) & 0b111
    if (illegalIndex < BASE122_ILLEGAL.length)
      push7(BASE122_ILLEGAL[illegalIndex]!)
    else if (illegalIndex !== BASE122_SHORT)
      throw new InsErr(`Invalid base-122 illegal index ${illegalIndex} at position ${i}`)
    push7(code & 0b01111111)
  }

  return Uint8Array.from(out)
}