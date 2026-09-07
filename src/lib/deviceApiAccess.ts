export function isDeviceApiEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false'
}
