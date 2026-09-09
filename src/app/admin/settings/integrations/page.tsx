import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { storageDriver, localRoot } from '@/lib/storage';
import { razorpayConfig } from '@/lib/razorpay';
import { Badge, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Health = 'healthy' | 'partial' | 'unconfigured';

/**
 * What is actually connected, read from the running process rather than from a
 * table someone remembered to update. An integration nobody has configured says
 * so plainly and names the variables it wants, instead of being listed as a
 * feature that quietly does nothing.
 */
export default async function IntegrationsSettings() {
  await requireTenant();
  await requireStaff('settings.integrations', 'view');

  const razorpay = razorpayConfig();
  const driver = storageDriver();

  const rows: {
    name: string;
    purpose: string;
    health: Health;
    detail: string;
    vars?: string[];
  }[] = [
    {
      name: 'File storage',
      purpose: 'Course material, class recordings, everything learners download.',
      health: driver === 's3' ? 'healthy' : 'partial',
      detail:
        driver === 's3'
          ? 'An S3-compatible bucket. Uploads go straight from the browser to the bucket; the app server never touches the bytes.'
          : `Files are on this server's disk at ${localRoot()}, behind the CDN. Fine for a demo, wrong for hundreds of gigabytes of recordings.`,
      vars: driver === 's3' ? undefined : ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'],
    },
    {
      name: 'Razorpay',
      purpose: 'Course payments, refunds and the webhook that grants access.',
      health: razorpay ? (razorpay.webhookSecret ? 'healthy' : 'partial') : 'unconfigured',
      detail: razorpay
        ? razorpay.webhookSecret
          ? `Connected in ${razorpay.isTestMode ? 'test' : 'live'} mode, with a verified webhook.`
          : `Connected in ${razorpay.isTestMode ? 'test' : 'live'} mode, but no webhook secret. Access is granted only when the learner's browser reports back, so anyone who closes the tab mid-payment pays and gets nothing until someone notices.`
        : 'Not connected. Paid courses cannot be bought.',
      vars: razorpay
        ? razorpay.webhookSecret
          ? undefined
          : ['RAZORPAY_WEBHOOK_SECRET']
        : ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    },
    {
      name: 'Zoom',
      purpose: 'Creating meetings, pulling recordings, join and leave events.',
      health: process.env.ZOOM_CLIENT_ID ? 'healthy' : 'unconfigured',
      detail: process.env.ZOOM_CLIENT_ID
        ? 'Connected.'
        : 'Not connected. Join links are pasted in by hand when a class is scheduled, and recordings are uploaded manually.',
      vars: process.env.ZOOM_CLIENT_ID
        ? undefined
        : ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
    },
    {
      name: 'Email, SMS and WhatsApp',
      purpose: 'Enrolment confirmations, class reminders, fee notices.',
      health: process.env.SMTP_URL ? 'partial' : 'unconfigured',
      detail: process.env.SMTP_URL
        ? 'Email is connected. SMS and WhatsApp are not.'
        : 'Nothing is connected, so the platform sends nobody anything. Worth knowing before anyone relies on a reminder going out.',
      vars: ['SMTP_URL', 'MSG91_AUTH_KEY', 'AISENSY_API_KEY'],
    },
    {
      name: 'AI',
      purpose: 'Transcription, the course companion, writing and speaking feedback.',
      health: process.env.ANTHROPIC_API_KEY ? 'healthy' : 'unconfigured',
      detail: process.env.ANTHROPIC_API_KEY
        ? 'Connected.'
        : 'Not connected. These features are not built yet either, so nothing is missing today.',
      vars: process.env.ANTHROPIC_API_KEY ? undefined : ['ANTHROPIC_API_KEY'],
    },
  ];

  return (
    <div className="space-y-3">
      <p className="t-small muted max-w-prose">
        Read from the running server, not from a saved list. Values are set as environment
        variables on the host and picked up when the app restarts, which is deliberate: a
        credential that can be edited from a web page is a credential that can be stolen through
        one.
      </p>

      {rows.map((r) => (
        <Card key={r.name}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">{r.name}</p>
                <Badge
                  tone={r.health === 'healthy' ? 'ok' : r.health === 'partial' ? 'warn' : 'neutral'}
                >
                  {r.health === 'healthy'
                    ? 'connected'
                    : r.health === 'partial'
                      ? 'partly set up'
                      : 'not connected'}
                </Badge>
              </div>
              <p className="t-small faint mt-1">{r.purpose}</p>
              <p className="t-small muted mt-2 max-w-prose">{r.detail}</p>
            </div>
          </div>

          {r.vars && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.vars.map((v) => (
                <code
                  key={v}
                  className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-2 py-1 text-xs"
                >
                  {v}
                </code>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
