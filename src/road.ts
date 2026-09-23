/// <reference types="node" />
import * as cr from "node:crypto"
import * as fs from "node:fs"; import { constants as fsc } from "node:fs"
import * as fp from "node:fs/promises"
import * as ph from "node:path"
import * as os from "node:os"
import { on } from "node:events"
import * as bs from "./base.ts"



/** Subclass of {@link bs.InsErr} that represents an error thrown from this specific module of the library */
export class Err extends bs.Err { override name = "Instrumentality-Road-Error" }
export { Err as RoadError, Err as RdErr }
/** Represents the primitive/elementary road types in the file system that this module recognizes. */
export type Primitives = typeof File | typeof Folder | typeof BlockDevice | typeof CharacterDevice | typeof SymbolicLink | typeof Fifo | typeof Socket
/** Constructor type for a subclass of {@link Road}. */
export type road_t<T extends Road> = new (...args_: ConstructorParameters<typeof Road>) => T



/**
 * Resolves the primitive road type based on the provided `statmode_` value.
 * 
 * @param statmode_ The mode value from a `fs.Stats` object, typically obtained from `stat.mode`.
 * @returns The corresponding primitive road type constructor (e.g., {@link File}, {@link Folder}, etc.).
 * @throws {Err} If the {@link statmode_} doesn't correspond to any recognized primitive road type.
 */
export function resolveStat(statmode_: number): Primitives {
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
 * Resolves the primitive road type based on the provided `fs.Dirent` object.
 * 
 * @param dirent_ The `fs.Dirent` object representing a directory entry.
 * @returns The corresponding primitive road type constructor (e.g., {@link File}, {@link Folder}, etc.).
 * @throws {Err} If the {@link dirent_} doesn't correspond to any recognized primitive road type.
 */
export function resolveDirent(dirent_: fs.Dirent): Primitives {
  // Order by likelihood: files/dicts are most common, followed by symbolic links
  if (dirent_.isFile()) return File
  if (dirent_.isDirectory()) return Folder
  if (dirent_.isSymbolicLink()) return SymbolicLink
  if (dirent_.isBlockDevice()) return BlockDevice
  if (dirent_.isCharacterDevice()) return CharacterDevice
  if (dirent_.isFIFO()) return Fifo
  if (dirent_.isSocket()) return Socket
  throw new Err(`Unknown dirent type for ${dirent_.name}`)
}
export { resolveDirent as resDirent }



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
 * The default path separator that is recognized/supported by this module.
 * 
 * \\ is intentionally not used as the default separator to maintain consistency across different operating systems. (Windows supports both \\ and /, but / is preferred here.)
 */
export const PH_SEP = '/' as const
export { PH_SEP as PATH_SEPARATOR }


/**
 * Normalizes a given path to an absolute path with normalized separators.
 * 
 * @param path_ Any path-like string that can be resolved to an absolute path.
 * @returns The absolute path with normalized separators.
 */
export function normalize(path_: string): string { return ph.resolve(path_).replace(/\\/g, PH_SEP) }



/**
 * Road is an OOP, pointer-like representation of an entry in the local file system. It wraps around the Node.js fs module and provides a more convenient access to it.
 * It's meant to help the user mentally model an entry and help them reason about it, as well as provide a more convenient API and guardrails for common operations.
 * 
 * @remarks This is by no means a one-to-one mapping of the underlying file system (after initialization).
 * It is more like a memory representation, similar to a pointer in low-level programming languages; other processes might mess with the underlying entry. There are methods to check for consistency, but they are not guaranteed to be foolproof.
 * But, let's be real, Road is most certainly superior to raw strings as paths.
 */
export abstract class Road {
  /** The absolute path to the entry that this Road instance represents.
   * @remarks Changing this value recklessly **WILL** lead to inconsistencies and unexpected behavior. */
  protected pointsTo: string
  /** The absolute path. */
  get isAt() { return this.pointsTo }

  // Quick accessors
  /** Name of the road without the path, excluding extensions. */
  get name() { return ph.basename(this.isAt, this.ext) }
  /** The file extension of the road's entry, including the leading dot. */
  get ext() { return ph.extname(this.isAt) }
  /** The file name with its extension. */
  get base() { return ph.basename(this.isAt) }
  /** The amount of path segments in the absolute path to the entry represented by this Road instance, minus one (i.e., the depth of the path in the file system hierarchy). */
  get depth() { return this.isAt.split(PH_SEP).length - 1 }
  /** Same as {@link isAt} but for compatibility with external APIs. */
  toString(): string { return this.isAt }

  /**
   * Creates a new instance of the Road class.
   * 
   * @param path_ Any path-like string that can be resolved to an absolute path.
   * @param typeCheck_ Check if the path corresponds to the expected type of road (e.g., file, folder, etc.) and throw an error if it doesn't. If false, no type checking will be performed.
   * @throws If {@link typeCheck_} is true and {@link checkSync} returns either false ({@link Err}) or throws an error.
   */
  constructor(path_: string, typeCheck_: boolean|0|1) {
    this.pointsTo = normalize(path_)
    if (typeCheck_ && !this.checkSync(true))
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

  /**
   * Watches the current entry for changes and resolves when the entry becomes accessible (i.e., exists and can be accessed).
   * 
   * @param abs An {@link AbortSignal} that stops the watching process when aborted.
   * @param expectMode The expected access mode for the entry, defaults to {@link fsc.F_OK} (existence check).
   * @param cb_ An optional callback function that will be called with any errors encountered while checking for accessibility.
   * @throws If an error occurs while watching the entry or checking its accessibility.
   */
  async untilAccessible(abs: AbortSignal, expectMode = fsc.F_OK, cb_?: (err: unknown) => unknown): Promise<void> {
    const watcher = fs.watch(this.isAt)
    try {
      for await (const _ of on(watcher, 'change', { signal: abs })) {
        try { return await fp.access(this.isAt, expectMode) }
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
  async onChange<T>(abs_: AbortSignal, cb_?: () => T): Promise<T | null> {
    const watcher = fs.watch(this.isAt)
    try {
      for await (const _ of on(watcher, 'change', { signal: abs_ }))
        return await cb_?.() ?? null
      return null
    }
    catch(e) { throw e }
    finally { watcher.close() }
  }

  // jsdocs for the abstract methods are in the subclasses
  abstract check(throwOnError_: boolean): Promise<boolean>
  abstract checkSync(throwOnError_: boolean): boolean

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
  /** Type narrowing for {@link RoadEdit} (similar to `instanceof` without unnecessary runtime checks). */
  isRoadEdit(): this is RoadEdit { return false as const }
  /** Type narrowing for {@link RoadEdit} (similar to `instanceof` without unnecessary runtime checks). */
  isMutable(): this is RoadEdit { return false as const }
  /** Type narrowing for {@link RoadEdit} (similar to `instanceof` without unnecessary runtime checks). */
  isMutableRoad(): this is RoadEdit { return false as const }
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


/** Abstract subclass of {@link Road} that represents a road type that can be natively modified. */
export abstract class RoadEdit extends Road {
  /** Are write operations allowed? */
  writable = true
  /** Are move operations allowed? */
  moveable = true
  /** Are delete operations allowed? */
  deletable = true
  /** Are copy operations allowed? */
  copyable = true
  /** Are rename operations allowed? */
  renameable = true
  /** Assert that write operations are allowed. */
  assertWrite(): void { if (!this.writable) throw new Err(`Road to '${this.isAt}' isn't writable.`) }
  /** Assert that move operations are allowed. */
  assertMove(): void { if (!this.moveable) throw new Err(`Road to '${this.isAt}' isn't moveable.`) }
  /** Assert that delete operations are allowed. */
  assertDelete(): void { if (!this.deletable) throw new Err(`Road to '${this.isAt}' isn't deletable.`) }
  /** Assert that copy operations are allowed. */
  assertCopy(): void { if (!this.copyable) throw new Err(`Road to '${this.isAt}' isn't copyable.`) }
  /** Assert that rename operations are allowed. */
  assertRename(): void { if (!this.renameable) throw new Err(`Road to '${this.isAt}' isn't renameable.`) }

  /**
   * Reserve a lock for the current road entry.
   *
   * @param allowConcurrent Whether to allow concurrent locks on the same road entry.
   * @returns An object containing the lock disposable and the previous lock promise, if any.
   * @throws {Err} If a lock is already held and concurrent locks are not allowed.
  */
  protected reserveLock(allowConcurrent: boolean): Disposable & { previous: Promise<void> | undefined } {
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
      previous
    }
  }
  /**
   * Acquire a lock for the current road entry, allowing concurrent locks.
   * 
   * @returns A disposable representing the acquired lock.
  */
  async lock(): Promise<Disposable> {
    const l = this.reserveLock(true)
    try { await l.previous } catch { null }
    return l
  }
  /** Acquire a lock for the current road entry, disallowing concurrent locks. */
  lockSync(): Disposable { return this.reserveLock(false) }

  /**
   * Provides a safe context in which to perform multiple operations (compatible with both async and sync usage).
   * 
   * @param cb_ A callback that receives an object containing wrapped versions of these methods.
   * @returns The result of the callback. If the provided callback returns a promise, the returned value can be awaited.
   * @throws If any of the wrapped file operations throw an error. 
   */
  abstract duringLock<T>(cb_: never): Promise<T>

  /** @returns The result of {@link fp.lstat} for the current entry. */
  lstat() { return fp.lstat(this.isAt) }
  /** @returns The result of {@link fs.lstatSync} for the current entry. */
  lstatSync() { return fs.lstatSync(this.isAt) }

  /** Get the size of the this entry in bytes. */
  abstract size(): Promise<number>
  /** Sync version of {@link size}. */
  abstract sizeSync(): number

  /** Unlocked implementation of {@link delete}. */
  async delete$(): Promise<void> {this.assertDelete(); await fp.rm(this.isAt, { recursive: true, force: true }) }
  /**
   * Delete the current entry.
   *
   * @throws Whatever {@link fp.rm} and {@link assertDelete} may throw.
   */
  async delete(): Promise<void> {
    using _ = await this.lock()
    await this.delete$()
  }
  /** Sync version of {@link delete$}. */
  deleteSync$(): void { this.assertDelete(); fs.rmSync(this.isAt, { recursive: true, force: true }) }
  /** Sync version of {@link delete}. */
  deleteSync(): void {
    using _ = this.lockSync()
    this.deleteSync$()
  }
  /**
   * Copy the current entry into the specified folder.
   * 
   * @param into_ The target folder where the current entry should be copied.
   * @returns The new entry representing the copied file or folder.
   * @throws Whatever {@link fp.cp} and {@link assertCopy} may throw.
  */
  async copy(into_: Folder): Promise<this> {
    this.assertCopy()
    const newPath = into_.join(this.base)
    await fp.cp(this.isAt, newPath, { recursive: true, force: true })
    return new (this.constructor as new (path: string, typeCheck: boolean) => this)(newPath, false)
  }
  /** Sync version of {@link copy}. */
  copySync(into_: Folder): this {
    this.assertCopy()
    const newPath = into_.join(this.base)
    fs.cpSync(this.isAt, newPath, { recursive: true, force: true })
    return new (this.constructor as new (path: string, typeCheck: boolean) => this)(newPath, false)
  }
  /** Unlocked implementation of {@link move}. */
  async move$(into_: Folder): Promise<void> {
    this.assertMove()
    const newPath = into_.join(this.base)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  /**
   * Move the current entry into the specified folder.
   *
   * @param into_ The target folder where the current entry should be moved.
   * @throws Whatever {@link fp.rename} and {@link assertMove} may throw.
   */
  async move(into_: Folder): Promise<void> {
    using _ = await this.lock()
    await this.move$(into_)
  }
  /** Sync version of {@link move$}. */
  moveSync$(into_: Folder): void {
    this.assertMove()
    const newPath = into_.join(this.base)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  /** Sync version of {@link move}. */
  moveSync(into_: Folder): void {
    using _ = this.lockSync()
    this.moveSync$(into_)
  }
  /** Unlocked implementation of {@link rename}. */
  async rename$(newName_: string): Promise<void> {
    this.assertRename()
    if (newName_.includes('/') || newName_.includes('\\'))
      throw new Error('New name cannot contain path separators.')
    const newPath = this.parent().join(newName_)
    await fp.rename(this.isAt, newPath)
    this.pointsTo = newPath
  }
  /**
   * Renames the current entry to the specified new name.
   *
   * @param newName_ The new name for the current entry.
   * @throws Whatever {@link fp.rename} and {@link assertRename} may throw.
   */
  async rename(newName_: string): Promise<void> {
    using _ = await this.lock()
    await this.rename$(newName_)
  }
  /** Sync version of {@link rename$}. */
  renameSync$(newName_: string): void {
    this.assertRename()
    if (newName_.includes('/') || newName_.includes('\\'))
      throw new Error('New name cannot contain path separators.')
    const newPath = this.parent().join(newName_)
    fs.renameSync(this.isAt, newPath)
    this.pointsTo = newPath
  }
  /** Sync version of {@link rename}. */
  renameSync(newName_: string): void {
    using _ = this.lockSync()
    this.renameSync$(newName_)
  }

  override isMutableRoad(): this is RoadEdit { return true as const }
  override isMutable(): this is RoadEdit { return true as const }
  override isRoadEdit(): this is RoadEdit { return true as const }
}
export { RoadEdit as MutableRoad }
  


/**
 * Creates the appropriate subclass of {@link Road} based on the file mode of the specified path.
 *
 * @param path_ The path to follow.
 * @returns A new instance of {@link Road}.
 * @throws If {@link fp.lstat}/{@link fs.lstatSync} fails to retrieved the status of {@link path_}.
 */
export async function road(path_: string) { return new (resolveStat((await fp.lstat(path_)).mode))(path_, false) }
export { road as fac, road as mk, road as factory }
/** Sync version of {@link road}. */
export function roadSync(path_: string) { return new (resolveStat((fs.lstatSync(path_).mode)))(path_, false) }
export { roadSync as facSync, roadSync as mkSync, roadSync as factorySync }




/** Subclass of {@link Road} that represents a file. */
export class File extends RoadEdit {
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
  /** Alias for {@link create}. */
  static readonly mk: typeof File.create = File.create
  /** Synchronous version of {@link create}. */
  static createSync(at_: string, data: string | Buffer = "") {
    try { fs.accessSync(at_, fs.constants.W_OK) }
    catch { fs.writeFileSync(at_, data) }
    return new File(at_, true)
  }
  /** Alias for {@link createSync}. */
  static readonly mkSync: typeof File.createSync = File.createSync

  override duringLock<T>(cb_: (self: {
    delete: File['delete$'],
    deleteSync: File['deleteSync$'],
    move: File['move$'],
    moveSync: File['moveSync$'],
    rename: File['rename$'],
    renameSync: File['renameSync$'],
    write: File['write$'],
    writeSync: File['writeSync$'],
  }) => T): T {
    return cb_({
      delete: bs.wFn(this.delete$),
      deleteSync: bs.wFn(this.deleteSync$),
      move: bs.wFn(this.move$),
      moveSync: bs.wFn(this.moveSync$),
      rename: bs.wFn(this.rename$),
      renameSync: bs.wFn(this.renameSync$),
      write: bs.wFn(this.write$),
      writeSync: bs.wFn(this.writeSync$),
    })
  }

  /**
   * Reads the contents of the file.
   * 
   * @param options_ Optional parameters for reading the file, such as encoding.
   * @returns A promise that resolves to the contents of the file as a `Buffer` or `string`, depending on the specified encoding.
   * @throws If the file can't be read due to permission issues or other filesystem errors.
   */
  async read(): Promise<Buffer>
  async read(options_: Parameters<typeof fp.readFile>[1]): Promise<string>
  async read(options_?: Parameters<typeof fp.readFile>[1]): Promise<Buffer | string> {
    return await fp.readFile(this.isAt, options_!)
  }
  /** Sync version of {@link read}. */
  readSync(): Buffer
  readSync(options_: Parameters<typeof fs.readFileSync>[1]): string
  readSync(options_?: Parameters<typeof fs.readFileSync>[1]): Buffer | string {
    return fs.readFileSync(this.isAt, options_!)
  }

  /**
   * Asynchronously iterates over the file's contents in chunks as `Buffer` objects.
   * 
   * @param options_ Optional parameters for creating the read stream, excluding encoding.
   * @returns An async generator yielding `Buffer` chunks of the file's contents.
   * @throws If the file can't be read due to permission issues or other filesystem errors.
   */
  async *itBuff(options_?: Exclude<Parameters<typeof fs.createReadStream>[1], BufferEncoding> & {encoding?:never}): AsyncGenerator<Buffer> {
    const stream = fs.createReadStream(this.isAt, { ...options_ })
    try {
      for await (const chunk of stream)
        yield chunk
    }
    finally { if (!stream.destroyed) stream.destroy() }
  }
  /**
   * Synchronously iterates over the file's contents in chunks as `Buffer` objects.
   * 
   * @param chunkSize_ The size of each chunk to read. Defaults to 64 KB.
   * @param flags_ Flags for opening the file. Defaults to 'r' (read).
   * @param mode_ Optional file mode.
   * @returns A generator yielding `Buffer` chunks of the file's contents.
   * @throws If the file can't be read due to permission issues or other filesystem errors.
   */
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

  /**
   * Compares the contents of this file with another file.
   * 
   * @param other_ The other file to compare with.
   * @returns `true` if the files have the same contents, `false` otherwise.
   * @throws If any of the files can't be read due to permission issues or other filesystem errors.
   */
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
  /** Sync version of {@link sameAs}. */
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
      try { iter1.return?.(undefined) } catch { null }
      try { iter2.return?.(undefined) } catch { null }
    }
  }

  /**
   * Computes the hash of the file's contents.
   * 
   * @param algorithm_ The hash algorithm to use. Defaults to 'sha256'.
   * @param options_ Optional hash options.
   * @param encoding_ Optional encoding for the resulting hash. If not provided, a `Buffer` is returned.
   * @returns The computed hash as a `Buffer` or a string, depending on the encoding.
   * @throws If the file can't be read or the hash computation fails.
   */
  async hash(algorithm_?: string, options_?: cr.HashOptions): Promise<Buffer>
  async hash(algorithm_?: string, options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Promise<string>
  async hash(algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Promise<Buffer | string> {
    const hash = cr.createHash(algorithm_, options_)
    for await (const chunk of this.itBuff())
      hash.update(chunk)
    return encoding_ ? hash.digest(encoding_) : hash.digest()
  }
  /** Sync version of {@link hash}. */
  hashSync(algorithm_?: string, options_?: cr.HashOptions): Buffer
  hashSync(algorithm_?: string, options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): string
  hashSync(algorithm_ = "sha256", options_?: cr.HashOptions, encoding_?: Parameters<typeof cr.Hash.prototype.digest>[0]): Buffer | string {
    const hash = cr.createHash(algorithm_, options_)
    for (const chunk of this.itBuffSync())
      hash.update(chunk)
    return encoding_ ? hash.digest(encoding_) : hash.digest()
  }

  /** @returns The size of the file in bytes. */
  override async size(): Promise<number> { return (await this.lstat()).size }
  /** Sync version of {@link size}. */
  override sizeSync(): number { return this.lstatSync().size }

  /** Unlocked implementation of {@link writeAtomic}. */
  async writeAtomic$(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    this.assertWrite()
    await this.parent().borrow(File, t => t.duringLock(async s => {
      await s.write(data_, options_)
      await fp.rename(t.isAt, this.isAt) // using methods on t would update its location, thus deleting the original in the process
    }))
  }
  /**
   * Writes data to the file atomically by first writing to a temporary file (within the same directory) and then renaming it to the target file.
   * 
   * @param data_ The data to write.
   * @param options_ Optional write options.
   */
  async writeAtomic(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = await this.lock()
    await this.writeAtomic$(data_, options_)
  }
  /** Unlocked implementation of {@link writeAtomicSync}. */
  writeAtomicSync$(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    this.assertWrite()
    this.parent().borrowSync(File, t => t.duringLock(s => {
      s.writeSync(data_, options_)
      s.renameSync(this.base)
    }))
  }
  /** Sync version of {@link writeAtomic}. */
  writeAtomicSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    this.writeAtomicSync$(data_, options_)
  }

  /** Unlocked implementation of {@link write}. */
  protected async write$(data_: Buffer | string, options_?: fs.WriteFileOptions) { this.assertWrite(); await fp.writeFile(this.isAt, data_, options_) }
  /**
   * Writes data to the file.
   * 
   * @param data_ The data to write.
   * @param options_ Optional write options.
   */
  async write(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = await this.lock()
    await this.write$(data_, options_)
  }
  /** Sync version of {@link write$}. */
  protected writeSync$(data_: Buffer | string, options_?: fs.WriteFileOptions) { this.assertWrite(); fs.writeFileSync(this.isAt, data_, options_) }
  /** Sync version of {@link write}. */
  writeSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    this.writeSync$(data_, options_)
  }
  /** Unlocked implementation of {@link writePast}. */
  async writePast$(offset_: number, data_: Buffer | string) {
    this.assertWrite()
    const fd = await fp.open(this.isAt, 'r+')
    try {
      const buf = typeof data_ === 'string' ? Buffer.from(data_) : data_
      await fd.write(buf, 0, buf.length, offset_)
    } finally { await fd.close() }
  }
  /**
   * Writes data to the file at the specified offset.
   * 
   * @param offset_ The offset at which to start writing.
   * @param data_ The data to write.
   */
  async writePast(offset_: number, data_: Buffer | string) {
    using _ = await this.lock()
    await this.writePast$(offset_, data_)
  }
  /** Sync version of {@link writePast$}. */
  protected writePastSync$(offset_: number, data_: Buffer | string) {
    this.assertWrite()
    const fd = fs.openSync(this.isAt, 'r+')
    try {
      const buf = typeof data_ === 'string' ? Buffer.from(data_) : data_
      fs.writeSync(fd, buf, 0, buf.length, offset_)
    } finally { fs.closeSync(fd) }
  }
  /** Sync version of {@link writePast}. */
  writePastSync(offset_: number, data_: Buffer | string) {
    using _ = this.lockSync()
    this.writePastSync$(offset_, data_)
  }
  /** Unlocked implementation of {@link truncWritePast}. */
  protected async truncWritePast$(offset_: number, data_: Buffer | string) {
    this.assertWrite()
    const fd = await fp.open(this.isAt, 'r+')
    try {
      const buf = typeof data_ === 'string' ? Buffer.from(data_) : data_
      await fd.write(buf, 0, buf.length, offset_)
      await fd.truncate(offset_ + buf.length)
    } finally { await fd.close() }
  }
  /**
   * Writes data to the file at the specified offset and then truncates the file to the new length.
   * 
   * @param offset_ The offset at which to start writing.
   * @param data_ The data to write.
   */
  async truncWritePast(offset_: number, data_: Buffer | string) {
    using _ = await this.lock()
    await this.truncWritePast$(offset_, data_)
  }
  /** Unlocked implementation of {@link truncWritePastSync}. */
  protected truncWritePastSync$(offset_: number, data_: Buffer | string) {
    this.assertWrite()
    using _ = this.lockSync()
    const fd = fs.openSync(this.isAt, 'r+')
    try {
      const buf = typeof data_ === 'string' ? Buffer.from(data_) : data_
      fs.writeSync(fd, buf, 0, buf.length, offset_)
      fs.truncateSync(this.isAt, offset_ + buf.length)
    } finally { fs.closeSync(fd) }
  }

  /** Sync version of {@link truncWritePast}. */
  truncWritePastSync(offset_: number, data_: Buffer | string) {
    using _ = this.lockSync()
    this.truncWritePastSync$(offset_, data_)
  }
  /** Unlocked implementation of {@link append}. */
  async append$(data_: Buffer | string) {
    this.assertWrite()
    const fd = await fp.open(this.isAt, 'a')
    try {
      const buf = typeof data_ === 'string' ? Buffer.from(data_) : data_
      await fd.write(buf, 0, buf.length, null)
    } finally { await fd.close() }
  }
  async append(data_: Buffer | string,) {
    using _ = await this.lock()
    await this.append$(data_)
  }
  /** Unlocked implementation of {@link appendSync}. */
  appendSync$(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    this.assertWrite()
    fs.appendFileSync(this.isAt, data_, options_)
  }
  appendSync(data_: Buffer | string, options_?: fs.WriteFileOptions) {
    using _ = this.lockSync()
    this.appendSync$(data_, options_)
  }

  async check(throwOnError_: boolean): Promise<boolean> { try { return (await this.lstat()).isFile() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return this.lstatSync().isFile() } catch (e) { if (throwOnError_) throw e; return false } }

  override isFile(): this is File { return true as const }
}


export function file(...args: ConstructorParameters<typeof File>): File { return new File(...args) }



/** Helper type for filtering {@link Road} instances. */
export type filter_t<T extends Road> = ((found: Road) => found is T)


export class Folder extends RoadEdit {
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

  override async size(): Promise<number> {
    let total = 0
    for await (const entry of this.it(r=>r.isRoadEdit()))
      total += await entry.size()
    return total
  }
  override sizeSync(): number {
    let total = 0
    for (const entry of this.itSync(r=>r.isRoadEdit()))
      total += entry.sizeSync()
    return total
  }


  override duringLock<T>(cb_: (self: {
    delete: Folder['delete$'],
    deleteSync: Folder['deleteSync$'],
    move: Folder['move$'],
    moveSync: Folder['moveSync$'],
    rename: Folder['rename$'],
    renameSync: Folder['renameSync$']
  }) => T): T {
    return cb_({
      delete: bs.wFn(this.delete$),
      deleteSync: bs.wFn(this.deleteSync$),
      move: bs.wFn(this.move$),
      moveSync: bs.wFn(this.moveSync$),
      rename: bs.wFn(this.rename$),
      renameSync: bs.wFn(this.renameSync$),
    })
  }

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
  async find<T extends Road>(name_: string, filter_: filter_t<T>): Promise<T | null>
  async find<T extends Road>(name_: string, filter_?: filter_t<T>): Promise<Road | T | null> {
    try {
      const found = await road(this.join(name_))
      if (!filter_ || filter_(found))
        return found
      return null
    } catch { return null }
  }
  findSync(name_: string): Road | null
  findSync<T extends Road>(name_: string, filter_: filter_t<T>): T | null
  findSync<T extends Road>(name_: string, filter_?: filter_t<T>): Road | T | null {
    try {
      const found = roadSync(this.join(name_))
      if (!filter_ || filter_(found))
        return found
      return null
    } catch { return null }
  }

  async add<T extends Road>(name_: string, createable_: { mk: (at: string) => Promise<T> }): Promise<T> {
    this.assertWrite()
    const newPath = this.join(name_)
    await createable_.mk(newPath)
    return (await road(newPath)) as unknown as T
  }
  addSync<T extends Road>(name_: string, createable_: { mkSync: (at: string) => T }): T {
    this.assertWrite()
    const newPath = this.join(name_)
    createable_.mkSync(newPath)
    return roadSync(newPath) as unknown as T
  }

  async borrow<T extends Road>(createable_: { mk: (at: string) => Promise<T> }, cb_: (r: T) => Promise<void> | void): Promise<void> {
    this.assertWrite()
    const created = await createable_.mk(this.join(`instrumentality@${crypto.randomUUID()}`))
    try { await cb_(created) }
    finally { await fp.rm(created.isAt, { recursive: true, force: true }) }
  }
  borrowSync<T extends Road>(createable_: { mkSync: (at: string) => T }, cb_: (r: T) => void): void {
    this.assertWrite()
    const created = createable_.mkSync(this.join(`instrumentality@${crypto.randomUUID()}`))
    try { cb_(created) }
    finally { fs.rmSync(created.isAt, { recursive: true, force: true }) }
  }

  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isDirectory() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isDirectory() } catch (e) { if (throwOnError_) throw e; return false } }

  override isFolder(): this is Folder { return true as const }
  override isDir(): this is Folder { return true as const }
  override isDirectory(): this is Folder { return true as const }
}


export function folder(...args: ConstructorParameters<typeof Folder>): Folder { return new Folder(...args) }
export function dir(...args: ConstructorParameters<typeof Folder>): Folder { return new Folder(...args) }
export function directory(...args: ConstructorParameters<typeof Folder>): Folder { return new Folder(...args) }


export function sysRoot() { return new Folder(ph.parse(process.cwd()).root, false) }
export function home() { return new Folder(os.homedir(), false) }
export function tmp() { return new Folder(os.tmpdir(), false) }
export function here() { return new Folder(process.cwd(), false) }
export { Folder as Dir, Folder as Directory }



export class SymbolicLink extends RoadEdit {
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
  
  override duringLock<T>(cb_: (self: {
    delete: SymbolicLink['delete$'],
    deleteSync: SymbolicLink['deleteSync$'],
    retarget: SymbolicLink['retarget$'],
    retargetSync: SymbolicLink['retargetSync$'],
  }) => T): T {
    return cb_({
      delete: bs.wFn(this.delete$),
      deleteSync: bs.wFn(this.deleteSync$),
      retarget: bs.wFn(this.retarget$),
      retargetSync: bs.wFn(this.retargetSync$),
    })
  }

  async target() {
    return await road(ph.resolve(ph.dirname(this.isAt), await fp.readlink(this.isAt)))
  }
  targetSync() {
    return roadSync(ph.resolve(ph.dirname(this.isAt), fs.readlinkSync(this.isAt)))
  }
  async retarget$(to_: Road) {
    this.assertDelete()
    this.assertWrite()
    await fp.unlink(this.isAt)
    await fp.symlink(to_.isAt, this.isAt)
  }
  async retarget(to_: Road) {
    using _ = await this.lock()
    await this.retarget$(to_)
  }
  retargetSync$(to_: Road) {
    this.assertDelete()
    this.assertWrite()
    fs.unlinkSync(this.isAt)
    fs.symlinkSync(to_.isAt, this.isAt)
  }
  retargetSync(to_: Road) {
    this.assertDelete()
    this.assertWrite()
    using _ = this.lockSync()
    fs.unlinkSync(this.isAt)
    fs.symlinkSync(to_.isAt, this.isAt)
  }

  async size(): Promise<number> { return (await this.lstat()).size }
  sizeSync(): number { return this.lstatSync().size }

  override async delete() {
    this.assertDelete()
    using _ = await this.lock()
    await fp.unlink(this.isAt)
  }
  override deleteSync() {
    this.assertDelete()
    using _ = this.lockSync()
    fs.unlinkSync(this.isAt)
  }

  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isSymbolicLink() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isSymbolicLink() } catch (e) { if (throwOnError_) throw e; return false } }

  override isSymlink(): this is SymbolicLink { return true as const }
  override isSymbolicLink(): this is SymbolicLink { return true as const }
}


export { SymbolicLink as Symlink }


export function symlink(...args: ConstructorParameters<typeof SymbolicLink>): SymbolicLink { return new SymbolicLink(...args) }



/**
 * Represents a system-level resource that is not subject to modification.
 * All modification operations will throw an error.
 * 
 * One could say 'this road truly is *unusable*.' hehe
 */
export abstract class UnusableRoad extends Road {
  // Modification will cause system issues (e.g. deleting a device file)
  size(): Promise<0> { return Promise.resolve(0) }
  sizeSync(): 0 { return 0 }
  override isUnusable(): this is UnusableRoad { return true as const }
}
export class BlockDevice extends UnusableRoad {
  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isBlockDevice() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isBlockDevice() } catch (e) { if (throwOnError_) throw e; return false } }
  override isBlockDevice(): this is BlockDevice { return true as const }
}
export function blockDevice(...args: ConstructorParameters<typeof BlockDevice>): BlockDevice { return new BlockDevice(...args) }
export class CharacterDevice extends UnusableRoad {
  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isCharacterDevice() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isCharacterDevice() } catch (e) { if (throwOnError_) throw e; return false } }
  override isCharacterDevice(): this is CharacterDevice { return true as const }
}
export function characterDevice(...args: ConstructorParameters<typeof CharacterDevice>): CharacterDevice { return new CharacterDevice(...args) }
export class Fifo extends UnusableRoad {
  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isFIFO() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isFIFO() } catch (e) { if (throwOnError_) throw e; return false } }
  override isFifo(): this is Fifo { return true as const }
}
export function fifo(...args: ConstructorParameters<typeof Fifo>): Fifo { return new Fifo(...args) }
export class Socket extends UnusableRoad {
  async check(throwOnError_: boolean): Promise<boolean> { try { return (await fp.lstat(this.isAt)).isSocket() } catch (e) { if (throwOnError_) throw e; return false } }
  checkSync(throwOnError_: boolean): boolean { try { return fs.lstatSync(this.isAt).isSocket() } catch (e) { if (throwOnError_) throw e; return false } }
  override isSocket(): this is Socket { return true as const }
}
export function socket(...args: ConstructorParameters<typeof Socket>): Socket { return new Socket(...args) }