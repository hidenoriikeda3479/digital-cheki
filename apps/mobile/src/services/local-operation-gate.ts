/** Serializes local mutations for one group across capture, editing and send confirmation. */
export class LocalOperationGate {
  private readonly queues = new Map<string, Promise<unknown>>();
  run<T>(groupId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(groupId) ?? Promise.resolve()).then(work);
    this.queues.set(groupId, next.catch(() => undefined));
    return next;
  }
}
