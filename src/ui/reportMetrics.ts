import type {
  LeafReportModel,
  ScanMetrics
} from '../core/leafQuery.ts';
import type { TreeResult } from '../core/leafTree.ts';

export interface ReportMetric {
  key: string;
  label: string;
  value: number | undefined;
}

export function filterMetricEntries(result?: TreeResult): ReportMetric[] {
  const matches = result
    ? [...result.matched].flatMap((id) => {
      const node = result.nodes.get(id);
      return node ? [node] : [];
    })
    : undefined;
  return [
    { key: 'matchingFolders', label: 'Matching folders', value: matches?.filter((node) => node.kind === 'directory').length },
    { key: 'matchingLeaves', label: 'Matching physical leaves', value: matches?.filter((node) => node.evidence?.physicalLeaf === true).length },
    { key: 'matchingExpected', label: 'Matching expected paths', value: matches?.filter((node) => node.kind === 'virtual').length }
  ];
}

export function scanMetricEntries(model?: LeafReportModel): ReportMetric[] {
  const metrics: Partial<ScanMetrics> = model?.scanMetrics ?? (model?.tree
    ? {
      excludedBranches: model.tree.filter((node) => node.kind === 'excluded').length,
      physicalFolders: model.tree.filter((node) => node.kind === 'directory').length,
      ...(model.tree.every((node) => !!node.evidence) ? { physicalLeaves: model.tree.filter((node) => node.evidence?.physicalLeaf === true).length } : {})
    }
    : {});
  return [
    { key: 'physicalFolders', label: 'Physical folders', value: metrics.physicalFolders },
    { key: 'physicalLeaves', label: 'Known physical leaves', value: metrics.physicalLeaves },
    { key: 'excludedBranches', label: 'Excluded branches', value: metrics.excludedBranches },
    { key: 'unreadableDirectories', label: 'Unreadable directories', value: metrics.unreadableDirectories },
    { key: 'skippedLinks', label: 'Skipped links', value: metrics.skippedLinks },
    { key: 'skippedRepositories', label: 'Skipped repositories', value: metrics.skippedRepositories }
  ];
}
