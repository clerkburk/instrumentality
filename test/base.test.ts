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