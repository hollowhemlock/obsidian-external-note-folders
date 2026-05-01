export function normalizeDisplayPath(input: string): string {
  return input.replace(/\\/gu, '/');
}

export function toExternalRelativeDisplayPath(externalRootPath: string, folderPath: string): string {
  const normalizedRootPath = normalizeDisplayPath(externalRootPath).replace(/\/+$/u, '');
  const normalizedFolderPath = normalizeDisplayPath(folderPath);

  if (normalizedFolderPath === normalizedRootPath) {
    return '.';
  }

  const rootPrefix = `${normalizedRootPath}/`;
  if (normalizedFolderPath.startsWith(rootPrefix)) {
    return normalizedFolderPath.slice(rootPrefix.length);
  }

  return normalizedFolderPath;
}
