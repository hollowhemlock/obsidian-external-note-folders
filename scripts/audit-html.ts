// eslint-disable-next-line import-x/no-extraneous-dependencies -- Reuse the already installed build tooling without a dependency change.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

import type { LeafReportModel } from '../src/core/leafQuery.ts';

export async function buildAuditHtml(model: LeafReportModel): Promise<string> {
  const result = await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL('../src/ui/standaloneLeafReport.ts', import.meta.url))],
    format: 'iife',
    globalName: 'ExnfLeafReport',
    minify: true,
    platform: 'browser',
    plugins: [{
      name: 'browser-boundary',
      setup(builder): void {
        builder.onResolve(
          { filter: /^(node:|obsidian$|fs$|path$|crypto$|child_process$)/ },
          (args) => ({ errors: [{ text: `Forbidden browser dependency: ${args.path}` }] })
        );
      }
    }],
    write: false
  });
  const script = result.outputFiles[0]?.text;
  if (!script) {
    throw new Error('Browser bundle is empty.');
  }
  const data = JSON.stringify(model).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unmarked leaf folders</title><style>body{margin:0;background:#f6f8fb}</style></head><body><main id="report"></main><script type="application/json" id="report-data">${data}</script><script>${
    script.replaceAll('</script', '<\\/script')
  }\nExnfLeafReport.startStandaloneReport(JSON.parse(document.getElementById('report-data').textContent),document.getElementById('report')).catch(()=>{document.getElementById('report').textContent='Unable to display report.'});</script></body></html>`;
}
