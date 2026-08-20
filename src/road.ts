import * as rl from "node:readline"
import * as fs from "node:fs"; import { constants as fsc } from "node:fs"
import * as fp from "node:fs/promises"
import * as ph from "node:path"
import * as os from "node:os"
import * as cr from "node:crypto"
import { on } from "node:events"
import * as bs from "./base.ts"



/** Subclass of {@link bs.InsErr} that represents an error thrown from this specific module of the library */
export class RdErr extends bs.InsErr { override name = "Instrumentality-Road-Error" }
export { RdErr as RoadError }



/**
 * Returns the constructor function corresponding to the file mode (statmode).
 * 
 * @param statmode_ The file mode to check.
 * @returns The constructor function corresponding to the road type (e.g., {@link File}, {@link Folder}, etc.).
 * @throws If the file mode is unknown, throws a {@link RdErr}.
 */
export function resolveMode(statmode_: number): typeof File | typeof Folder | typeof BlockDevice | typeof CharacterDevice | typeof SymbolicLink | typeof Fifo | typeof Socket {
  switch (statmode_ & fsc.S_IFMT) {
    case fsc.S_IFREG: return File
    case fsc.S_IFDIR: return Folder
    case fsc.S_IFBLK: return BlockDevice
    case fsc.S_IFCHR: return CharacterDevice
    case fsc.S_IFLNK: return SymbolicLink
    case fsc.S_IFIFO: return Fifo
    case fsc.S_IFSOCK: return Socket
    default: throw new RdErr(`Unknown mode type ${statmode_} (statmode is most likely corrupted)`)
  }
}



/**
 * Creates the appropriate subclass of {@link Road} based on the file mode of the specified path.
 *
 * @param path_ The path to follow.
 * @returns A new instance of {@link Road}.
 * @throws If {@link fp.lstat}/{@link fs.lstatSync} fails to retrieved the status of {@link path_}.
 */
export async function factory(path_: string) {
  return new (resolveMode((await fp.lstat(path_)).mode))(path_, false)
}
/** Sync version of {@link factory}. */
export function factorySync(path_: string) {
  return new (resolveMode(fs.lstatSync(path_).mode))(path_, false)
}



/**
 * A map that keeps track of locked roads to prevent concurrent modifications.
 * 
 * @key The absolute path of the road that is currently locked.
 * @value A promise that resolves when the lock on the road is released.
 * 
 * @remarks The map is initialized lazily when the first lock is created to minimize import-time side effects.
 * It's generally meant for read-only purposes. It's not advised to modify this map directly if there are built-in mechanisms that do the job for you as well.
 */
export let lockedRoads: Map<string, Promise<void>> | null = null



/**
 * Road is an OOP, pointer-like representation of an entry in the local file system. It wraps around the Node.js fs module and provides a more convenient access to it.
 * It's meant to help the user mentally model an entry and help them reason about it, as well as provide a more convenient API and guardrails for common operations.
 * 
 * @remarks This is by no means a one-to-one mapping of the underlying file system (after initialization).
 * It is more like a memory representation, similar to a pointer in low-level programming languages; other processes might mess with the underlying entry. There are methods to check for consistency, but they are not guaranteed to be foolproof.
 */
export abstract class Road {
  /** The absolute path to the file or directory that this Road instance represents.
   * @remarks Intentionally made protected to prevent external modification, as changing this value could lead to inconsistencies and unexpected behavior. */
  protected pointsTo: string
  /** Indicates whether the file or directory represented by this Road instance can be modified.
   * Changing this value does not affect the actual file system permissions, but rather serves as a safeguard within the application to prevent accidental modifications. */
  mutable: boolean = true

  // Quick accessors
  /** Copy of the absolute path. */
  get isAt() { return this.pointsTo }
  /** Name of the road without the path (including extensions). */
  get name() { return this.isAt.slice(this.isAt.lastIndexOf(ph.sep) + 1) }
  /** The amount of path segments in the absolute path to the file or directory represented by this Road instance, minus one (i.e., the depth of the path in the file system hierarchy). */
  get depth() { return this.isAt.split(ph.sep).length - 1 }
  /** Same as {@link isAt} but for compatibility with external APIs. */
  toString() { return this.isAt }

  /**
   * Creates a new instance of the Road class.
   * 
   * @param path_ Any path-like string that can be resolved to an absolute path. It will be resolved to an absolute path using {@link ph.resolve}.
   * @param typeCheck_ If true, the constructor will check if the path corresponds to the expected type of road (e.g., file, folder, etc.) and throw an error if it doesn't. If false, no type checking will be performed.
   * 
   * @throws If {@link typeCheck_} is true and the path does not correspond to the expected type of road, a {@link RdErr} will be thrown.
   */
  constructor(path_: string, typeCheck_: boolean | 1 | 0) {
    this.pointsTo = ph.resolve(path_)
    if (typeCheck_ && !this.checkSync())
      throw new RdErr(`Type mismatch: '${this.isAt}'`)
  }

  /**
   * Aquires a lock for the path represented by this Road instance, preventing concurrent modifications from this and other Road instances pointing to the same path.
   * 
   * @param cb_ A callback function that will be called when the lock is released. This is used internally to manage the lock state.
   * @returns An object with a dispose method that releases the lock when called.
   * @throws If the road is immutable, a {@link RdErr} will be thrown.
   * 
   * @remarks This method MUST be used with a `using` statement to ensure that the lock is released properly. Failing to do so may result in deadlocks or other concurrency issues.
   * Non-deterministic release is unfortunately not possible due to the nature of JavaScript's garbage collection, thus the lock must be released deterministically by the user (to which the `using` statement is a convenient way to do so).
   */
  protected async lock(cb_ = () => {}): Promise<AsyncDisposable & Disposable> {
    if (!this.mutable)
      throw new RdErr(`Road to '${this.isAt}' is immutable.`)
    lockedRoads ??= new Map<string, Promise<void>>()
    const isAt = this.isAt
    await lockedRoads.get(isAt) // will skip if `undefined` (no lock)
    lockedRoads.set(isAt, new Promise<void>(res => cb_ = res))
    return {
      [Symbol.dispose]() {
        cb_()
        lockedRoads!.delete(isAt)
      },
      async [Symbol.asyncDispose]() {
        cb_()
        lockedRoads!.delete(isAt)
      }
    }
  }
  /**
   * Sync version of {@link lock}.
   * @throws Also throws a {@link RdErr} if the road is currently locked by another operation as it cannot wait for the lock to be released in a synchronous context.
   */
  protected lockSync(cb_ = () => {}): Disposable & AsyncDisposable {
    if (!this.mutable)
      throw new RdErr(`Road to '${this.isAt}' is immutable.`)
    lockedRoads ??= new Map<string, Promise<void>>()
    const isAt = this.isAt
    if (lockedRoads.has(isAt))
      throw new RdErr(`Road to '${this.isAt}' is currently locked by another operation.`)
    lockedRoads.set(isAt, new Promise<void>(res => cb_ = res))
    return {
      [Symbol.dispose]() {
        lockedRoads!.delete(isAt)
        cb_()
      },
      async [Symbol.asyncDispose]() {
        lockedRoads!.delete(isAt)
        cb_()
      }
    }
  }

  /** @returns An instance of {@link Folder} representing the parent directory of the current road. */
  parent(): Folder { return new Folder(ph.dirname(this.isAt), false) }
  /**
   * An async generator that yields the ancestors of the current road, starting from its parent and moving up the directory tree until it reaches the root.
   * 
   * @yields Each ancestor folder as a {@link Folder} instance.
   */
  *ancestorsIt() {
    let current: Folder = this.parent()
    let parent = current.parent()
    while (current.isAt !== parent.isAt) {
      yield current
      current = parent
      parent = current.parent()
    }
  }
  /** @returns An array of {@link Folder} instances representing the ancestors of the current road. */
  ancestors(): Folder[] { return [...this.ancestorsIt()] }

  /**
   * Watches the current entry for changes and resolves when the entry becomes accessible (i.e., exists and can be accessed).
   * 
   * @param abs An {@link AbortSignal} that stops the watching process when aborted.
   * @param expectMode The expected access mode for the entry, defaults to {@link fsc.F_OK} (existence check).
   * @param cb_ An optional callback function that will be called with any errors encountered while checking for accessibility.
   * @see {@link fp.access} on how the check for accessibility is performed.
   * @see {@link fs.watch} for more information on how the watching process works.
   * @see {@link on} for more information on how the event listener is set up.
   */
  async untilAccessible(abs: AbortSignal, expectMode = fsc.F_OK, cb_?: (err: unknown) => unknown): Promise<void> {
    const watcher = fs.watch(this.isAt)
    try {
      for await (let _ of on(watcher, 'change', { signal: abs })) {
        try {
          await fp.access(this.isAt, expectMode)
          return
        }
        catch(err: unknown) { await cb_?.(err) }
      }
    }
    catch(e) { throw e }
    finally { watcher.close() }
  }
  /**
   * Watches the current entry for changes and resolves when the entry is changed.
   * 
   * @param abs_ An {@link AbortSignal} that stops the watching process when aborted.
   * @param cb_ An optional callback function that will be called when the entry is changed.
   * @returns The return value of the callback function, or null if no callback is provided.
   */
  async onChange<T>(abs_: AbortSignal, cb_?: () => T) {
    const watcher = fs.watch(this.isAt)
    try {
      for await (let _ of on(watcher, 'change', { signal: abs_ }))
        return await cb_?.() ?? null
      return null
    }
    catch(e) { throw e }
    finally { watcher.close() }
  }

  /** @returns The result of {@link fp.lstat} for the current entry. */
  lstat() { return fp.lstat(this.isAt) }
  /** @returns The result of {@link fs.lstatSync} for the current entry. */
  lstatSync() { return fs.lstatSync(this.isAt) }
  /** @returns The result of {@link fp.stat} for the current entry. */
  stat() { return fp.stat(this.isAt) }
  /** @returns The result of {@link fs.statSync} for the current entry. */
  statSync() { return fs.statSync(this.isAt) }

  // jsdocs for the abstract methods are in the subclasses
  abstract delete(): Promise<void>
  abstract deleteSync(): void
  abstract moveSync(into_: Folder): void
  abstract move(into_: Folder): Promise<void>
  abstract copySync(into_: Folder): this
  abstract copy(into_: Folder): Promise<this>
  abstract renameSync(to_: string): void
  abstract rename(to_: string): Promise<void>

  // jsdocs for the abstract methods are in the subclasses
  abstract check(): Promise<boolean>
  abstract checkSync(): boolean

  /** Type narrowing for {@link File} (similar to `instanceof` without unnecessary runtime checks). */
  isFile(): this is File { return false as const }
  /** Type narrowing for {@link Folder} (similar to `instanceof` without unnecessary runtime checks). */
  isDir(): this is Folder { return false as const }
  /** Type narrowing for {@link Folder} (similar to `instanceof` without unnecessary runtime checks). */
  isFolder(): this is Folder { return false as const }
  /** Type narrowing for {@link Folder} (similar to `instanceof` without unnecessary runtime checks). */
  isDirectory(): this is Folder { return false as const }
  /** Type narrowing for {@link Folder} (similar to `instanceof` without unnecessary runtime checks). */
  isDict(): this is Folder { return false as const }
  /** Type narrowing for {@link Folder} (similar to `instanceof` without unnecessary runtime checks). */
  isDictionary(): this is Folder { return false as const }
  /** Type narrowing for {@link SymbolicLink} (similar to `instanceof` without unnecessary runtime checks). */
  isSymlink(): this is SymbolicLink { return false as const }
  /** Type narrowing for {@link SymbolicLink} (similar to `instanceof` without unnecessary runtime checks). */
  isSymbolicLink(): this is SymbolicLink { return false as const }
  /** Type narrowing for {@link UnusableRoad} (similar to `instanceof` without unnecessary runtime checks). */
  isUnusable(): this is UnusableRoad { return false as const }
  /** Type narrowing for {@link BlockDevice} (similar to `instanceof` without unnecessary runtime checks). */
  isBlockDevice(): this is BlockDevice { return false as const }
  /** Type narrowing for {@link CharacterDevice} (similar to `instanceof` without unnecessary runtime checks). */
  isCharacterDevice(): this is CharacterDevice { return false as const }
  /** Type narrowing for {@link Fifo} (similar to `instanceof` without unnecessary runtime checks). */
  isFifo(): this is Fifo { return false as const }
  /** Type narrowing for {@link Socket} (similar to `instanceof` without unnecessary runtime checks). */
  isSocket(): this is Socket { return false as const }
}
export type road_t = ConstructorParameters<typeof Road>



/** Subclass of {@link Road} that represents a file. */
export class File extends Road {
  static async create(at_: string) {
    try { await fp.access(at_, fsc.W_OK) }
    catch { await fp.writeFile(at_, "") }
    return new File(at_, true)
  }
  static createSync(at_: string) {
    try { fs.accessSync(at_, fs.constants.W_OK) }
    catch { fs.writeFileSync(at_, "") }
    return new File(at_, true)
  }

  get ext() { return ph.extname(this.isAt) }
  get noExt() { return ph.basename(this.isAt, this.ext) }

  async read(): Promise<Buffer>
  async read(encoding_: BufferEncoding, flag_?: string): Promise<string>
  async read(encoding_?: BufferEncoding, flag_?: string): Promise<Buffer | string> {
    if (encoding_)
      return fp.readFile(this.isAt, { encoding: encoding_, flag: flag_ })
    else
      return fp.readFile(this.isAt)
  }
  readSync(): Buffer
  readSync(encoding_: BufferEncoding, flag_?: string): string
  readSync(encoding_?: BufferEncoding, flag_?: string): Buffer | string {
    if (encoding_)
      return fs.readFileSync(this.isAt, { encoding: encoding_, flag: flag_ })
    else
      return fs.readFileSync(this.isAt)
  }

  async *itBuff(chunkSize_: number = 64 * 1024, flags_: string | number = 'r', mode_?: fs.Mode) {
    const fd = await fp.open(this.isAt, flags_, mode_)
    try {
      const buffer = Buffer.alloc(chunkSize_)
      let bytesRead: number
      do {
        const readResult = await fd.read(buffer, 0, chunkSize_, null)
        bytesRead = readResult.bytesRead
        if (bytesRead > 0)
          yield buffer.subarray(0, bytesRead)
      } while (bytesRead === chunkSize_)
    } finally {
      await fd.close()
    }
  }
  *itBuffSync(chunkSize_: number = 64 * 1024, flags_: string | number = 'r', mode_?: fs.Mode) {
    const fd = fs.openSync(this.isAt, flags_, mode_)
    try {
      const buffer = Buffer.alloc(chunkSize_)
      let bytesRead: number
      do {
        bytesRead = fs.readSync(fd, buffer, 0, chunkSize_, null)
        if (bytesRead > 0)
          yield buffer.subarray(0, bytesRead)
      } while (bytesRead === chunkSize_)
    } finally {
      fs.closeSync(fd)
    }
  }

  async write(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = await this.lock()
    await fp.writeFile(this.isAt, data_, options_)
  }
  writeSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    fs.writeFileSync(this.isAt, data_, options_)
  }
  async append(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = await this.lock()
    await fp.appendFile(this.isAt, data_, options_)
  }
  appendSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    fs.appendFileSync(this.isAt, data_, options_)
  }

  async delete() {
    using _ = await this.lock()
    await fp.rm(this.isAt, { force: true })
  }
  deleteSync() {
    using _ = this.lockSync()
    fs.rmSync(this.isAt, { force: true })
  }
  async move(into_: Folder) {
    using _ = await this.lock()
    const newPath = into_.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  moveSync(into_: Folder) {
    using _ = this.lockSync()
    const newPath = into_.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async copy(into_: Folder): Promise<this> {
    const newPath = into_.join(this.name)
    await fp.copyFile(this.isAt, newPath)
    return new File(newPath, false) as this
  }
  copySync(into_: Folder): this {
    const newPath = into_.join(this.name)
    fs.copyFileSync(this.isAt, newPath)
    return new File(newPath, false) as this
  }
  async rename(to_: string) {
    using _ = await this.lock()
    const newPath = this.parent().join(to_)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  renameSync(to_: string) {
    using _ = this.lockSync()
    const newPath = this.parent().join(to_)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }

  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isFile() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isFile() }

  override isFile(): this is File { return true as const }
}


// Bizarre functions for file I/O
export async function hash(f_: File, algorithm_?: string, options_?: cr.HashOptions): Promise<Buffer>
export async function hash(f_: File, algorithm_?: string, options_?: cr.HashOptions, encoding_?: BufferEncoding): Promise<string>
export async function hash(f_: File, algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: BufferEncoding): Promise<Buffer | string> {
  const hash = cr.createHash(algorithm_, options_)
  for await (const chunk of f_.itBuff())
    hash.update(chunk)
  return encoding_ ? hash.digest(encoding_) : hash.digest()
}
export function hashSync(f_: File, algorithm_?: string, options_?: cr.HashOptions): Buffer
export function hashSync(f_: File, algorithm_?: string, options_?: cr.HashOptions, encoding_?: BufferEncoding): string
export function hashSync(f_: File, algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: BufferEncoding): Buffer | string {
  const hash = cr.createHash(algorithm_, options_)
  for (const chunk of f_.itBuffSync())
    hash.update(chunk)
  return encoding_ ? hash.digest(encoding_) : hash.digest()
}

export async function streamHash(f_: File, algorithm_?: string, options_?: cr.HashOptions): Promise<Buffer>
export async function streamHash(f_: File, algorithm_?: string, options_?: cr.HashOptions, encoding_?: BufferEncoding): Promise<string>
export async function streamHash(f_: File, algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: BufferEncoding): Promise<Buffer | string> {
  const hash = cr.createHash(algorithm_, options_)
  for await (const chunk of f_.itBuff())
    hash.update(chunk)
  return encoding_ ? hash.digest(encoding_) : hash.digest()
}
export function streamHashSync(f_: File, algorithm_?: string, options_?: cr.HashOptions): Buffer
export function streamHashSync(f_: File, algorithm_?: string, options_?: cr.HashOptions, encoding_?: BufferEncoding): string
export function streamHashSync(f_: File, algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: BufferEncoding): Buffer | string {
  const hash = cr.createHash(algorithm_, options_)
  for (const chunk of f_.itBuffSync())
    hash.update(chunk)
  return encoding_ ? hash.digest(encoding_) : hash.digest()
}

export async function* itLines(f_: File, options_: fs.ReadStreamOptions = { encoding: 'utf-8' }) {
  const readStream = fs.createReadStream(f_.isAt, options_)
  const rlInterface = rl.createInterface({ input: readStream, crlfDelay: Infinity })
  try {
    for await (const line of rlInterface)
      yield line
  } finally {
    rlInterface.close()
    readStream.destroy()
  }
}

export async function fileSameAs(f1_: File, f2_: File): Promise<boolean> {
  if (f1_.isAt === f2_.isAt)
    return true
  else if ((await fp.lstat(f1_.isAt)).size !== (await fp.lstat(f2_.isAt)).size)
    return false
  const iter1 = f1_.itBuff()
  const iter2 = f2_.itBuff()
  while (true) {
    const [a, b] = await Promise.all([iter1.next(), iter2.next()])
    if (a.done && b.done) return true
    if (a.done !== b.done) return false
    if (!a.value!.equals(b.value!)) return false
  }
}
export function fileSameAsSync(f1_: File, f2_: File): boolean {
  if (f1_.isAt === f2_.isAt)
    return true
  else if (fs.statSync(f1_.isAt).size !== fs.statSync(f2_.isAt).size)
    return false
  const iter1 = f1_.itBuffSync()
  const iter2 = f2_.itBuffSync()
  while (true) {
    const a = iter1.next()
    const b = iter2.next()
    if (a.done && b.done) return true
    if (a.done !== b.done) return false
    if (!a.value!.equals(b.value!)) return false
  }
}



export class Folder extends Road {
  static async create(at_: string) {
    try { await fp.access(at_, fsc.W_OK) }
    catch { await fp.mkdir(at_, { recursive: true }) }
    return new Folder(at_, false)
  }
  static createSync(at_: string) {
    try { fs.accessSync(at_, fsc.W_OK) }
    catch { fs.mkdirSync(at_, { recursive: true }) }
    return new Folder(at_, false)
  }

  join(...paths_: string[]) {
    return ph.join(this.isAt, ...paths_)
  }

  it(): AsyncIterable<Road>
  it<T extends Road>(expectedType_: new (..._: any[]) => T): AsyncIterable<T>
  async *it<T extends Road>(expectedType_?: new (..._: any[]) => T): AsyncIterable<Road> | AsyncIterable<T> {
    for (const entryName of await fp.readdir(this.isAt)) {
      const road = await factory(this.join(entryName))
      if (!expectedType_ || road instanceof expectedType_)
        yield road
    }
  }
  itSync(): Iterable<Road>
  itSync<T extends Road>(expectedType_: new (..._: any[]) => T): Iterable<T>
  *itSync<T extends Road>(expectedType_?: new (..._: any[]) => T): Iterable<Road> | Iterable<T> {
    for (const entry of fs.readdirSync(this.isAt)) {
      const road = factorySync(this.join(entry))
      if (!expectedType_ || road instanceof expectedType_)
        yield road
    }
  }
  async list(): Promise<Road[]>
  async list<T extends Road>(expectedType_: new (..._: any[]) => T): Promise<T[]>
  async list<T extends Road>(expectedType_?: new (..._: any[]) => T): Promise<Road[] | T[]> {
    const entries = (await fp.readdir(this.isAt)).map(async entry => factory(this.join(entry)))
    const resolvedEntries = await Promise.all(entries)
    if (!expectedType_)
      return resolvedEntries
    return resolvedEntries.filter(entry => entry instanceof expectedType_) as unknown as T[]
  }
  listSync(): Road[]
  listSync<T extends Road>(expectedType_: new (..._: any[]) => T): T[]
  listSync<T extends Road>(expectedType_?: new (..._: any[]) => T): Road[] | T[] {
    const entries = fs.readdirSync(this.isAt).map(entry => factorySync(this.join(entry)))
    if (!expectedType_)
      return entries
    return entries.filter(entry => entry instanceof expectedType_) as unknown as T[]
  }

  async find(name_: string): Promise<Road | null>
  async find<T extends Road>(name_: string, expectedType_: new (..._: any[]) => T): Promise<T | null>
  async find<T extends Road>(name_: string, expectedType_?: new (..._: any[]) => T): Promise<Road | T | null> {
    try {
      await fp.access(this.join(name_), fs.constants.F_OK)
      const found = await factory(this.join(name_))
      if (!expectedType_)
        return found
      if (found instanceof expectedType_)
        return found as T
      return null
    } catch {
      return null
    }
  }
  findSync(name_: string): Road | null
  findSync<T extends Road>(name_: string, expectedType_: new (..._: any[]) => T): T | null
  findSync<T extends Road>(name_: string, expectedType_?: new (..._: any[]) => T): Road | T | null {
    try {
      const found = factorySync(this.join(name_))
      if (!expectedType_)
        return found
      if (found instanceof expectedType_)
        return found as T
      return null
    } catch {
      return null
    }
  }

  async add<T extends Road>(name_: string, createable_: { create: (at: string) => Promise<T> }): Promise<T> {
    const newPath = this.join(name_)
    await createable_.create(newPath)
    return (await factory(newPath)) as unknown as T
  }
  addSync<T extends Road>(name_: string, createable_: { createSync: (at: string) => T }): T {
    const newPath = this.join(name_)
    createable_.createSync(newPath)
    return factorySync(newPath) as unknown as T
  }

  async delete(options_: fs.RmOptions = { recursive: true }) {
    using _ = await this.lock()
    await fp.rm(this.isAt, options_)
  }
  deleteSync(options_: fs.RmOptions = { recursive: true }) {
    using _ = this.lockSync()
    fs.rmSync(this.isAt, options_)
  }
  async move(into_: Folder) {
    using _ = await this.lock()
    const newPath = into_.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  moveSync(into_: Folder) {
    using _ = this.lockSync()
    const newPath = into_.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async copy(into_: Folder): Promise<this> {
    const newPath = into_.join(this.name)
    await fp.cp(this.isAt, newPath, { recursive: true })
    return new Folder(newPath, false) as this
  }
  copySync(into_: Folder): this {
    const newPath = into_.join(this.name)
    fs.cpSync(this.isAt, newPath, { recursive: true })
    return new Folder(newPath, false) as this
  }
  async rename(to_: string) {
    using _ = await this.lock()
    const newPath = this.parent().join(to_)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  renameSync(to_: string) {
    using _ = this.lockSync()
    const newPath = this.parent().join(to_)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }

  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isDirectory() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isDirectory() }

  override isFolder(): this is Folder { return true as const }
  override isDir(): this is Folder { return true as const }
  override isDirectory(): this is Folder { return true as const }
  override isDict(): this is Folder { return true as const }
  override isDictionary(): this is Folder { return true as const }
}


export function sysRoot() { return new Folder(ph.parse(process.cwd()).root, false) }
export function home() { return new Folder(os.homedir(), false) }
export function tmp() { return new Folder(os.tmpdir(), false) }
export function here() { return new Folder(process.cwd(), false) }
export { Folder as Dir, Folder as Directory, Folder as Dict, Folder as Dictionary }



export class SymbolicLink extends Road {
  static async create(at_: string, target_: string | Road) {
    try { await fp.access(at_, fs.constants.F_OK) }
    catch { await fp.symlink(target_.toString(), at_) }
    return new SymbolicLink(at_, false)
  }
  static createSync(at_: string, target_: string | Road) {
    try { fs.accessSync(at_, fs.constants.F_OK) }
    catch { fs.symlinkSync(target_.toString(), at_) }
    return new SymbolicLink(at_, false)
  }

  async target() {
    return factory(ph.resolve(ph.dirname(this.isAt), await fp.readlink(this.isAt)))
  }
  targetSync() {
    return factorySync(ph.resolve(ph.dirname(this.isAt), fs.readlinkSync(this.isAt)))
  }
  async retarget(to_: Road) {
    await this.delete()
    return fp.symlink(to_.isAt, this.isAt)
  }
  retargetSync(to_: Road) {
    this.deleteSync()
    fs.symlinkSync(to_.isAt, this.isAt)
  }

  async delete() {
    using _ = await this.lock()
    await fp.unlink(this.isAt)
  }
  deleteSync() {
    using _ = this.lockSync()
    fs.unlinkSync(this.isAt)
  }
  async move(into_: Folder) {
    using _ = await this.lock()
    const newPath = into_.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  moveSync(into_: Folder) {
    using _ = this.lockSync()
    const newPath = into_.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async copy(into_: Folder): Promise<this> {
    const newPath = into_.join(this.name)
    const target = await this.target()
    await fp.symlink(target.isAt, newPath)
    return new SymbolicLink(newPath, false) as this
  }
  copySync(into_: Folder): this {
    const newPath = into_.join(this.name)
    const target = this.targetSync()
    fs.symlinkSync(target.isAt, newPath)
    return new SymbolicLink(newPath, false) as this
  }
  async rename(to_: string) {
    using _ = await this.lock()
    const newPath = this.parent().join(to_)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  renameSync(to_: string) {
    using _ = this.lockSync()
    const newPath = this.parent().join(to_)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }

  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isSymbolicLink() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isSymbolicLink() }

  override isSymlink(): this is SymbolicLink { return true as const }
  override isSymbolicLink(): this is SymbolicLink { return true as const }
}
export { SymbolicLink as Symlink }



export abstract class UnusableRoad extends Road {
  override readonly mutable: boolean = false // Modification will cause system issues (e.g. deleting a device file)
  constructor(...args_: ConstructorParameters<typeof Road>) {
    super(...args_)
    Object.freeze(this)
  }
  error(): never { throw new RdErr(`${this.constructor.name} at '${this.isAt}' is a system-level resource thus not subject to modification.`) }
  override async lock(): Promise<never> { return this.error() }
  override lockSync(): never { return this.error() }
  override async delete(): Promise<never> { return this.error() }
  override deleteSync(): never { return this.error() }
  override async move(): Promise<never> { return this.error() }
  override moveSync(): never { return this.error() }
  override async copy(): Promise<never> { return this.error() }
  override copySync(): never { return this.error() }
  override async rename(): Promise<never> { return this.error() }
  override renameSync(): never { return this.error() }
  
  override isUnusable(): this is UnusableRoad { return true as const }
}
export class BlockDevice extends UnusableRoad {
  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isBlockDevice() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isBlockDevice() }
  override isBlockDevice(): this is BlockDevice { return true as const }
}
export class CharacterDevice extends UnusableRoad {
  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isCharacterDevice() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isCharacterDevice() }
  override isCharacterDevice(): this is CharacterDevice { return true as const }
}
export class Fifo extends UnusableRoad {
  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isFIFO() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isFIFO() }
  override isFifo(): this is Fifo { return true as const }
}
export class Socket extends UnusableRoad {
  async check(): Promise<boolean> { return (await fp.lstat(this.isAt)).isSocket() }
  checkSync(): boolean { return fs.lstatSync(this.isAt).isSocket() }
  override isSocket(): this is Socket { return true as const }
}



let finalizer: FinalizationRegistry<string> | null = null
let toDelete: Set<string> | null = null
let exitHandlerRegistered: boolean | null = null
/**
 * Forcefully cleans up all files and folders registered for cleanup on exit.
 */
function forceCleanupToDelete() {
  for (const path of toDelete ?? [])
    try { fs.rmSync(path, { force: true, recursive: true }) } catch {}
  toDelete?.clear()
  toDelete = null
  finalizer = null
  if (exitHandlerRegistered)
    process.off('exit', forceCleanupToDelete)
  exitHandlerRegistered = false
}
export function registerToCleanup(self_: Road) {
  finalizer ??= new FinalizationRegistry<string>(p => { try { fs.rmSync(p, { force: true, recursive: true }) } catch {}; toDelete?.delete(p) })
  toDelete ??= new Set()
  if (!exitHandlerRegistered) {
    process.once('exit', forceCleanupToDelete)
    exitHandlerRegistered = true
  }
  toDelete.add(self_.isAt)
  finalizer.register(self_, self_.isAt, self_)
}


export function Temp<T extends Road>(createable_: { createSync: (at: string) => T }, autoCleanup_: boolean): T & Disposable & AsyncDisposable {
  let t = createable_.createSync(tmp().join(`instrumentality@${cr.randomUUID()}`))
  if (autoCleanup_)
    registerToCleanup(t)
  return Object.freeze(Object.assign(t, {
    [Symbol.dispose]() { try { t.deleteSync() } catch {} toDelete?.delete(t.isAt); finalizer?.unregister(t) },
    async [Symbol.asyncDispose]() { try { await t.delete() } catch {} toDelete?.delete(t.isAt); finalizer?.unregister(t) }
  }))
}11