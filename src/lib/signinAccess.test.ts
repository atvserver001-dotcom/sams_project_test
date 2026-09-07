import { describe, expect, it } from 'vitest'

import {
  MAX_SIGNIN_PASSWORD_LENGTH,
  MAX_SIGNIN_USERNAME_LENGTH,
  isOperatorUsernameAllowed,
  parseSigninCredentials,
} from './signinAccess'

describe('isOperatorUsernameAllowed', () => {
  it('preserves existing sign-in behavior when the allowlist is unset', () => {
    expect(isOperatorUsernameAllowed('any-operator', undefined)).toBe(true)
  })

  it('matches exact usernames after trimming CSV entries', () => {
    const configured = ' dev-admin, dev-school '

    expect(isOperatorUsernameAllowed('dev-admin', configured)).toBe(true)
    expect(isOperatorUsernameAllowed('dev-school', configured)).toBe(true)
    expect(isOperatorUsernameAllowed('Dev-Admin', configured)).toBe(false)
    expect(isOperatorUsernameAllowed(' dev-admin', configured)).toBe(false)
  })

  it('rejects every username when a configured allowlist is blank', () => {
    expect(isOperatorUsernameAllowed('dev-admin', '   ')).toBe(false)
  })
})

describe('parseSigninCredentials', () => {
  it('accepts string credentials within the length limits', () => {
    expect(parseSigninCredentials({ username: 'dev-admin', password: 'secret' })).toEqual({
      username: 'dev-admin',
      password: 'secret',
    })
  })

  it('rejects missing, non-string, and empty credentials', () => {
    expect(parseSigninCredentials(null)).toBeNull()
    expect(parseSigninCredentials([])).toBeNull()
    expect(parseSigninCredentials({ username: 'dev-admin' })).toBeNull()
    expect(parseSigninCredentials({ username: 1, password: 'secret' })).toBeNull()
    expect(parseSigninCredentials({ username: 'dev-admin', password: '' })).toBeNull()
  })

  it('rejects credentials above the length limits', () => {
    expect(
      parseSigninCredentials({ username: 'u'.repeat(MAX_SIGNIN_USERNAME_LENGTH + 1), password: 'secret' }),
    ).toBeNull()
    expect(
      parseSigninCredentials({ username: 'dev-admin', password: 'p'.repeat(MAX_SIGNIN_PASSWORD_LENGTH + 1) }),
    ).toBeNull()
  })
})
