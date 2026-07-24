import * as bs from "./base.ts"
/**
 * Subclass of {@link bs.InsErr} that represents an error thrown from this specific module of the library
 */
export class DomErr extends bs.InsErr { override name = "Instrumentality-DOM-Error" }



/**
 * Returns a Promise that resolves when the DOM is fully loaded and ready.
 *
 * @returns A Promise that resolves when the DOM is ready.
 */
export async function onceReady(): Promise<void> {
  if (document.readyState === "complete" || document.readyState === "interactive")
    return Promise.resolve()
  return new Promise(r => document.addEventListener("DOMContentLoaded", () => r(), { once: true }))
}



/**
 * Retrieves an HTML element by its ID and ensures it matches the specified type.
 *
 * @param id_ - The ID of the HTML element to retrieve.
 * @param elementType_ - An optional constructor function for the expected element type.
 * @returns The HTML element with the specified ID and type.
 * @throws Will throw an error if the element is not found or does not match the expected type.
 */
export function byId<T extends HTMLElement>(id_: string, elementType_?: new () => T): T {
  const element = document.getElementById(id_)
  const typeCtor = elementType_ ?? HTMLElement
  if (!(element instanceof typeCtor))
    throw new DomErr(`Type missmatch: Element with id '${id_}' is not of type ${typeCtor.name}`)
  return element as T
}


/**
 * Retrieves all HTML elements with the specified class name and ensures they match the specified type.
 *
 * @param className_ - The class name of the elements to retrieve.
 * @param elementType_ - An optional constructor function for the expected element type.
 * @returns An array of {@link HTMLElement} with the specified class name and type.
 * @throws Will throw an error if any element does not match the expected type.
 */
export function byClass<T extends HTMLElement>(className_: string, elementType_?: new () => T): T[] {
  return Array.from(document.getElementsByClassName(className_)).map((element, index) => {
    const typeCtor = elementType_ ?? HTMLElement
    if (!(element instanceof typeCtor))
      throw new DomErr(`Type missmatch: Element at index ${index} with class '${className_}' is not of type ${typeCtor.name}`)
    return element as T
  })
}


/**
 * Retrieves all HTML elements with the specified tag name.
 *
 * @param tagName_ - The tag name of the HTML elements to retrieve.
 */
export function byTag<K extends keyof HTMLElementTagNameMap>(tagName_: K): HTMLElementTagNameMap[K][] {
  return Array.from(document.getElementsByTagName(tagName_))
}



/**
 * Regular expression to match cookie name-value pairs in a cookie string.
 */
export const COOKIE_PAIR_REGEX = /(?:^|; )([^=;]+)=([^;]*)/g
/**
 * Default path for cookies, used when no specific path is provided.
 */
export const DEFAULT_PATH = '/' as const



/**
 * Sets a cookie with the specified name, data, and optional path.
 * 
 * @param name_ - The name of the cookie.
 * @param data_ - The data to be stored in the cookie, including its value and optional attributes.
 * @param path_ - An optional path for the cookie; defaults to {@link DEFAULT_PATH}.
 */
export function setCookie(name_: string, data_: {
  value: unknown
  expires?: Date | number
  domain?: string
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}, path_: string = DEFAULT_PATH): void {
  let cookieString = `${encodeURIComponent(name_)}=${encodeURIComponent(JSON.stringify(data_.value))}; Path=${path_}`
  if (data_.expires)
    if (data_.expires instanceof Date) cookieString += `; Expires=${data_.expires.toUTCString()}`
    else cookieString += `; Max-Age=${data_.expires}`
  if (data_.domain) cookieString += `; Domain=${data_.domain}`
  if (data_.secure) cookieString += `; Secure`
  if (data_.sameSite) cookieString += `; SameSite=${data_.sameSite}`
  document.cookie = cookieString
}

/**
 * Expires a cookie by setting its value to an empty string and its expiration date to the Unix epoch.
 *
 * @param name_ - The name of the cookie to expire.
 * @param path_ - An optional path for the cookie; defaults to {@link DEFAULT_PATH}.
 */
export function expireCookie(name_: string, path_: string = DEFAULT_PATH): void {
  setCookie(name_, { value: "", expires: new Date(0) }, path_)
}

/**
 * Lists all cookies as a record of name-value pairs.
 *
 * @returns A record where each key is a cookie name and each value is the corresponding cookie value.
 */
export function cookies(): Record<string, unknown> {
  const cookies: Record<string, unknown> = {}
  const matches = document.cookie.matchAll(COOKIE_PAIR_REGEX)
  for (const match of matches)
    cookies[decodeURIComponent(match[1] ?? "")] = JSON.parse(decodeURIComponent(match[2] ?? ""))
  return cookies
}