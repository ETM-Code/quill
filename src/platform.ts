export type AppPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

function normalizePlatform(value: string | null | undefined): AppPlatform {
  if (!value) {
    return 'unknown'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'macos' || normalized === 'darwin' || normalized === 'mac') {
    return 'macos'
  }
  if (normalized === 'windows' || normalized.startsWith('win')) {
    return 'windows'
  }
  if (normalized === 'linux') {
    return 'linux'
  }

  return 'unknown'
}

function inferPlatformFromEnvironment(userAgent: string, navigatorPlatform: string): AppPlatform {
  const source = `${userAgent} ${navigatorPlatform}`.toLowerCase()
  if (source.includes('mac')) {
    return 'macos'
  }
  if (source.includes('win')) {
    return 'windows'
  }
  if (source.includes('linux') || source.includes('x11')) {
    return 'linux'
  }
  return 'unknown'
}

export function resolveAppPlatform(input: {
  href: string
  userAgent: string
  navigatorPlatform?: string
}): AppPlatform {
  let queryValue: string | null = null
  try {
    queryValue = new URL(input.href).searchParams.get('platform')
  } catch {
    queryValue = null
  }

  const fromQuery = normalizePlatform(queryValue)
  if (fromQuery !== 'unknown') {
    return fromQuery
  }

  return inferPlatformFromEnvironment(input.userAgent, input.navigatorPlatform ?? '')
}

export function getPlatformClassName(platform: AppPlatform): string {
  return `platform-${platform}`
}

