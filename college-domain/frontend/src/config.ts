/**
 * Runtime configuration from Vite environment variables (see .env.example).
 * Nothing here is secret: values are compiled into the browser bundle.
 */
const trimmed = (value: string | undefined) => value?.trim().replace(/\/+$/, '') || undefined

export const config = {
  /** CampusGuide backend API base URL, e.g. https://api.example.edu/api. Unset = backend not connected. */
  apiBaseUrl: trimmed(import.meta.env.VITE_API_BASE_URL),
  /** Optional licensed campus photograph. Unset = built-in illustration. */
  campusImageUrl: trimmed(import.meta.env.VITE_CAMPUS_IMAGE_URL),
} as const
