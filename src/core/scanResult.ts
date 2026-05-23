export function registerUuidBinding(
  bindings: Map<string, string>,
  duplicatePaths: Map<string, string[]>,
  uuid: string,
  bindingPath: string,
  options: { ignoreExactDuplicate?: boolean } = {}
): void {
  const existingPath = bindings.get(uuid);
  if (!existingPath) {
    bindings.set(uuid, bindingPath);
    return;
  }

  if (options.ignoreExactDuplicate && existingPath === bindingPath) {
    return;
  }

  const duplicateSet = new Set<string>(duplicatePaths.get(uuid) ?? [existingPath]);
  duplicateSet.add(bindingPath);
  duplicatePaths.set(uuid, [...duplicateSet].sort());
}
