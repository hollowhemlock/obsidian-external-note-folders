import {
  describe,
  expect,
  it
} from 'vitest';

import { buildLeafReport } from '../src/core/leafReport.ts';
import { auditFixture } from '../test/support/auditFixture.ts';
import { buildAuditHtml } from './audit-html.ts';

describe('offline audit HTML', () => {
  it('bundles the browser boundary and safely embeds HTML-like paths', async () => {
    const model = buildLeafReport(auditFixture(1));

    model.vaultRoot = '</script><img src=x onerror=alert(1)>\u2028';

    const html = await buildAuditHtml(model);

    expect(html).not.toContain(model.vaultRoot);

    expect(html).toContain('\\u003c/script>');

    expect(html.match(/<script/gu)).toHaveLength(2);

    expect(html.match(/<\/script>/gu)).toHaveLength(2);

    expect(html).not.toMatch(/<script[^>]+src=/u);

    const data = /id="report-data">(?<json>.*?)<\/script>/su.exec(html)?.groups?.['json'];

    expect(JSON.parse(data ?? '{}')).toEqual(model);
  });
});
