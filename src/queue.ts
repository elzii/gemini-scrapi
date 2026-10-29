export interface QueueTask<T> {
  id: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  signal?: AbortSignal;
}

export class RequestQueue {
  private queue: QueueTask<any>[] = [];
  private activeCount = 0;
  private readonly concurrency: number = 1;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  public get pending(): number {
    return this.queue.length;
  }

  public get active(): number {
    return this.activeCount;
  }

  public enqueue<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        id: crypto.randomUUID(),
        run,
        resolve,
        reject,
        signal,
      };

      if (signal?.aborted) {
        return reject(new Error("Request aborted before queue processing"));
      }

      const onAbort = () => {
        const index = this.queue.indexOf(task);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error("Request aborted while waiting in queue"));
        }
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(task);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    if (task.signal?.aborted) {
      task.reject(new Error("Request aborted before execution"));
      this.processNext();
      return;
    }

    this.activeCount++;

    try {
      const result = await task.run();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }
}
