import * as cr from "node:crypto"
import * as fs from "node:fs"; import { constants as fsc } from "node:fs"
import * as fp from "node:fs/promises"
import * as ph from "node:path"
import * as os from "node:os"
import { on } from "node:events"
import { InsErr } from "./base.ts"



/** Subclass of {@link InsErr} that represents an error thrown from this specific module of the library */
export class Err extends InsErr { override name = "Instrumentality-Road-Error" }
export { Err as RoadError, Err as RdErr }



/**
 * Returns the constructor function corresponding to the file mode (statmode).
 * 
 * @param statmode_ The file mode or {@link fs.Dirent} to check.
 * @returns The constructor function corresponding to the road type (e.g., {@link File}, {@link Folder}, etc.).
 * @throws If the file mode is unknown, throws a {@link Err}.
 */
export function resolveStat(statmode_: number): typeof File | typeof Folder | typeof BlockDevice | typeof CharacterDevice | typeof SymbolicLink | typeof Fifo | typeof Socket {
  switch (statmode_ & fsc.S_IFMT) {
    case fsc.S_IFREG: return File
    case fsc.S_IFDIR: return Folder
    case fsc.S_IFBLK: return BlockDevice
    case fsc.S_IFCHR: return CharacterDevice
    case fsc.S_IFLNK: return SymbolicLink
    case fsc.S_IFIFO: return Fifo
    case fsc.S_IFSOCK: return Socket
    default: throw new Err(`Unknown mode type ${statmode_} (statmode is most likely corrupted)`)
  }
}
export { resolveStat as resStat }

/**
 * Returns the constructor function corresponding to the type of the given {@link fs.Dirent}.
 * 
 * @param dirent The directory entry to check.
 * @returns The constructor function corresponding to the road type (e.g., {@link File}, {@link Folder}, etc.).
 * @throws If the directory entry type is unknown, throws a {@link Err}.
 */
export function resolveDirent(dirent: fs.Dirent): typeof File | typeof Folder | typeof BlockDevice | typeof CharacterDevice | typeof SymbolicLink | typeof Fifo | typeof Socket {
  // Order by likelihood: files/dicts are most common, followed by symbolic links
  if (dirent.isFile()) return File
  if (dirent.isDirectory()) return Folder
  if (dirent.isSymbolicLink()) return SymbolicLink
  if (dirent.isBlockDevice()) return BlockDevice
  if (dirent.isCharacterDevice()) return CharacterDevice
  if (dirent.isFIFO()) return Fifo
  if (dirent.isSocket()) return Socket
  throw new Err(`Unknown dirent type for ${dirent.name}`)
}
export { resolveDirent as resDirent }



/**
 * Creates the appropriate subclass of {@link Road} based on the file mode of the specified path.
 *
 * @param path_ The path to follow.
 * @returns A new instance of {@link Road}.
 * @throws If {@link fp.lstat}/{@link fs.lstatSync} fails to retrieved the status of {@link path_}.
 */
export async function factory(path_: string) {
  return new (resolveStat((await fp.lstat(path_)).mode))(path_, false)
}
export { factory as fac, factory as mk }
/** Sync version of {@link factory}. */
export function factorySync(path_: string) {
  return new (resolveStat(fs.lstatSync(path_).mode))(path_, false)
}
export { factorySync as facSync, factorySync as mkSync }



/**
 * A map that keeps track of locked roads to prevent concurrent modifications.
 * 
 * @key The **absolute** and **normalized** (**resolved**) path of the road that is currently locked.
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
  toString(): string { return this.isAt }

  /**
   * Creates a new instance of the Road class.
   * 
   * @param path_ Any path-like string that can be resolved to an absolute path. It will be resolved to an absolute path using {@link ph.resolve}.
   * @param typeCheck_ If true, the constructor will check if the path corresponds to the expected type of road (e.g., file, folder, etc.) and throw an error if it doesn't. If false, no type checking will be performed.
   * 
   * @throws If {@link typeCheck_} is true and the path does not correspond to the expected type of road, a {@link Err} will be thrown.
   */
  constructor(path_: string, typeCheck_: boolean) {
    this.pointsTo = ph.resolve(path_)
    if (typeCheck_ && !this.checkSync())
      throw new Err(`Type mismatch: '${this.isAt}'`)
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

  protected reserveLock(allowConcurrent: boolean): Disposable & { previous: Promise<void> | undefined } {
    if (!this.mutable)
      throw new Err(`Road to '${this.isAt}' is immutable.`)
    lockedRoads ??= new Map()
    const { promise, resolve } = Promise.withResolvers<void>()
    const isAt = this.isAt
    const previous = lockedRoads.get(this.isAt)
    if (!allowConcurrent && previous)
      throw new Err(`Road to '${this.isAt}' is already locked.`)
    lockedRoads.set(this.isAt, promise)
    return {
      [Symbol.dispose]: () => {
        resolve()
        if (lockedRoads!.get(isAt) === promise)
          lockedRoads!.delete(isAt)
      },
      previous,
    }
  }
  async lock(): Promise<Disposable> {
    const l = this.reserveLock(true)
    try { await l.previous } catch {}
    return l
  }
  lockSync(): Disposable {
    return this.reserveLock(false)
  }

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

  /** Get the size of the this entry in bytes. */
  abstract size(): Promise<number>
  abstract sizeSync(): number

  /** Wrapper around {@link fp.rm} with locking. */
  async delete(): Promise<void> {
    using _ = await this.lock()
    await fp.rm(this.isAt, { recursive: true, force: true })
  }
  /** Wrapper around {@link fs.rmSync} with locking. */
  deleteSync(): void {
    using _ = this.lockSync()
    fs.rmSync(this.isAt, { recursive: true, force: true })
  }
  async copy(into_: Folder): Promise<this> {
    const newPath = into_.join(this.name)
    await fp.cp(this.isAt, newPath, { recursive: true, force: true })
    return new (this.constructor as new (path: string, typeCheck: boolean) => this)(newPath, false)
  }
  copySync(into_: Folder): this {
    const newPath = into_.join(this.name)
    fs.cpSync(this.isAt, newPath, { recursive: true, force: true })
    return new (this.constructor as new (path: string, typeCheck: boolean) => this)(newPath, false)
  }
  async move(into_: Folder): Promise<void> {
    using _ = await this.lock()
    const newPath = into_.join(this.name)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  moveSync(into_: Folder): void {
    using _ = this.lockSync()
    const newPath = into_.join(this.name)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  async rename(newName_: string): Promise<void> {
    using _ = await this.lock()
    const newPath = this.parent().join(newName_)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  renameSync(newName_: string): void {
    using _ = this.lockSync()
    const newPath = this.parent().join(newName_)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }

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
/** Constructor type for a subclass of {@link Road}. */
export type road_t<T extends Road> = new (...args_: ConstructorParameters<typeof Road>) => T



/** Subclass of {@link Road} that represents a file. */
export class File extends Road {
  /**
   * Creates a new file at the specified path if it does not already exist.
   * 
   * @param at_ The path at which to create the file.
   * @returns A promise that resolves to the newly created `File` instance.
   * @throws if {@link fp.writeFile} throws.
   */
  static async create(at_: string, data: string | Buffer = "") {
    try { await fp.access(at_, fsc.W_OK) }
    catch { await fp.writeFile(at_, data) }
    return new File(at_, true)
  }
  /** Alias for {@link File.create}. */
  static readonly mk: typeof File.create = File.create
  /** Synchronous version of {@link File.create}. */
  static createSync(at_: string, data: string | Buffer = "") {
    try { fs.accessSync(at_, fs.constants.W_OK) }
    catch { fs.writeFileSync(at_, data) }
    return new File(at_, true)
  }
  /** Alias for {@link File.createSync}. */
  static readonly mkSync: typeof File.createSync = File.createSync

  /** The file extension of this file, including the leading dot. */
  get ext() { return ph.extname(this.isAt) }
  /** The file name without its extension. */
  get noExt() { return ph.basename(this.isAt, this.ext) }

  /**
   * Reads the contents of the file.
   * 
   * @returns A promise that resolves to the contents of the file as a `Buffer` or `string`, depending on the specified encoding.
   * @throws If the file can't be read due to permission issues or other filesystem errors.
   */
  async read(): Promise<Buffer>
  async read(options_: Parameters<typeof fp.readFile>[1]): Promise<string>
  async read(options_?: Parameters<typeof fp.readFile>[1]): Promise<Buffer | string> {
    return fp.readFile(this.isAt, options_!)
  }
  readSync(): Buffer
  readSync(options_: Parameters<typeof fs.readFileSync>[1]): string
  readSync(options_?: Parameters<typeof fs.readFileSync>[1]): Buffer | string {
    return fs.readFileSync(this.isAt, options_!)
  }

  async *itBuff(options_?: Exclude<Parameters<typeof fs.createReadStream>[1], BufferEncoding> & {encoding?:never}): AsyncGenerator<Buffer> {
    const stream = fs.createReadStream(this.isAt, { ...options_, encoding: undefined })
    try {
      for await (const chunk of stream)
        yield chunk
    }
    finally { if (!stream.destroyed) stream.destroy() }
  }
  *itBuffSync(chunkSize_: number = 64 * 1024, flags_: string | number = 'r', mode_?: fs.Mode): Generator<Buffer> {
    const fd = fs.openSync(this.isAt, flags_, mode_)
    try {
      const buffer = Buffer.alloc(chunkSize_)
      let bytesRead: number
      do {
        bytesRead = fs.readSync(fd, buffer, 0, chunkSize_, null)
        if (bytesRead > 0)
          yield Buffer.from(buffer.subarray(0, bytesRead))
      } while (bytesRead === chunkSize_)
    }
    finally { fs.closeSync(fd) }
  }

  async sameAs(other_: File): Promise<boolean> {
    if (this.isAt === other_.isAt) return true
    const [s1, s2] = await Promise.all([this.size(), other_.size()])
    if (s1 !== s2) return false
    if (s1 === 0) return true
    const iter1 = this.itBuff()
    const iter2 = other_.itBuff()
    try {
      while (true) {
        const [a, b] = await Promise.all([iter1.next(), iter2.next()])
        if (a.done && b.done) return true
        if (a.done !== b.done) return false
        if (!a.value.equals(b.value)) return false
      }
    }
    finally { await Promise.all([iter1.return?.(undefined), iter2.return?.(undefined)]) }
  }
  sameAsSync(other_: File): boolean {
    if (this.isAt === other_.isAt) return true
    const [s1, s2] = [this.sizeSync(), other_.sizeSync()]
    if (s1 !== s2) return false
    if (s1 === 0) return true
    const iter1 = this.itBuffSync()
    const iter2 = other_.itBuffSync()
    try {
      while (true) {
        const a = iter1.next()
        const b = iter2.next()
        if (a.done && b.done) return true
        if (a.done !== b.done) return false
        if (!a.value!.equals(b.value!)) return false
      }
    }
    finally {
      try { iter1.return?.(undefined) } catch {}
      try { iter2.return?.(undefined) } catch {}
    }
  }

  async hash(algorithm_?: string, options_?: cr.HashOptions): Promise<Buffer>
  async hash(algorithm_?: string, options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Promise<string>
  async hash(algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Promise<Buffer | string> {
    const hash = cr.createHash(algorithm_, options_)
    for await (const chunk of this.itBuff())
      hash.update(chunk)
    return encoding_ ? hash.digest(encoding_) : hash.digest()
  }
  hashSync(algorithm_?: string, options_?: cr.HashOptions): Buffer
  hashSync(algorithm_?: string, options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): string
  hashSync(algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Buffer | string {
    const hash = cr.createHash(algorithm_, options_)
    for (const chunk of this.itBuffSync())
      hash.update(chunk)
    return encoding_ ? hash.digest(encoding_) : hash.digest()
  }

  async size(): Promise<number> { return (await this.lstat()).size }
  sizeSync(): number { return this.lstatSync().size }

  async writeAtomic(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = await this.lock()
    await this.parent().borrow(File, async tmp => {
      using _ = await tmp.lock()
      await fp.writeFile(tmp.isAt, data_, options_)
      await fp.rename(tmp.isAt, this.isAt)
    })
  }
  writeAtomicSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    this.parent().borrowSync(File, tmp => {
      using _ = tmp.lockSync()
      fs.writeFileSync(tmp.isAt, data_, options_)
      fs.renameSync(tmp.isAt, this.isAt)
    })
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

  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isFile() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isFile() } catch { return false } }

  override isFile(): this is File { return true as const }
}



/** Helper type for filtering {@link Road} instances. */
export type filter_t<T extends Road> = ((road: Road) => road is T)

export class Folder extends Road {
  static async create(at_: string) {
    try { await fp.access(at_, fsc.W_OK) }
    catch { await fp.mkdir(at_, { recursive: true }) }
    return new Folder(at_, false)
  }
  static readonly mk: typeof Folder.create = Folder.create
  static createSync(at_: string) {
    try { fs.accessSync(at_, fsc.W_OK) }
    catch { fs.mkdirSync(at_, { recursive: true }) }
    return new Folder(at_, false)
  }
  static readonly mkSync: typeof Folder.createSync = Folder.createSync

  join(...paths_: string[]) {
    return ph.join(this.isAt, ...paths_)
  }

  it(): AsyncIterable<Road>
  it<T extends Road>(filter_: filter_t<T>): AsyncIterable<T>
  async *it<T extends Road>(filter_?: filter_t<T>): AsyncIterable<Road> | AsyncIterable<T> {
    for (const entry of await fp.readdir(this.isAt, { withFileTypes: true })) {
      const road = new (resolveDirent(entry))(this.join(entry.name), false)
      if (!filter_ || filter_(road))
        yield road
    }
  }
  itSync(): Iterable<Road>
  itSync<T extends Road>(filter_: filter_t<T>): Iterable<T>
  *itSync<T extends Road>(filter_?: filter_t<T>): Iterable<Road> | Iterable<T> {
    for (const entry of fs.readdirSync(this.isAt, { withFileTypes: true })) {
      const road = new (resolveDirent(entry))(this.join(entry.name), false)
      if (!filter_ || filter_(road))
        yield road
    }
  }

  async list(): Promise<Road[]>
  async list<T extends Road>(filter_: filter_t<T>): Promise<T[]>
  async list<T extends Road>(filter_?: filter_t<T>): Promise<Road[] | T[]> {
    const entries = (await fp.readdir(this.isAt, { withFileTypes: true })).map(e => new (resolveDirent(e))(this.join(e.name), false))
    return filter_ ? entries.filter(entry => filter_(entry)) : entries
  }
  listSync(): Road[]
  listSync<T extends Road>(filter_: filter_t<T>): T[]
  listSync<T extends Road>(filter_?: filter_t<T>): Road[] | T[] {
    const entries = fs.readdirSync(this.isAt, { withFileTypes: true }).map(e => new (resolveDirent(e))(this.join(e.name), false))
    return filter_ ? entries.filter(entry => filter_(entry)) : entries
  }

  walk(): AsyncIterable<Road>
  walk<T extends Road>(filter_: filter_t<T>): AsyncIterable<T>
  walk(filter_: (r: Road) => boolean): AsyncIterable<Road>
  async *walk<T extends Road>(filter_?: filter_t<T> | ((r: Road) => boolean)): AsyncIterable<T> | AsyncIterable<Road> {
    for await (const entry of this.it()) {
      if (!filter_ || filter_(entry))
        yield entry

      if (entry.isDir())
        yield* entry.walk(filter_!)
    }
  }
  walkSync(): Iterable<Road>
  walkSync<T extends Road>(filter_: filter_t<T>): Iterable<T>
  walkSync(filter_: (r: Road) => boolean): Iterable<Road>
  *walkSync<T extends Road>(filter_?: filter_t<T> | ((r: Road) => boolean)): Iterable<T> | Iterable<Road> {
    for (const entry of this.itSync()) {
      if (!filter_ || filter_(entry))
        yield entry

      if (entry.isDir())
        yield* entry.walkSync(filter_!)
    }
  }

  async find(name_: string): Promise<Road | null>
  async find<T extends Road>(name_: string, expect_: road_t<T>): Promise<T | null>
  async find<T extends Road>(name_: string, expect_?: road_t<T>): Promise<Road | T | null> {
    try {
      const found = await factory(this.join(name_))
      if (!expect_)
        return found
      if (found instanceof expect_)
        return found as T
      return null
    }
    catch { return null }
  }
  findSync(name_: string): Road | null
  findSync<T extends Road>(name_: string, expect_: road_t<T>): T | null
  findSync<T extends Road>(name_: string, expect_?: road_t<T>): Road | T | null {
    try {
      const found = factorySync(this.join(name_))
      if (!expect_)
        return found
      if (found instanceof expect_)
        return found as T
      return null
    }
    catch(e: unknown) { return null }
  }

  async add<T extends Road>(name_: string, createable_: { mk: (at: string) => Promise<T> }): Promise<T> {
    const newPath = this.join(name_)
    await createable_.mk(newPath)
    return (await factory(newPath)) as unknown as T
  }
  addSync<T extends Road>(name_: string, createable_: { mkSync: (at: string) => T }): T {
    const newPath = this.join(name_)
    createable_.mkSync(newPath)
    return factorySync(newPath) as unknown as T
  }

  async borrow<T extends Road>(createable_: { mk: (at: string) => Promise<T> }, cb_: (r: T) => Promise<void> | void): Promise<void> {
    const path = this.join(`instrumentality@${crypto.randomUUID()}`)
    try { await cb_(await createable_.mk(path)) }
    finally { await fp.rm(path, { recursive: true, force: true }) }
  }
  borrowSync<T extends Road>(createable_: { mkSync: (at: string) => T }, cb_: (r: T) => void): void {
    const path = this.join(`instrumentality@${crypto.randomUUID()}`)
    try { cb_(createable_.mkSync(path)) }
    finally { fs.rmSync(path, { recursive: true, force: true }) }
  }

  async size(): Promise<number> {
    let size = 0
    for await (const entry of this.it())
      size += await entry.size()
    return size
  }
  sizeSync(): number {
    let size = 0
    for (const entry of this.itSync())
      size += entry.sizeSync()
    return size
  }

  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isDirectory() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isDirectory() } catch { return false } }

  override isFolder(): this is Folder { return true as const }
  override isDir(): this is Folder { return true as const }
  override isDirectory(): this is Folder { return true as const }
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
  static readonly mk: typeof SymbolicLink.create = SymbolicLink.create
  static createSync(at_: string, target_: string | Road) {
    try { fs.accessSync(at_, fs.constants.F_OK) }
    catch { fs.symlinkSync(target_.toString(), at_) }
    return new SymbolicLink(at_, false)
  }
  static readonly mkSync: typeof SymbolicLink.createSync = SymbolicLink.createSync

  async target() {
    return factory(ph.resolve(ph.dirname(this.isAt), await fp.readlink(this.isAt)))
  }
  targetSync() {
    return factorySync(ph.resolve(ph.dirname(this.isAt), fs.readlinkSync(this.isAt)))
  }
  async retarget(to_: Road) {
    using _ = await this.lock()
    await fp.unlink(this.isAt)
    await fp.symlink(to_.isAt, this.isAt)
  }
  retargetSync(to_: Road) {
    using _ = this.lockSync()
    fs.unlinkSync(this.isAt)
    fs.symlinkSync(to_.isAt, this.isAt)
  }

  async size(): Promise<number> { return (await this.lstat()).size }
  sizeSync(): number { return this.lstatSync().size }

  override async delete() {
    using _ = await this.lock()
    await fp.unlink(this.isAt)
  }
  override deleteSync() {
    using _ = this.lockSync()
    fs.unlinkSync(this.isAt)
  }

  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isSymbolicLink() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isSymbolicLink() } catch { return false } }

  override isSymlink(): this is SymbolicLink { return true as const }
  override isSymbolicLink(): this is SymbolicLink { return true as const }
}
export { SymbolicLink as Symlink }



export abstract class UnusableRoad extends Road {
  override readonly mutable = false as const // Modification will cause system issues (e.g. deleting a device file)
  async size(): Promise<0> { return 0 }
  sizeSync(): 0 { return 0 }
  error(): never { throw new Err(`${this.constructor.name} at '${this.isAt}' is a system-level resource thus not subject to modification.`) }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be locked */
  override lock(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be locked */
  override lockSync(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be deleted */
  override delete(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be deleted */
  override deleteSync(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be moved */
  override move(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be moved */
  override moveSync(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be copied */
  override copy(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be copied */
  override copySync(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be renamed */
  override rename(): never { return this.error() }
  /** @deprecated System-level resources (UnusableRoad) can't/shouldn't be renamed */
  override renameSync(): never { return this.error() }

  override isUnusable(): this is UnusableRoad { return true as const }
}
export class BlockDevice extends UnusableRoad {
  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isBlockDevice() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isBlockDevice() } catch { return false } }
  override isBlockDevice(): this is BlockDevice { return true as const }
}
export class CharacterDevice extends UnusableRoad {
  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isCharacterDevice() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isCharacterDevice() } catch { return false } }
  override isCharacterDevice(): this is CharacterDevice { return true as const }
}
export class Fifo extends UnusableRoad {
  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isFIFO() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isFIFO() } catch { return false } }
  override isFifo(): this is Fifo { return true as const }
}
export class Socket extends UnusableRoad {
  async check(): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isSocket() } catch { return false } }
  checkSync(): boolean { try { return fs.lstatSync(this.isAt).isSocket() } catch { return false } }
  override isSocket(): this is Socket { return true as const }
}