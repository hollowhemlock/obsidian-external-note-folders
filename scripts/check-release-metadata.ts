import { checkMetadata } from './release-metadata.ts';

console.log(`Release metadata: ${checkMetadata(process.argv[2] ?? process.cwd()).version}`);
