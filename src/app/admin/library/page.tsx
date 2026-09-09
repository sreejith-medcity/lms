import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatBytes, storageConfigured } from '@/lib/storage';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { AssetGrid, LibraryUploader, StorageSetup } from './panels';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const tenant = await requireTenant();
  await requireStaff('asset_library.manage_assets', 'view');

  const configured = storageConfigured();

  const [assets, totals] = await Promise.all([
    db.asset.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        id: true,
        name: true,
        fileName: true,
        type: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        transcodeStatus: true,
        _count: { select: { materials: true, recordings: true } },
      },
    }),
    db.asset.aggregate({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      _sum: { sizeBytes: true },
      _count: true,
    }),
  ]);

  const videoBytes = await db.asset.aggregate({
    where: { organizationId: tenant.organizationId, deletedAt: null, type: 'VIDEO' },
    _sum: { sizeBytes: true },
  });

  // BigInt does not survive the server-to-client boundary, so it is flattened here.
  const rows = assets.map((a) => ({
    id: a.id,
    name: a.name,
    fileName: a.fileName,
    type: a.type as string,
    mimeType: a.mimeType,
    sizeBytes: Number(a.sizeBytes),
    createdAt: a.createdAt.toISOString(),
    pending: a.transcodeStatus === 'UPLOADING',
    usedBy: a._count.materials + a._count.recordings,
  }));

  return (
    <div>
      <PageHeader
        title="Media library"
        description="Every file in one place, uploaded straight to storage and reused across courses. Nothing here is publicly reachable: players get a five-minute signed link, checked against the learner's enrolment."
      />

      {!configured ? (
        <StorageSetup />
      ) : (
        <div className="space-y-6">
          <StatGrid>
            <Stat label="Files" value={totals._count} />
            <Stat label="Stored" value={formatBytes(totals._sum.sizeBytes ?? 0n)} />
            <Stat label="Video" value={formatBytes(videoBytes._sum.sizeBytes ?? 0n)} sub="of the total" />
            <Stat label="Unused" value={rows.filter((r) => !r.usedBy && !r.pending).length} sub="not linked anywhere" />
          </StatGrid>

          <Card>
            <LibraryUploader />
          </Card>

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing uploaded yet"
              hint="Drop a class recording or a workbook above. Large files upload straight to the bucket, so the page stays responsive."
            />
          ) : (
            <AssetGrid assets={rows} />
          )}
        </div>
      )}
    </div>
  );
}
