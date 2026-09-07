export const MAX_SIGNIN_USERNAME_LENGTH = 128
export const MAX_SIGNIN_PASSWORD_LENGTH = 256

export type SigninCredentials = {
  username: string
  password: string
}

export function parseSigninCredentials(value: unknown): SigninCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const { username, password } = value as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string') return null
  if (username.length === 0 || password.length === 0) return null
  if (username.length > MAX_SIGNIN_USERNAME_LENGTH || password.length > MAX_SIGNIN_PASSWORD_LENGTH) return null

  return { username, password }
}

export function isOperatorUsernameAllowed(username: string, configuredUsernames: string | undefined): boolean {
  if (configuredUsernames === undefined) return true

  const allowlist = configuredUsernames
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)

  return allowlist.includes(username)
}
