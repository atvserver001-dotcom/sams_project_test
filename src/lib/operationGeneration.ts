export class OperationGeneration {
  private generation = 0
  private disposed = false

  capture() {
    return this.generation
  }

  begin() {
    this.generation += 1
    return this.generation
  }

  invalidate() {
    this.generation += 1
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
  }

  isCurrent(generation: number) {
    return !this.disposed && generation === this.generation
  }

  isDisposed() {
    return this.disposed
  }
}
