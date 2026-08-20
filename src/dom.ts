import * as bs from "./base.ts"



/** Subclass of {@link bs.InsErr} that represents an error thrown from this specific module of the library */
export class DomErr extends bs.InsErr { override name = "Instrumentality-DOM-Error" }



/**
 * Resolves on `DOMContentLoaded` or immediately if the document is already ready.
 */
export async function onceReady(): Promise<void> {
  if (document.readyState === "complete" || document.readyState === "interactive")
    return
  return new Promise(r => document.addEventListener("DOMContentLoaded", () => r(), { once: true }))
}



/**
 * Typed accessor for {@link document.getElementById}
 *
 * @param id_ - The ID of the element to retrieve.
 * @param type_ - Expected type, defaults to {@link HTMLElement}.
 * @returns The corresponding element if found and of the expected type, otherwise `null`.
 */
export function byId<T extends HTMLElement>(id_: string, type_: new () => T): T | null {
  const element = document.getElementById(id_)
  if (element instanceof type_)
    return element
  return null
}


/**
 * Typed accessor for {@link document.getElementsByClassName}
 *
 * @param className_ - The class name of the elements to retrieve.
 * @param type_ - An optional constructor function for the expected element type.
 * @returns All elements with the specified class name and type.
 */
export function byClass<T extends HTMLElement>(className_: string, type_: new () => T): T[] {
  return [...document.getElementsByClassName(className_)].filter((el): el is T => el instanceof type_)
}


/**
 * Typed accessor for {@link document.getElementsByTagName}
 *
 * @param tag_ - The HTML tag name of the elements to retrieve.
 * @returns An array of {@link HTMLElement}s with the specified tag name.
 */
export function byTag<K extends keyof HTMLElementTagNameMap>(tag_: K): HTMLElementTagNameMap[K][] {
  return [...document.getElementsByTagName(tag_)]
}



/**
 * Sets a cookie with the specified name, data, and optional path.
 * 
 * @param name_ - The name of the cookie.
 * @param data_ - The data to be stored in the cookie.
 * @param path_ - An optional path for the cookie; defaults to {@link DEFAULT_PATH}.
 */
export function setCookie(name_: string, data_: {
  value: unknown
  expires?: Date | number
  domain?: string
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}, path_ = '/'): void {
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
 * Expires a cookie immediately.
 *
 * @param name_ - The name of the cookie.
 * @param path_ - An optional path for the cookie; defaults to {@link DEFAULT_PATH}.
 */
export function expireCookie(name_: string, path_ = '/'): void {
  setCookie(name_, { value: "", expires: new Date(0) }, path_)
}

/**
 * Lists all cookies as a record of key-value pairs.
 *
 * @returns A record where each key is a cookie name and each value is the corresponding cookie value.
 */
export function cookies(): Record<string, unknown> {
  const cookies: Record<string, unknown> = {}
  const matches = document.cookie.matchAll(/(?:^|; )([^=;]+)=([^;]*)/g)
  for (const match of matches)
    cookies[decodeURIComponent(match[1] ?? "")] = JSON.parse(decodeURIComponent(match[2] ?? ""))
  return cookies
}