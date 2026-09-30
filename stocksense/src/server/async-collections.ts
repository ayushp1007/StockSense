// Sequential callbacks preserve operation ordering inside SQL transactions.
export async function asyncMap<T, U>(items: readonly T[], fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (let i = 0; i < items.length; i++) result.push(await fn(items[i], i));
  return result;
}
export async function asyncForEach<T>(items: readonly T[], fn: (item: T, index: number) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i++) await fn(items[i], i);
}
export async function asyncEvery<T>(items: readonly T[], fn: (item: T, index: number) => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (!await fn(items[i], i)) return false;
  return true;
}
