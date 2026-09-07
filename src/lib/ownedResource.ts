export interface OwnedResourceRef<T> {
  current: T | null
}

interface DisposableResource {
  dispose(): void | Promise<void>
}

export function disposeOwnedResource<T extends DisposableResource>(
  ref: OwnedResourceRef<T>,
  resource: T,
) {
  if (ref.current === resource) {
    ref.current = null
  }
  void resource.dispose()
}
