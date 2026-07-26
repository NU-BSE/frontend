/**
 * Push-to-pull bridge.
 *
 * Native inference bindings deliver tokens through a callback, but
 * `AsyncIterable` is a pull interface. This queue buffers pushed values so a
 * slow consumer never drops tokens, and resolves waiting consumers when the
 * producer is faster than the render loop.
 */
export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = [];
  private readonly rejecters: ((error: unknown) => void)[] = [];
  private done = false;
  private failure: unknown = null;

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      this.rejecters.shift();
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  /** No further values. Buffered values are still drained first. */
  close(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length) {
      this.rejecters.shift();
      this.waiters.shift()!({ value: undefined as never, done: true });
    }
  }

  /** Abandon the stream. Buffered values are discarded. */
  fail(error: unknown): void {
    if (this.done) return;
    this.done = true;
    this.failure = error;
    this.values.length = 0;
    while (this.rejecters.length) {
      this.waiters.shift();
      this.rejecters.shift()!(error);
    }
  }

  async *drain(): AsyncIterable<T> {
    while (true) {
      if (this.values.length) {
        yield this.values.shift()!;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.done) return;

      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiters.push(resolve);
        this.rejecters.push(reject);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
