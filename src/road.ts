import * as rl from "node:readline"
import * as fs from "node:fs"; import { constants as fsc } from "node:fs"
import * as fp from "node:fs/promises"
import * as ph from "node:path"
import * as os from "node:os"
import * as cr from "node:crypto"
import * as sp from "node:stream/promises"
import { on } from "node:events"
import * as bs from "./base.ts"



/**
 * Subclass of {@link bs.InsErr} that represents an error thrown from this specific module of the library
 */
export class RdErr extends bs.InsErr { override name = "Instrumentality-Road-Error" }



/**
 * Returns the constructor function corresponding to the file mode.
 * 
 * @param statmode The file mode to check.
 * @returns The constructor function corresponding to the file mode.
 * @throws If the file mode is unknown, throws a {@link RdErr}.
 */
export function resolveMode(statmode: number) {
  switch (statmode & fsc.S_IFMT) {
    case fsc.S_IFREG: return File
    case fsc.S_IFDIR: return Folder
    case fsc.S_IFBLK: return BlockDevice
    case fsc.S_IFCHR: return CharacterDevice
    case fsc.S_IFLNK: return SymbolicLink
    case fsc.S_IFIFO: return Fifo
    case fsc.S_IFSOCK: return Socket
    default: throw new RdErr(`Unknown mode type ${statmode} (statmode is most likely corrupted)`)
  }
}



/**
 * Creates a new instance of the appropriate subclass of {@link Road} based on the file mode of the specified path.
 *
 * @param lookFor The path to check.
 * @returns A new instance of the appropriate subclass of {@link Road}.
 * @throws If the path does not exist, throws a fs {@link Error}.
 */
export function factorySync(lookFor: string) {
  fs.accessSync(lookFor, fsc.F_OK)
  return new (resolveMode(fs.lstatSync(lookFor).mode))(lookFor, false)
}
/** Async version of {@link factorySync}. */
export async function factory(lookFor: string) {
  await fp.access(lookFor, fsc.F_OK)
  return new (resolveMode((await fp.lstat(lookFor)).mode))(lookFor, false)
}



/**
 * A map that keeps track of locked roads to prevent concurrent modifications. The keys are the absolute paths of the roads, and the values are promises that resolve when the lock is released.
 * 
 * @remarks Don't manually modify this map. Use the {@link Road.initChange} and {@link Road.initChangeSync} methods to acquire and release locks on roads.
 * For read-only purposes, you should use the {@link lockFor} function to await the optional lock on a road.
 */
let lockedRoads: Map<string, Promise<void>> | null = null
/**
 * Getter for the locked roads map.
 * 
 * @param roadOrPath - A {@link Road} instance or a string representing the absolute path of the road to check.
 * @returns The promise associated with the locked road, or `undefined` if the road is not currently locked.
 */
export function lockFor(roadOrPath: Road | string) {
  return lockedRoads?.get(roadOrPath.toString())
}



export abstract class Road {
  /** The absolute path to the file or directory that this Road instance represents.
   * @remarks Intentionally made protected to prevent external modification, as changing this value could lead to inconsistencies and unexpected behavior. */
  protected pointsTo: string
  /** Indicates whether the file or directory represented by this Road instance can be modified.
   * Changing this value does not affect the actual file system permissions, but rather serves as a safeguard within the application to prevent accidental modifications. */
  mutable: boolean = true

  // Quick accessors
  /** Accessor for the absolute path to the file or directory that this Road instance represents. */
  get isAt() { return this.pointsTo }
  /** Accessor for the name of the file or directory that this Road instance represents. */
  get name() { return this.isAt.slice(this.isAt.lastIndexOf(ph.sep) + 1) }
  /** Same as {@link isAt} but for compatibility with external libraries that try to convert the object to a string. */
  toString() { return this.isAt }
  /** Returns the OS file type of the file or directory.
   * Return value (OS type) and the type of this instance are not guaranteed to be the same, as the file system may have changed since this instance was created. */
  typeSync() { return (resolveMode(fs.lstatSync(this.isAt).mode)) }
  /** Async version of {@link typeSync}. */
  async type() { return (resolveMode((await fp.lstat(this.isAt)).mode)) }

  /**
   * Constructs a new Road instance representing the file or directory at the specified path.
   * 
   * @param lookFor The path to the file or directory that this Road instance will represent.
   * @param typeCheck Whether to check if the type of the file or directory at the specified path matches the type of this instance.
   * This can be skipped for performance reasons if the type is known to be correct, but it is recommended to keep it enabled for safety.
   * @throws If the specified path does not exist, throws a fs.{@link Error}.
   * @throws If the type of the file or directory at the specified path does not match the type of this instance, throws a {@link RdErr}. Useful for subclasses.
   */
  constructor(lookFor: string, typeCheck: boolean | 1 | 0) {
    this.pointsTo = ph.resolve(lookFor)
    if (typeCheck && !(this instanceof this.typeSync())) // `this` directly refers to the subclass
      throw new RdErr(`Type missmatch: Path '${this.isAt}' is not of constructed type ${this.constructor.name}.`)
  }

  /**
   * Verifies that the file or directory represented by this Road instance exists, is of the same type as this instance, and (optionally) is writable.
   * 
   * @param expectMode The expected access mode for this Road other than visibility by this process.
   * @returns Result of the verification.
   */
  async verify(expectMode: number, typeCheck: boolean): Promise<boolean> {
    try {
      await fp.access(this.isAt, fsc.F_OK | expectMode)
      return typeCheck || this instanceof (await this.type())
    } catch {
      return false
    }
  }
    /** Sync version of {@link verify}. */
  verifySync(expectMode: number, typeCheck: boolean): boolean {
    try {
      fs.accessSync(this.isAt, fsc.F_OK | expectMode)
      return typeCheck || this instanceof this.typeSync()
    } catch {
      return false
    }
  }

  /**
   * Creates a disposable lock for the file or directory represented by this Road instance, preventing concurrent modifications.
   * 
   * @returns An object with a `dispose` method that releases the lock when called. The lock is automatically released when the object is garbage collected.
   * @remarks Please use this method with the `await using` statement to ensure that the lock is properly released after the operation is complete. This method is intended for internal use and shouldn't be called directly in most cases. (that's why it's protected)
   */
  protected async initChange() {
    if (!await this.verify(fsc.R_OK | fsc.W_OK, true))
      throw new RdErr(`Road to '${this.isAt}' (${this.constructor.name}) isn't the same as during construction, can't modify (OS type: ${fs.existsSync(this.isAt) ? this.typeSync().name : 'nonexistent'})`)
    if (!this.mutable)
      throw new RdErr(`Attempting to modify road to '${this.isAt}' of type ${this.constructor.name} which's marked as immutable (unrelated to the actual OS file permissions)`)
    if (!lockedRoads)
      lockedRoads = new Map<string, Promise<void>>()
    const lockedPath = this.isAt
    let releaseLock = () => {}
    await lockFor(lockedPath)
    lockedRoads.set(lockedPath, new Promise<void>(res => releaseLock = res))
    return {
      [Symbol.dispose]() {
        releaseLock()
        releaseLock = () => { throw new RdErr("Lock already released, can't dispose") }
        lockedRoads!.delete(lockedPath)
      },
      async [Symbol.asyncDispose]() {
        releaseLock()
        releaseLock = () => { throw new RdErr("Lock already released, can't dispose") }
        lockedRoads!.delete(lockedPath)
      }
    }
  }
  /**
   * Sync version of {@link initChangeSync}.
   * 
   * @remarks This sync version will throw if the road is already locked by another operation.
   */
  protected initChangeSync() {
    if (!this.verifySync(fsc.R_OK | fsc.W_OK, true))
      throw new RdErr(`Road to '${this.isAt}' (${this.constructor.name}) isn't the same as during construction, can't modify (OS type: ${fs.existsSync(this.isAt) ? this.typeSync().name : 'nonexistent'})`)
    if (!this.mutable)
      throw new RdErr(`Attempting to modify road to '${this.isAt}' of type ${this.constructor.name} which's marked as immutable (unrelated to the actual OS file permissions)`)
    if (!lockedRoads)
      lockedRoads = new Map<string, Promise<void>>()
    const lockedPath = this.isAt
    if (lockedRoads.has(lockedPath))
      throw new RdErr(`Road to '${this.isAt}' is currently locked by another operation, can't modify synchronously`)
    let releaseLock = () => {}
    lockedRoads.set(lockedPath, new Promise<void>(res => releaseLock = res))
    return {
      [Symbol.dispose]() {
        lockedRoads!.delete(lockedPath)
        releaseLock()
        releaseLock = () => { throw new RdErr("Lock already released, can't dispose") }
      },
      async [Symbol.asyncDispose]() {
        lockedRoads!.delete(lockedPath)
        releaseLock()
        releaseLock = () => { throw new RdErr("Lock already released, can't dispose") }
      }
    }
  }

  /**
   * Checks if the file or directory represented by this Road is both visible and of the same type as expected.
   */
  async exists() { return this.verify(fsc.F_OK, true) }
  existsSync() { return this.verifySync(fsc.F_OK, true) }
  /**
   * @returns The file system stats for the file or directory.
   * @see {@link fs.lstat}
   */
  async stats() { return fp.lstat(this.isAt) }
  /**
   * @returns The file system stats for the file or directory.
   * @see {@link fs.lstatSync}
   */
  statsSync() { return fs.lstatSync(this.isAt) }

  /**
   * @returns The amount of path segments in the absolute path to the file or directory represented by this Road instance, minus one (i.e., the depth of the file or directory in the file system hierarchy).
   * @remarks As subclasses of {@link Road} require all paths to be absolute/normalized and valid, this method is guaranteed to return a non-negative integer.
   */
  depth() { return this.isAt.split(ph.sep).length - 1 }
  /** @returns The parent folder of the file or directory represented by this Road instance. */
  parent() { return new Folder(ph.dirname(this.isAt), false) }
  *ancestorsIt() {
    let current: Folder = this.parent()
    let parent = current.parent()
    while (current.isAt !== parent.isAt) {
      yield current
      current = parent
      parent = current.parent()
    }
  }
  ancestors() { return [...this.ancestorsIt()] }

  async untilAccessible(mode = fsc.F_OK, abs: AbortSignal, onEachAttempt?: () => unknown) {
    const watcher = fs.watch(this.isAt)
    try {
      if (await this.verify(mode, true))
        return
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (let _ of on(watcher, 'change', { signal: abs }))
        if (await this.verify(mode, true))
          return
        else
          await onEachAttempt?.()
    } finally {
      watcher.close()
    }
  }
  async onChange<T>(abs: AbortSignal, cb?: () => T) {
    const watcher = fs.watch(this.isAt)
    try {
      for await (let _ of on(watcher, 'change', { signal: abs }))
        return await cb?.() || null
      return null
    }
    catch(e) { throw e }
    finally { watcher.close() }
  }

  metaSync(suffixID = "tsInstrumentalityMeta") {
    if (os.platform() === "win32")
      return fs.readFileSync(`${this.isAt}:${suffixID}`)
    else
      throw new RdErr("Extended attributes are not supported on this platform")
  }
  async meta(suffixID = "tsInstrumentalityMeta"): Promise<Record<string, unknown>> {
    if (os.platform() === "win32")
      return JSON.parse(await fp.readFile(`${this.isAt}:${suffixID}`, 'utf-8'))
    else
      throw new RdErr("Extended attributes are not supported on this platform")
  }
  setMetaSync(meta: Record<string, unknown>, suffixID = "tsInstrumentalityMeta") {
    using _ = this.initChangeSync()
    if (os.platform() === "win32")
      fs.writeFileSync(`${this.isAt}:${suffixID}`, JSON.stringify(meta), 'utf-8')
    else
      throw new RdErr("Extended attributes are not supported on this platform")
  }
  async setMeta(meta: Record<string, unknown>, suffixID = "tsInstrumentalityMeta") {
    using _ = await this.initChange()
    if (os.platform() === "win32")
      await fp.writeFile(`${this.isAt}:${suffixID}`, JSON.stringify(meta), 'utf-8')
    else
      throw new RdErr("Extended attributes are not supported on this platform")
  }

  abstract deleteSync(): void
  abstract delete(): Promise<void>
  abstract moveSync(into: Folder): void
  abstract move(into: Folder): Promise<void>
  abstract copySync(into: Folder): this
  abstract copy(into: Folder): Promise<this>
  abstract renameSync(to: string): void
  abstract rename(to: string): Promise<void>
  abstract resurrectSync(): void
  abstract resurrect(): Promise<void>
}



export class File extends Road {
  get ext() { return ph.extname(this.isAt) }
  get noExt() { return ph.basename(this.isAt, this.ext) }

  static createSync(at: string) {
    try {
      fs.accessSync(at, fsc.W_OK)
    } catch {
      fs.writeFileSync(at, "")
    }
    return new File(at, false)
  }
  static async create(at: string) {
    try {
      await fp.access(at, fsc.W_OK)
    } catch {
      await fp.writeFile(at, "")
    }
    return new File(at, false)
  }

  readSync(): Buffer
  readSync(encoding: BufferEncoding, flag?: string): string
  readSync(encoding?: BufferEncoding, flag?: string): Buffer | string {
    if (encoding)
      return fs.readFileSync(this.isAt, { encoding: encoding, flag: flag })
    else
      return fs.readFileSync(this.isAt)
  }
  async read(): Promise<Buffer>
  async read(encoding: BufferEncoding, flag?: string): Promise<string>
  async read(encoding?: BufferEncoding, flag?: string): Promise<Buffer | string> {
    if (encoding)
      return fp.readFile(this.isAt, { encoding: encoding, flag: flag })
    else
      return fp.readFile(this.isAt)
  }

  // Bizarre reading
  *itBuffSync(chunkSize: number = 64 * 1024, flags: string | number = 'r', mode?: fs.Mode) {
    const fd = fs.openSync(this.isAt, flags, mode)
    try {
      const buffer = Buffer.alloc(chunkSize)
      let bytesRead: number
      do {
        bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)
        if (bytesRead > 0)
          yield buffer.subarray(0, bytesRead)
      } while (bytesRead === chunkSize)
    } finally {
      fs.closeSync(fd)
    }
  }
  async *itBuff(chunkSize: number = 64 * 1024, flags: string | number = 'r', mode?: fs.Mode) {
    const fd = await fp.open(this.isAt, flags, mode)
    try {
      const buffer = Buffer.alloc(chunkSize)
      let bytesRead: number
      do {
        const readResult = await fd.read(buffer, 0, chunkSize, null)
        bytesRead = readResult.bytesRead
        if (bytesRead > 0)
          yield buffer.subarray(0, bytesRead)
      } while (bytesRead === chunkSize)
    } finally {
      await fd.close()
    }
  }
  async *itLines(options: Parameters<typeof fs.createReadStream>[1] = { encoding: 'utf-8' }) {
    const readStream = fs.createReadStream(this.isAt, options)
    const rlInterface = rl.createInterface({ input: readStream, crlfDelay: Infinity })
    try {
      for await (const line of rlInterface)
        yield line
    } finally {
      rlInterface.close()
      readStream.destroy()
    }
  }
  computeHashSync(algorithm?: string, options?: cr.HashOptions): Buffer
  computeHashSync(algorithm?: string, options?: cr.HashOptions, encoding?: BufferEncoding): string
  computeHashSync(algorithm = "sha256", options?: cr.HashOptions, encoding?: BufferEncoding): Buffer | string {
    const hash = cr.createHash(algorithm, options)
    for (const chunk of this.itBuffSync())
      hash.update(chunk)
    return encoding ? hash.digest(encoding) : hash.digest()
  }
  async computeHash(algorithm?: string, options?: cr.HashOptions): Promise<Buffer>
  async computeHash(algorithm?: string, options?: cr.HashOptions, encoding?: BufferEncoding): Promise<string>
  async computeHash(algorithm = "sha256", options?: cr.HashOptions, encoding?: BufferEncoding): Promise<Buffer | string> {
    const hash = cr.createHash(algorithm, options)
    for await (const chunk of this.itBuff())
      hash.update(chunk)
    return encoding ? hash.digest(encoding) : hash.digest()
  }
  async streamHash(algorithm = "sha256", options?: cr.HashOptions, encoding?: BufferEncoding): Promise<Buffer | string> {
    const hash = cr.createHash(algorithm, options)
    await sp.pipeline(fs.createReadStream(this.isAt), hash)
    return encoding ? hash.digest(encoding) : hash.digest()
  }

  writeSync(data: Buffer | string, options?: fs.WriteFileOptions) {
    using _ = this.initChangeSync()
    fs.writeFileSync(this.isAt, data, options)
  }
  async write(data: Buffer | string, options?: fs.WriteFileOptions) {
    using _ = await this.initChange()
    await fp.writeFile(this.isAt, data, options)
  }
  appendSync(data: Buffer | string, options?: fs.WriteFileOptions) {
    using _ = this.initChangeSync()
    fs.appendFileSync(this.isAt, data, options)
  }
  async append(data: Buffer | string, options?: fs.WriteFileOptions) {
    using _ = await this.initChange()
    await fp.appendFile(this.isAt, data, options)
  }

  async sameAs(other: File) {
    if (this.isAt === other.isAt)
      return true
    else if ((await fp.lstat(this.isAt)).size !== (await fp.lstat(other.isAt)).size)
      return false
    const thisIter = this.itBuff()
    const otherIter = other.itBuff()
    while (true) {
      const [a, b] = await Promise.all([thisIter.next(), otherIter.next()])
      if (a.done && b.done) return true
      if (a.done !== b.done) return false
      if (!a.value!.equals(b.value!)) return false
    }
  }
  sameAsSync(other: File) {
    if (this.isAt === other.isAt)
      return true
    else if (fs.statSync(this.isAt).size !== fs.statSync(other.isAt).size)
      return false
    const thisIter = this.itBuffSync()
    const otherIter = other.itBuffSync()
    while (true) {
      const a = thisIter.next()
      const b = otherIter.next()
      if (a.done && b.done) return true
      if (a.done !== b.done) return false
      if (!a.value!.equals(b.value!)) return false
    }
  }

  deleteSync() {
    using _ = this.initChangeSync()
    fs.rmSync(this.isAt, { force: true })
  }
  async delete() {
    using _ = await this.initChange()
    await fp.rm(this.isAt, { force: true })
  }
  moveSync(into: Folder) {
    using _ = this.initChangeSync()
    const newPath = into.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async move(into: Folder) {
    using _ = await this.initChange()
    const newPath = into.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  copySync(into: Folder): this {
    const newPath = into.join(this.name)
    fs.copyFileSync(this.isAt, newPath)
    return new File(newPath, false) as this
  }
  async copy(into: Folder): Promise<this> {
    const newPath = into.join(this.name)
    await fp.copyFile(this.isAt, newPath)
    return new File(newPath, false) as this
  }
  renameSync(to: string) {
    using _ = this.initChangeSync()
    const newPath = this.parent().join(to)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async rename(to: string) {
    using _ = await this.initChange()
    const newPath = this.parent().join(to)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  resurrectSync() {
    using _ = this.initChangeSync()
    fs.writeFileSync(this.isAt, "")
  }
  async resurrect() {
    using _ = await this.initChange()
    await fp.writeFile(this.isAt, "")
  }
}

export function entry() { return new File(process.argv[1]!, false) }



export class Folder extends Road {
  static async create(at: string): Promise<Folder> {
    try {
      await fp.access(at, fs.constants.F_OK)
    } catch {
      await fp.mkdir(at, { recursive: true })
    }
    return new Folder(at, false)
  }
  static createSync(at: string): Folder {
    try {
      fs.accessSync(at, fs.constants.F_OK)
    } catch {
      fs.mkdirSync(at, { recursive: true })
    }
    return new Folder(at, false)
  }

  join(...paths: string[]) {
    return ph.join(this.isAt, ...paths)
  }

  itSync(): Iterable<Road>
  itSync<T extends Road>(expectedType: new () => T): Iterable<T>
  *itSync<T extends Road>(expectedType?: new () => T): Iterable<Road> | Iterable<T> {
    for (const entry of fs.readdirSync(this.isAt)) {
      const road = factorySync(this.join(entry))
      if (!expectedType || road instanceof expectedType)
        yield road
    }
  }
  it(): AsyncIterable<Road>
  it<T extends Road>(expectedType: new () => T): AsyncIterable<T>
  async *it<T extends Road>(expectedType?: new () => T): AsyncIterable<Road> | AsyncIterable<T> {
    for (const entry of await fp.readdir(this.isAt)) {
      const road = await factory(this.join(entry))
      if (!expectedType || road instanceof expectedType)
        yield road
    }
  }
  listSync(): Road[]
  listSync<T extends Road>(expectedType: new () => T): T[]
  listSync<T extends Road>(expectedType?: new () => T): Road[] | T[] {
    const entries = fs.readdirSync(this.isAt).map(entry => factorySync(this.join(entry)))
    if (!expectedType)
      return entries
    return entries.filter(entry => entry instanceof expectedType) as unknown as T[]
  }
  async list(): Promise<Road[]>
  async list<T extends Road>(_expectedType: new () => T): Promise<T[]>
  async list<T extends Road>(_expectedType?: new () => T): Promise<Road[] | T[]> {
    const entries = (await fp.readdir(this.isAt)).map(async entry => factory(this.join(entry)))
    const resolvedEntries = await Promise.all(entries)
    if (!_expectedType)
      return resolvedEntries
    return resolvedEntries.filter(entry => entry instanceof _expectedType) as unknown as T[]
  }

  findSync(name: string): Road | null
  findSync<T extends Road>(name: string, _expectedType: new () => T): T | null
  findSync<T extends Road>(name: string, _expectedType?: new () => T): Road | T | null {
    try {
      const found = factorySync(this.join(name))
      if (!_expectedType)
        return found
      if (found instanceof _expectedType)
        return found as T
      return null
    } catch {
      return null
    }
  }

  async find(name: string): Promise<Road | null>
  async find<T extends Road>(name: string, _expectedType: new () => T): Promise<T | null>
  async find<T extends Road>(name: string, _expectedType?: new () => T): Promise<Road | T | null> {
    try {
      await fp.access(this.join(name), fs.constants.F_OK)
      const found = await factory(this.join(name))
      if (!_expectedType)
        return found
      if (found instanceof _expectedType)
        return found as T
      return null
    } catch {
      return null
    }
  }

  addSync<T extends Road>(name: string, createable: { createSync: (at: string) => T }): T {
    const newPath = this.join(name)
    createable.createSync(newPath)
    return factorySync(newPath) as unknown as T
  }
  async add<T extends Road>(name: string, createable: { create: (at: string) => Promise<T> }): Promise<T> {
    const newPath = this.join(name)
    await createable.create(newPath)
    return factory(newPath) as unknown as Promise<T>
  }

  deleteSync(options: fs.RmOptions = { recursive: true }) {
    using _ = this.initChangeSync()
    fs.rmSync(this.isAt, options)
  }
  async delete(options: fs.RmOptions = { recursive: true }) {
    using _ = await this.initChange()
    await fp.rm(this.isAt, options)
  }
  moveSync(into: Folder) {
    using _ = this.initChangeSync()
    const newPath = into.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async move(into: Folder) {
    using _ = await this.initChange()
    const newPath = into.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  copySync(into: Folder): this {
    const newPath = into.join(this.name)
    fs.cpSync(this.isAt, newPath, { recursive: true })
    return new Folder(newPath, false) as this
  }
  async copy(into: Folder): Promise<this> {
    const newPath = into.join(this.name)
    await fp.cp(this.isAt, newPath, { recursive: true })
    return new Folder(newPath, false) as this
  }
  renameSync(to: string) {
    using _ = this.initChangeSync()
    const newPath = this.parent().join(to)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async rename(to: string) {
    using _ = await this.initChange()
    const newPath = this.parent().join(to)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  resurrectSync() {
    using _ = this.initChangeSync()
    fs.mkdirSync(this.isAt, { recursive: true })
  }
  async resurrect() {
    using _ = await this.initChange()
    await fp.mkdir(this.isAt, { recursive: true })
  }
}

export function sysRoot() { return new Folder(ph.parse(process.cwd()).root, false) }
export function home() { return new Folder(os.homedir(), false) }
export function tmp() { return new Folder(os.tmpdir(), false) }
export function here() { return new Folder(process.cwd(), false) }
export { Folder as Dir, Folder as Directory, Folder as Dict, Folder as Dictionary }



export class SymbolicLink extends Road {
  static async create(at: string, target: Road) {
    try {
      await fp.access(at, fs.constants.F_OK)
    } catch {
      await fp.symlink(target.isAt, at)
    }
    return new SymbolicLink(at, false)
  }
  static createSync(_at: string, _target: Road) {
    try {
      fs.accessSync(_at, fs.constants.F_OK)
    } catch {
      fs.symlinkSync(_target.isAt, _at)
    }
    return new SymbolicLink(_at, false)
  }

  targetSync() {
    return factorySync(ph.resolve(ph.dirname(this.isAt), fs.readlinkSync(this.isAt)))
  }
  async target() {
    return factory(ph.resolve(ph.dirname(this.isAt), await fp.readlink(this.isAt)))
  }
  retargetSync(_newTarget: Road) {
    this.deleteSync()
    fs.symlinkSync(_newTarget.isAt, this.isAt)
  }
  async retarget(_newTarget: Road) {
    await this.delete()
    return fp.symlink(_newTarget.isAt, this.isAt)
  }

  deleteSync() {
    using _ = this.initChangeSync()
    fs.unlinkSync(this.isAt)
  }
  async delete() {
    using _ = await this.initChange()
    await fp.unlink(this.isAt)
  }
  moveSync(_into: Folder) {
    using _ = this.initChangeSync()
    const newPath = _into.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async move(_into: Folder) {
    using _ = await this.initChange()
    const newPath = _into.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  copySync(_into: Folder): this {
    const newPath = _into.join(this.name)
    const target = this.targetSync()
    fs.symlinkSync(target.isAt, newPath)
    return new SymbolicLink(newPath, false) as this
  }
  async copy(_into: Folder): Promise<this> {
    const newPath = _into.join(this.name)
    const target = await this.target()
    await fp.symlink(target.isAt, newPath)
    return new SymbolicLink(newPath, false) as this
  }
  renameSync(_to: string) {
    using _ = this.initChangeSync()
    const newPath = this.parent().join(_to)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async rename(_to: string) {
    using _ = await this.initChange()
    const newPath = this.parent().join(_to)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  resurrectSync() {
    using _ = this.initChangeSync()
    const target = this.targetSync()
    fs.symlinkSync(target.isAt, this.isAt)
  }
  async resurrect() {
    using _ = await this.initChange()
    const target = await this.target()
    await fp.symlink(target.isAt, this.isAt)
  }
}
export { SymbolicLink as Symlink }



export abstract class UnusableRoad extends Road {
  override readonly mutable: boolean = false // Modification is most likely to cause system issues (e.g. deleting a device file)
  constructor(_at: string, typeCheck: boolean) {
    super(_at, typeCheck)
    Object.freeze(this)
  }
  error(): never { throw new RdErr(`${this.constructor.name} at '${this.isAt}' is a system-level resource thus intentionally made immutable.`) }
  override initChangeSync(): never { return this.error() }
  override async initChange(): Promise<never> { return this.error() }
  override deleteSync(): never { return this.error() }
  override async delete(): Promise<never> { return this.error() }
  override moveSync(): never { return this.error() }
  override async move(): Promise<never> { return this.error() }
  override copySync(): never { return this.error() }
  override async copy(): Promise<never> { return this.error() }
  override renameSync(): never { return this.error() }
  override async rename(): Promise<never> { return this.error() }
  override resurrectSync(): never { return this.error() }
  override async resurrect(): Promise<never> { return this.error() }
}
export class BlockDevice extends UnusableRoad { }
export class CharacterDevice extends UnusableRoad { }
export class Fifo extends UnusableRoad { }
export class Socket extends UnusableRoad { }



export let finalizer: FinalizationRegistry<string> | null = null
export let toDelete: Set<string> | null = null
let exitHandlerRegistered = false
/**
 * Forcefully cleans up all files and folders registered for cleanup on exit.
 * 
 * @remarks This function is not recommended to be called manually, as it will delete all files and folders registered for cleanup on exit, which may lead to data loss if called at the wrong time. This function is intended to be called automatically when the process exits.
 */
export function forceCleanupToDelete() {
  for (const path of toDelete ?? [])
    try { fs.rmSync(path, { force: true, recursive: true }) } catch {}
  toDelete?.clear()
  toDelete = null
  finalizer = null
  if (exitHandlerRegistered)
    process.off('exit', forceCleanupToDelete)
  exitHandlerRegistered = false
}
export function registerToCleanup(self: Road) {
  if (!finalizer)
    finalizer = new FinalizationRegistry<string>(p => { try { fs.rmSync(p, { force: true, recursive: true }) } catch {}; toDelete?.delete(p) })
  if (!toDelete)
    toDelete = new Set()
  if (!exitHandlerRegistered) {
    process.once('exit', forceCleanupToDelete)
    exitHandlerRegistered = true
  }
  toDelete.add(self.isAt)
  finalizer.register(self, self.isAt, self)
}


export function Temp<T extends Road>(createable: { createSync: (at: string) => T }, autoCleanup: boolean): T & Disposable & AsyncDisposable {
  const t = createable.createSync(tmp().join(`instrumentality@${cr.randomUUID()}`))
  if (autoCleanup)
    registerToCleanup(t)
  return Object.freeze(Object.assign(t, {
    [Symbol.dispose]() { try { t.deleteSync() } catch {} toDelete?.delete(t.isAt); finalizer?.unregister(t) },
    async [Symbol.asyncDispose]() { try { await t.delete() } catch {} toDelete?.delete(t.isAt); finalizer?.unregister(t) }
  }))
}