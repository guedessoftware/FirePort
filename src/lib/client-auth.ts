"use client"

export async function clearAuthCookies() {
  await fetch('/api/auth/logout-all', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  }).catch(() => null)
}

export async function hardSignOut() {
  await clearAuthCookies()
  window.location.replace('/')
}
