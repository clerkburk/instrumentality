/// <reference types="node" />
import * as v from "vitest"
import * as bs from "../src/base.ts"




v.describe("InsErr", () => {
  v.it("creates instances of InsErr and its subclasses with the correct properties", () => {
    const error = new bs.InsErr("Something went wrong")

    v.expect(error).toBeInstanceOf(Error)
    v.expect(error).toBeInstanceOf(bs.InsErr)
    v.expect(error.name).toBe("Instrumentality-Error")
    v.expect(error.message).toBe("Something went wrong")

    class CustomNamelessError extends bs.InsErr {}

    const customError = new CustomNamelessError("Custom error message")
    v.expect(customError).toBeInstanceOf(Error)
    v.expect(customError).toBeInstanceOf(bs.InsErr)
    v.expect(customError).toBeInstanceOf(CustomNamelessError)
    v.expect(customError.name).toBe("Instrumentality-Error")
    v.expect(customError.message).toBe("Custom error message")

    class CustomNamedError extends bs.InsErr { override name = "CustomNamedError" }

    const customNamedError = new CustomNamedError("Custom named error message")
    v.expect(customNamedError).toBeInstanceOf(Error)
    v.expect(customNamedError).toBeInstanceOf(bs.InsErr)
    v.expect(customNamedError).toBeInstanceOf(CustomNamedError)
    v.expect(customNamedError.name).toBe("CustomNamedError")
    v.expect(customNamedError.message).toBe("Custom named error message")
  })
})



v.describe("retry", () => {
  class Err extends bs.InsErr { override name = "RetryError" }


  v.it("retries a function the specified number of times", async () => {
    let attempt = 0
    const fn = async () => {
      attempt++
      if (attempt < 3) throw new Err("Fail")
      return "Success"
    }

    v.expect(await bs.retry(fn, 3)).toBe("Success")
    v.expect(attempt).toBe(3)
  }),


  v.it("throws an error if the function fails after the specified number of retries", async () => {
    let attempt = 0
    const fn = () => { attempt++; throw new Err("Fail") }

    await v.expect(bs.retry(fn, 3)).rejects.toMatchObject({ name: "RetryError", message: "Fail" })
    v.expect(attempt).toBe(3)
  }),


  v.it("throws if max attempts is an invalid number", async () => {
    let attempt = 0
    function fn() { attempt++; return "Success" }

    await v.expect(bs.retry(fn, 0)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, -1)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, NaN)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, null as any)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, undefined as any)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, "invalid" as any)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, {} as any)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, [] as any)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })
    await v.expect(bs.retry(fn, Infinity)).rejects.toMatchObject({ name: "Instrumentality-Error", message: "Max attempts isn't a positive integer" })

    v.expect(attempt).toBe(0)
  }),
  

  v.it("cbErr_ should be called when an error occurs", async () => {
    let attempt = 0
    let cbErrCalled = false
    const fn = async () => {
      attempt++
      if (attempt < 3) throw new Err("Fail")
      return "Success"
    }
    const cbErr = (err: unknown, remainingAttempts: number) => {
      cbErrCalled = true
      v.expect(err).toMatchObject({ name: "RetryError", message: "Fail" })
      v.expect(remainingAttempts).toBeGreaterThan(0)
      v.expect(remainingAttempts).toBeLessThan(3)
      return true
    }

    await bs.retry(fn, 3, cbErr)
    v.expect(cbErrCalled).toBe(true)
  }),


  v.it("doesn't call cbErr if the function succeeds on the first attempt", async () => {
    let cbErrCalled = false
    const fn = async () => "Success"
    const cbErr = () => {
      cbErrCalled = true
      return true
    }

    await bs.retry(fn, 3, cbErr)
    v.expect(cbErrCalled).toBe(false)
  }),


  v.it("cbErr should be able to stop retries by returning false", async () => {
    let attempt = 0
    const fn = () => { attempt++; throw new Err("Fail") }
    const cbErr = () => false

    await v.expect(bs.retry(fn, 999, cbErr)).rejects.toMatchObject({ name: "RetryError", message: "Fail" })
    v.expect(attempt).toBe(1)
  }),


  v.it("cbErr should receive the correct remaining attempts", async () => {
    let attempt = 0
    let lastRemainingAttempts = -1
    const fn = () => { attempt++; throw new Err("Fail") }
    const cbErr = (_: unknown, remainingAttempts: number) => {
      lastRemainingAttempts = remainingAttempts
      return false
    }

    await v.expect(bs.retry(fn, 5, cbErr)).rejects.toMatchObject({ name: "RetryError", message: "Fail" })
    v.expect(lastRemainingAttempts).toBe(4)
  }),


  v.it("bizarre values for cbErr should troll gracefully", async () => {
    await v.expect(bs.retry(() => { throw new Err("Fail") }, 999, 1 as any)).rejects.toMatchObject({ name: "TypeError", message: "cbErr_ is not a function" })
  }),


  v.it("function should take a reasonable amount of time to retry", async () => {
    let attempt = 0
    const fn = async () => {
      attempt++
      if (attempt < 9999) throw new Err("Fail")
      return "Success"
    }
    const cbErr = () => true

    const start = performance.now()
    await bs.retry(fn, 9999, cbErr)
    const duration = performance.now() - start
    v.expect(duration).toBeGreaterThan(0)
    v.expect(duration).toBeLessThan(110)
  })
})



v.describe("sleep", () => {
  v.it("should wait for the specified duration", async () => {
    const start = performance.now()
    await bs.sleep(100)
    const duration = performance.now() - start
    v.expect(duration).toBeGreaterThan(100)
    v.expect(duration).toBeLessThan(120)
  }),


  v.it("should handle non-positive durations gracefully", async () => {
    const start = performance.now()
    await bs.sleep(-100)
    await bs.sleep(0)
    const duration = performance.now() - start
    v.expect(duration).toBeGreaterThanOrEqual(0)
    v.expect(duration).toBeLessThan(40) // includes setTimeout overhead
  }),


  v.it("should handle invalid durations gracefully/consistently", async () => {
    const start = performance.now()
    await bs.sleep(NaN)
    await bs.sleep(null as any)
    await bs.sleep([] as any)
    await bs.sleep({} as any)
    await bs.sleep("" as any)
    await bs.sleep(Infinity)
    const duration = performance.now() - start
    v.expect(duration).toBeGreaterThanOrEqual(0)
    v.expect(duration).toBeLessThan(120) // includes setTimeout overhead
  })
})



v.describe("Benchmark", () => {
  v.it("rounds the benchmark duration correctly", async () => {
    const b = new bs.Benchmark()
    for (let i = 0; i < 1000; i++) {}
    const duration = b.ms
    v.expect(duration).toBeGreaterThanOrEqual(0)
    v.expect(duration).toBeLessThan(100)
  }),


  v.it("converts milliseconds to larger and smaller units", () => {
    const now = v.vi.spyOn(performance, "now").mockReturnValue(1000)
    const b = new bs.Benchmark()
    now.mockReturnValue(2000)

    v.expect(b.ms).toBe(1000)
    v.expect(b.s).toBe(1)
    v.expect(b.m).toBeCloseTo(b.s / 60, 4)
    v.expect(b.h).toBeCloseTo(b.m / 60, 6)
    v.expect(b.d).toBeCloseTo(b.h / 24, 8)
    v.expect(b.w).toBeCloseTo(b.d / 7, 10)
    v.expect(b.mn).toBeCloseTo(b.w / 4, 10)
    v.expect(b.y).toBeCloseTo(b.mn / 12, 10)
    v.expect(b.μs).toBeCloseTo(b.ms * 1e3, 0)
    v.expect(b.ns).toBeCloseTo(b.μs * 1e3, 0)
    v.expect(b.ps).toBeCloseTo(b.ns * 1e3, 0)
    now.mockRestore()
  }),


  v.it("rounds and restarts the current measurement", () => {
    const b = new bs.Benchmark()
    b.timer = performance.now() - 1000

    b.round()

    v.expect(b.rounds).toHaveLength(1)
    v.expect(b.rounds[0]).toBeGreaterThanOrEqual(1000)
    v.expect(b.ms).toBeLessThan(100)
  }),


  v.it("resets the recorded rounds and current measurement", () => {
    const b = new bs.Benchmark()
    b.rounds = [10, 20]
    b.timer = performance.now() - 1000

    b.reset()

    v.expect(b.rounds).toEqual([])
    v.expect(b.ms).toBeLessThan(100)
  }),


  v.it("adds completed rounds to the current measurement", () => {
    const now = v.vi.spyOn(performance, "now").mockReturnValue(1000)
    const b = new bs.Benchmark()
    b.rounds = [100, 200]
    now.mockReturnValue(1500)

    v.expect(b.total).toBe(800)
    now.mockRestore()
  })
})




v.describe("encode122 + decode122", () => {
  v.it("encodes and decodes random values correctly", () => {
    const randomValues: Uint8Array = new Uint8Array(16)
    for (let i = 0; i < randomValues.length; i++)
      randomValues[i] = Math.floor(Math.random() * 256)
    const encoded = bs.encode122(randomValues)
    const decoded = bs.decode122(encoded)
    v.expect(decoded).toEqual(randomValues)
  })


  v.it("round-trips empty input, illegal bytes, and subarray-backed ArrayLike values", () => {
    const cases: Uint8Array[] = [
      new Uint8Array(),
      new Uint8Array([0]),
      new Uint8Array([10]),
      new Uint8Array([13]),
      new Uint8Array([34]),
      new Uint8Array([38]),
      new Uint8Array([92]),
      new Uint8Array([0, 10, 13, 34, 38, 92]),
      new Uint8Array([255, 254, 1, 2, 127, 128, 129, 200]),
    ]

    for (const input of cases) {
      const encoded = bs.encode122(input)
      const decoded = bs.decode122(encoded)

      v.expect(encoded).toBeTypeOf("string")
      v.expect(encoded).not.toContain("\u0000")
      v.expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(encoded))).toBe(encoded)
      v.expect(decoded).toEqual(input)
    }

    const backing = new Uint8Array([0, 1, 2, 3, 4, 255, 128, 129, 10, 13, 34, 38, 92])
    const slice = backing.subarray(2, 10)
    const encodedSlice = bs.encode122(slice)

    v.expect(bs.decode122(encodedSlice)).toEqual(slice)
  })


  v.it("rejects invalid encoded markers while keeping valid UTF-8 output valid", () => {
    const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 255, 128, 129])
    const encoded = bs.encode122(payload)
    const bytes = new TextEncoder().encode(encoded)

    v.expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).not.toThrow()
    v.expect(bs.decode122(encoded)).toEqual(payload)

    const invalidMarker = String.fromCharCode(0xc600)
    v.expect(() => bs.decode122(invalidMarker)).toThrow(/Invalid base-122 illegal index 6/i)
  })
})



v.describe("wFn / wrapFunction", () => {
  v.it("is exported under both names, pointing to the same function", () => {
    v.expect(bs.wrapFunction).toBe(bs.wFn)
  })

  v.it("preserves an explicitly-provided `this` via call/apply/bind", () => {
    const counter = { count: 5, increment() { return ++this.count } }
    const detached = counter.increment
    const wrapped = bs.wFn(detached)

    v.expect(wrapped.call(counter)).toBe(6)
    v.expect(wrapped.apply(counter)).toBe(7)
    v.expect(wrapped.bind(counter)()).toBe(8)
  })

  v.it("falls back to globalThis when called with no receiver (the classic 'detached method' footgun) -- it does NOT restore the original receiver", () => {
    const counter = { count: 5, increment() { return ++this.count } }
    const wrapped = bs.wFn(counter.increment)

    ;(globalThis as any).count = 100
    try {
      v.expect(wrapped()).toBe(101)
      v.expect(counter.count).toBe(5) // untouched -- the fallback hit globalThis, not counter
    } finally { delete (globalThis as any).count }
  })

  v.it("does NOT replace falsy-but-defined `this` values (0, '', false) -- only null/undefined trigger the globalThis fallback", () => {
    function getThis(this: unknown) { return this }
    const wrapped = bs.wFn(getThis)

    v.expect(wrapped.call(0)).toBe(0)
    v.expect(wrapped.call("")).toBe("")
    v.expect(wrapped.call(false)).toBe(false)
    v.expect(wrapped.call(null)).toBe(globalThis)
    v.expect(wrapped.call(undefined)).toBe(globalThis)
  })

  v.it("forwards arguments and return values through unchanged", () => {
    const wrapped = bs.wFn((a: number, b: number, c: number) => a + b * c)
    v.expect(wrapped(1, 2, 3)).toBe(7)
  })

  v.it("propagates thrown errors from the wrapped function synchronously", () => {
    const wrapped = bs.wFn(() => { throw new bs.Err("boom") })
    v.expect(() => wrapped()).toThrow(bs.Err)
    v.expect(() => wrapped()).toThrow("boom")
  })

  v.it("supports async functions, forwarding the returned promise as-is (resolve and reject)", async () => {
    const resolves = bs.wFn(async (x: number) => { await Promise.resolve(); return x * 2 })
    await v.expect(resolves(21)).resolves.toBe(42)

    const rejects = bs.wFn(async () => { throw new bs.Err("async boom") })
    await v.expect(rejects()).rejects.toThrow("async boom")
  })

  v.it("supports generator functions, returning a working generator bound to the given receiver", () => {
    function* gen(this: { start: number }, n: number) {
      for (let i = 0; i < n; i++) yield this.start + i
    }
    const wrapped = bs.wFn(gen)
    v.expect([...wrapped.call({ start: 10 }, 3)]).toEqual([10, 11, 12])
  })

  v.it("works when used as a constructor with `new` (the returned wrapper is a plain function, not an arrow)", () => {
    function Point(this: { x: number, y: number }, x: number, y: number) { this.x = x; this.y = y }
    const WrappedPoint = bs.wFn(Point) as unknown as new (x: number, y: number) => { x: number, y: number }
    v.expect(new WrappedPoint(3, 4)).toEqual({ x: 3, y: 4 })
  })

  v.it("re-wrapping an already-wrapped function composes correctly", () => {
    const base = function(this: { n: number }) { return this.n * 2 }
    const doubleWrapped = bs.wFn(bs.wFn(base))
    v.expect(doubleWrapped.call({ n: 5 })).toBe(10)
  })
})



v.describe("gibberishify + degibberishify", () => {
  v.it("round-trips text data via a Uint8Array", async () => {
    const original = new TextEncoder().encode("Hello, world! \u{1F30D}")
    const gibberish = await bs.gibberishify(original)
    v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(original)
  })

  v.it("round-trips empty input", async () => {
    const gibberish = await bs.gibberishify(new Uint8Array(0))
    v.expect(gibberish.encryptedData.byteLength).toBe(12 + 16) // iv + empty ciphertext + 16-byte auth tag
    v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(new Uint8Array(0))
  })

  v.it("round-trips a Blob", async () => {
    const original = new TextEncoder().encode("Blob-backed payload")
    const gibberish = await bs.gibberishify(new Blob([original]))
    v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(original)
  })

  v.it("round-trips ArrayBuffer, DataView, and Uint8Array views of the same bytes identically", async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])
    const asArrayBuffer = original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength)
    const asDataView = new DataView(asArrayBuffer.slice(0))

    for (const input of [original, asArrayBuffer, asDataView] as const) {
      const gibberish = await bs.gibberishify(input)
      v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(original)
    }
  })

  v.it("round-trips an offset subarray view without leaking neighboring bytes", async () => {
    const backing = new Uint8Array([9, 9, 9, 1, 2, 3, 4, 5, 9, 9, 9])
    const view = backing.subarray(3, 8)
    const gibberish = await bs.gibberishify(view)
    v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  v.it("rejects SharedArrayBuffer-backed views (WebCrypto disallows them, confirming the BufferSource type constraint is correct)", async () => {
    const shared = new SharedArrayBuffer(32)
    const view = new Uint8Array(shared)
    view.set(new TextEncoder().encode("shared-memory payload!"))

    // Cast needed since SharedArrayBuffer-backed views aren't assignable to BufferSource per lib.dom.d.ts.
    await v.expect(bs.gibberishify(view as unknown as Uint8Array<ArrayBuffer>)).rejects.toThrow(/SharedArrayBuffer/i)
  })

  v.it("produces a fresh random key, IV, and ciphertext on every call, even for identical input", async () => {
    const data = new TextEncoder().encode("same input, every time")
    const runs = await Promise.all(Array.from({ length: 20 }, () => bs.gibberishify(data)))

    v.expect(new Set(runs.map(r => Buffer.from(r.key).toString("hex"))).size).toBe(runs.length)
    v.expect(new Set(runs.map(r => Buffer.from(r.encryptedData).toString("hex"))).size).toBe(runs.length)

    for (const run of runs)
      v.expect(new Uint8Array(await bs.degibberishify(run))).toEqual(data)
  })

  v.it("keeps key (32 bytes) and payload framing fixed regardless of input size", async () => {
    for (const size of [0, 1, 15, 16, 17, 1024, 65536]) {
      const data = globalThis.crypto.getRandomValues(new Uint8Array(size))
      const gibberish = await bs.gibberishify(data)
      v.expect(gibberish.key.byteLength).toBe(32)
      v.expect(gibberish.encryptedData.byteLength).toBe(12 + size + 16) // iv + ciphertext + auth tag
    }
  })

  v.it("fails to decrypt with the wrong key", async () => {
    const gibberish = await bs.gibberishify(new TextEncoder().encode("top secret"))
    const wrongKey = globalThis.crypto.getRandomValues(new Uint8Array(32))
    await v.expect(bs.degibberishify({ ...gibberish, key: wrongKey })).rejects.toThrow()
  })

  v.it("rejects if a single bit anywhere in the IV, ciphertext, or auth tag is flipped", async () => {
    const data = new TextEncoder().encode("tamper-evident payload, long enough to span multiple ciphertext bytes")
    const gibberish = await bs.gibberishify(data)
    const len = gibberish.encryptedData.byteLength

    const positions = [...new Set([0, 1, 11, 12, 13, Math.floor(len / 2), len - 16, len - 1])]
    for (const pos of positions)
      for (const bit of [0, 3, 7]) {
        const tampered = gibberish.encryptedData.slice()
        tampered[pos] ^= (1 << bit)
        await v.expect(bs.degibberishify({ encryptedData: tampered, key: gibberish.key })).rejects.toThrow()
      }
  })

  v.it("rejects encryptedData too short to contain an IV + auth tag", async () => {
    const key = globalThis.crypto.getRandomValues(new Uint8Array(32))
    for (const len of [0, 1, 11, 12, 20, 27])
      await v.expect(bs.degibberishify({ encryptedData: new Uint8Array(len), key })).rejects.toThrow()
  })

  v.it("round-trips all-zero and all-0xff buffers (pathological low-entropy input)", async () => {
    for (const fill of [0x00, 0xff]) {
      const data = new Uint8Array(4096).fill(fill)
      const gibberish = await bs.gibberishify(data)
      v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(data)
    }
  })

  v.it("round-trips large (1MB) random data", async () => {
    // getRandomValues caps out at 65,536 bytes per call, so fill in chunks.
    const data = new Uint8Array(1024 * 1024)
    for (let offset = 0; offset < data.length; offset += 65536)
      globalThis.crypto.getRandomValues(data.subarray(offset, offset + 65536))
    const gibberish = await bs.gibberishify(data)
    v.expect(new Uint8Array(await bs.degibberishify(gibberish))).toEqual(data)
  })

  v.it("survives 100 concurrent encrypt/decrypt round-trips without cross-contamination", async () => {
    const inputs = Array.from({ length: 100 }, (_, i) => new TextEncoder().encode(`payload #${i}`))
    const results = await Promise.all(inputs.map(async (data, i) => {
      const gibberish = await bs.gibberishify(data)
      const decrypted = new TextDecoder().decode(await bs.degibberishify(gibberish))
      return decrypted === `payload #${i}`
    }))
    v.expect(results.every(Boolean)).toBe(true)
  })
})