import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

interface Manifest {
  id: string;
}

interface SandboxPluginSettings {
  externalRootPath: string;
}

const CANDIDATE_ARTIFACT_PATHS = {
  mainJs: ['main.js', 'dist/build/main.js'],
  manifestJson: ['manifest.json', 'dist/build/manifest.json'],
  stylesCss: ['styles.css', 'dist/build/styles.css']
};

const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/vault';
const SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/sandbox/external-root';
const COMMUNITY_PLUGINS_RELATIVE_PATH = '.obsidian/community-plugins.json';

async function ensureCommunityPluginEnabled(vaultPath: string, pluginId: string): Promise<void> {
  const communityPluginsPath = path.join(vaultPath, COMMUNITY_PLUGINS_RELATIVE_PATH);
  const content = await readFile(communityPluginsPath, 'utf8');
  const parsed = JSON.parse(content) as string[];

  if (parsed.includes(pluginId)) {
    return;
  }

  parsed.push(pluginId);
  await writeFile(communityPluginsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

async function findArtifact(relativePaths: readonly string[]): Promise<string> {
  for (const relativePath of relativePaths) {
    const absolutePath = resolvePath(relativePath);
    try {
      await access(absolutePath);
      return absolutePath;
    } catch {
      // Try the next candidate
    }
  }

  throw new Error(`Artifact not found. Tried: ${relativePaths.join(', ')}`);
}

async function main(): Promise<void> {
  const manifestPath = await findArtifact(CANDIDATE_ARTIFACT_PATHS.manifestJson);
  const mainJsPath = await findArtifact(CANDIDATE_ARTIFACT_PATHS.mainJs);
  const stylesCssPath = await findArtifact(CANDIDATE_ARTIFACT_PATHS.stylesCss);

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown as Manifest;
  const sandboxVaultPath = resolvePath(SANDBOX_VAULT_RELATIVE_PATH);
  const sandboxExternalRootPath = resolvePath(SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH);

  const pluginPath = path.join(sandboxVaultPath, '.obsidian', 'plugins', manifest.id);
  await mkdir(pluginPath, { recursive: true });

  await copyFile(mainJsPath, path.join(pluginPath, 'main.js'));
  await copyFile(stylesCssPath, path.join(pluginPath, 'styles.css'));
  await copyFile(manifestPath, path.join(pluginPath, 'manifest.json'));

  await rm(path.join(pluginPath, 'journal'), { force: true, recursive: true });
  await ensureCommunityPluginEnabled(sandboxVaultPath, manifest.id);
  await writeSandboxPluginSettings(pluginPath, sandboxExternalRootPath);

  console.log(`Installed plugin '${manifest.id}' to sandbox: ${pluginPath}`);
  console.log(`Configured sandbox external root: ${sandboxExternalRootPath}`);
}

function resolvePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

async function writeSandboxPluginSettings(pluginPath: string, externalRootPath: string): Promise<void> {
  const settings: SandboxPluginSettings = {
    externalRootPath
  };
  await writeFile(path.join(pluginPath, 'data.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

// eslint-disable-next-line no-void -- script entry point
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
