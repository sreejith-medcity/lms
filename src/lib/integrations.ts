/**
 * Everything this product can be plugged into.
 *
 * Declared, like the reports and the settings, so one screen renders all of
 * them and adding the next is a few lines rather than a page. Each provider
 * names its own fields, says which of them are secret, and states honestly
 * whether anything in the codebase reads it yet.
 *
 * That last part is the rule the whole admin is built on. A connect button that
 * saves a key nothing reads is worse than no button, because somebody will
 * paste a live key, believe the reminders are going out, and find out on the
 * day a class moves. So every card says one of three things: it works, it will
 * work the moment you fill it in, or the code for it is not written yet.
 */

export type FieldKind = 'text' | 'secret' | 'url';

export interface IntegrationField {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  /** Read from the environment first, so an existing deployment keeps working. */
  env?: string;
}

/** `wired` means code reads it today; `planned` means the code lands later. */
export type IntegrationStatus = 'wired' | 'planned';

export interface IntegrationDef {
  id: string;
  name: string;
  category: CategoryKey;
  /** What it does for this academy, not what the company does. */
  purpose: string;
  status: IntegrationStatus;
  landsIn?: string;
  fields: IntegrationField[];
  docsUrl?: string;
  /** What happens while nothing is connected. */
  fallback?: string;
  /**
   * True where the running code still reads only the environment. The form
   * stores what you type, but the deployment keeps using hPanel's values until
   * that path is threaded through per tenant. Payments are not a thing to
   * refactor casually, so this is said out loud rather than glossed over.
   */
  envOnly?: boolean;
}

export const INTEGRATION_CATEGORIES = [
  { key: 'payments', label: 'Taking money', blurb: 'Gateways that collect fees.' },
  { key: 'email', label: 'Email', blurb: 'Receipts, reminders and campaigns.' },
  { key: 'sms', label: 'SMS and voice', blurb: 'The channel that reaches a learner without data.' },
  { key: 'whatsapp', label: 'WhatsApp', blurb: 'How Kerala actually reads its messages.' },
  { key: 'meeting', label: 'Live classes', blurb: 'Where a class actually happens.' },
  { key: 'storage', label: 'Files and video', blurb: 'Where recordings and material are kept.' },
  { key: 'auth', label: 'Signing in', blurb: 'Ways into an account other than a password.' },
  { key: 'analytics', label: 'Measurement', blurb: 'What visitors do before they enrol.' },
  { key: 'ai', label: 'AI', blurb: 'Transcription, feedback and the course companion.' },
  { key: 'automation', label: 'Automation and CRM', blurb: 'Getting data out to the rest of the business.' },
  { key: 'support', label: 'Support and accounts', blurb: 'Talking to people, and the books.' },
] as const;

export type CategoryKey = (typeof INTEGRATION_CATEGORIES)[number]['key'];

const KEY = (key: string, label: string, env?: string, hint?: string): IntegrationField => ({
  key,
  label,
  kind: 'secret',
  env,
  hint,
});

const TEXT = (key: string, label: string, env?: string, hint?: string): IntegrationField => ({
  key,
  label,
  kind: 'text',
  env,
  hint,
});

const URLF = (key: string, label: string, placeholder?: string): IntegrationField => ({
  key,
  label,
  kind: 'url',
  placeholder,
});

export const INTEGRATIONS: IntegrationDef[] = [
  /* Payments --------------------------------------------------------------- */
  {
    id: 'razorpay',
    name: 'Razorpay',
    category: 'payments',
    purpose:
      'Cards, UPI, netbanking and wallets, with the webhook that turns a payment into an enrolment.',
    status: 'wired',
    envOnly: true,
    docsUrl: 'https://dashboard.razorpay.com/app/website-app-settings/api-keys',
    fallback: 'Checkout refuses, and fees are recorded by hand at the counter.',
    fields: [
      TEXT('keyId', 'Key ID', 'RAZORPAY_KEY_ID', 'Starts rzp_test_ or rzp_live_.'),
      KEY('keySecret', 'Key secret', 'RAZORPAY_KEY_SECRET'),
      KEY('webhookSecret', 'Webhook secret', 'RAZORPAY_WEBHOOK_SECRET', 'From the webhook in their dashboard.'),
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    purpose: 'International cards, for learners paying from outside India.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('publishableKey', 'Publishable key'),
      KEY('secretKey', 'Secret key'),
      KEY('webhookSecret', 'Webhook signing secret'),
    ],
  },
  {
    id: 'cashfree',
    name: 'Cashfree',
    category: 'payments',
    purpose: 'An Indian gateway with lower UPI pricing than most, worth having as a second rail.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('appId', 'App ID'), KEY('secretKey', 'Secret key')],
  },
  {
    id: 'payu',
    name: 'PayU',
    category: 'payments',
    purpose: 'Another Indian gateway, common where a bank relationship already exists.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('merchantKey', 'Merchant key'), KEY('salt', 'Salt')],
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    category: 'payments',
    purpose: 'UPI-first checkout, which is what most walk-in learners reach for.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('merchantId', 'Merchant ID'), KEY('saltKey', 'Salt key'), TEXT('saltIndex', 'Salt index')],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payments',
    purpose: 'Still the default for some overseas learners, particularly in the Gulf.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },

  /* Email ------------------------------------------------------------------ */
  {
    id: 'smtp',
    name: 'SMTP',
    category: 'email',
    purpose: 'Any mail server. The plainest option, and the one that works with a mailbox you already have.',
    status: 'planned',
    landsIn: 'Phase 7',
    fallback: 'Nothing is emailed. Receipts, resets and reminders wait in the outbox.',
    fields: [
      TEXT('url', 'SMTP URL', 'SMTP_URL', 'smtps://user:password@host:465'),
      TEXT('fromEmail', 'From address', undefined, 'What learners see as the sender.'),
      TEXT('fromName', 'From name', undefined, 'Usually the academy name.'),
    ],
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'email',
    purpose: 'Transactional email with delivery you can actually see, which plain SMTP does not give you.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [KEY('apiKey', 'API key'), TEXT('fromEmail', 'From address')],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'email',
    purpose: 'High volume email, if campaigns grow past what a mailbox will carry.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [KEY('apiKey', 'API key'), TEXT('fromEmail', 'From address')],
  },
  {
    id: 'ses',
    name: 'Amazon SES',
    category: 'email',
    purpose: 'The cheapest email at volume, and the most work to set up.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('region', 'Region', undefined, 'ap-south-1 for Mumbai.'),
      TEXT('accessKeyId', 'Access key ID'),
      KEY('secretAccessKey', 'Secret access key'),
      TEXT('fromEmail', 'From address'),
    ],
  },

  /* SMS -------------------------------------------------------------------- */
  {
    id: 'msg91',
    name: 'MSG91',
    category: 'sms',
    purpose: 'Indian SMS with DLT templates handled, which matters more here than price.',
    status: 'planned',
    landsIn: 'Phase 7',
    fallback: 'No texts go out, so one-time codes and class reminders have no route.',
    fields: [
      KEY('authKey', 'Auth key', 'MSG91_AUTH_KEY'),
      TEXT('senderId', 'Sender ID', undefined, 'Six letters, registered on DLT.'),
      TEXT('dltTemplateId', 'Default DLT template ID', undefined, 'Per-message templates override it.'),
    ],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'sms',
    purpose: 'International SMS and voice, for learners already abroad.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('accountSid', 'Account SID'), KEY('authToken', 'Auth token'), TEXT('fromNumber', 'From number')],
  },
  {
    id: 'exotel',
    name: 'Exotel',
    category: 'sms',
    purpose: 'Calls and call tracking, for a front desk that follows up enquiries by phone.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('accountSid', 'Account SID'), KEY('apiToken', 'API token'), TEXT('callerId', 'Caller ID')],
  },

  /* WhatsApp --------------------------------------------------------------- */
  {
    id: 'aisensy',
    name: 'AiSensy',
    category: 'whatsapp',
    purpose: 'WhatsApp on approved templates, which is how most learners here actually read a reminder.',
    status: 'planned',
    landsIn: 'Phase 7',
    fallback: 'Reminders and fee notices go by hand from somebody’s phone.',
    fields: [KEY('apiKey', 'API key', 'AISENSY_API_KEY'), TEXT('campaignName', 'Default campaign name')],
  },
  {
    id: 'wati',
    name: 'WATI',
    category: 'whatsapp',
    purpose: 'WhatsApp with a shared team inbox, if the front desk answers as well as sends.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('endpoint', 'API endpoint'), KEY('accessToken', 'Access token')],
  },
  {
    id: 'gupshup',
    name: 'Gupshup',
    category: 'whatsapp',
    purpose: 'WhatsApp at volume, usually cheaper once you are past a few thousand messages.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [KEY('apiKey', 'API key'), TEXT('appName', 'App name'), TEXT('sourceNumber', 'Source number')],
  },
  {
    id: 'whatsapp_cloud',
    name: 'WhatsApp Cloud API',
    category: 'whatsapp',
    purpose: 'Meta directly, with no reseller in between. Cheapest per message, most setup.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('phoneNumberId', 'Phone number ID'),
      TEXT('wabaId', 'WhatsApp Business account ID'),
      KEY('accessToken', 'Permanent access token'),
      KEY('verifyToken', 'Webhook verify token'),
    ],
  },

  /* Live classes ----------------------------------------------------------- */
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'meeting',
    purpose:
      'Meetings created when a class is scheduled, the recording pulled afterwards, and attendance taken from join and leave events.',
    status: 'planned',
    landsIn: 'Phase 7',
    fallback: 'Join links are pasted in by hand and recordings uploaded manually.',
    docsUrl: 'https://marketplace.zoom.us/develop/create',
    fields: [
      TEXT('accountId', 'Account ID', 'ZOOM_ACCOUNT_ID'),
      TEXT('clientId', 'Client ID', 'ZOOM_CLIENT_ID'),
      KEY('clientSecret', 'Client secret', 'ZOOM_CLIENT_SECRET'),
      KEY('webhookSecret', 'Webhook secret token'),
    ],
  },
  {
    id: 'google_meet',
    name: 'Google Meet',
    category: 'meeting',
    purpose: 'Meetings made on a Workspace calendar, if the academy already lives in Workspace.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('clientId', 'OAuth client ID'), KEY('clientSecret', 'OAuth client secret')],
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'meeting',
    purpose: 'The same, for an academy on Microsoft 365.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('tenantId', 'Tenant ID'), TEXT('clientId', 'Application ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'jitsi',
    name: 'Jitsi',
    category: 'meeting',
    purpose: 'Self-hosted classes with no per-seat licence, at the cost of running a server.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('domain', 'Domain', undefined, 'meet.yourdomain.com'),
      KEY('appSecret', 'JWT app secret', undefined, 'Only if your deployment requires tokens.'),
    ],
  },
  {
    id: 'hundredms',
    name: '100ms',
    category: 'meeting',
    purpose: 'Classes inside your own app rather than a third-party window, which keeps attendance exact.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('accessKey', 'Access key'), KEY('appSecret', 'App secret'), TEXT('templateId', 'Template ID')],
  },

  /* Files and video -------------------------------------------------------- */
  {
    id: 's3',
    name: 'S3 or Cloudflare R2',
    category: 'storage',
    purpose:
      'Where every recording, PDF and image lives. Signed on the way out, so nothing sits on a guessable path.',
    status: 'wired',
    envOnly: true,
    fallback: 'Files go to the server’s own disk, which does not survive a redeploy on shared hosting.',
    fields: [
      TEXT('endpoint', 'Endpoint', 'S3_ENDPOINT', 'R2 gives you one per account.'),
      TEXT('bucket', 'Bucket', 'S3_BUCKET'),
      TEXT('region', 'Region', 'S3_REGION', 'auto for R2.'),
      TEXT('accessKeyId', 'Access key ID', 'S3_ACCESS_KEY_ID'),
      KEY('secretAccessKey', 'Secret access key', 'S3_SECRET_ACCESS_KEY'),
    ],
  },
  {
    id: 'bunny',
    name: 'Bunny Stream',
    category: 'storage',
    purpose: 'Video encoding and delivery, with a player that behaves on a weak connection.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('libraryId', 'Library ID'), KEY('apiKey', 'API key'), TEXT('cdnHostname', 'CDN hostname')],
  },
  {
    id: 'cloudflare_stream',
    name: 'Cloudflare Stream',
    category: 'storage',
    purpose: 'Video with signed playback and the encrypted delivery the DRM setting is waiting for.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('accountId', 'Account ID'), KEY('apiToken', 'API token')],
  },

  /* Signing in ------------------------------------------------------------- */
  {
    id: 'google_sso',
    name: 'Sign in with Google',
    category: 'auth',
    purpose: 'One tap instead of a password, which removes the largest support burden an institute has.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'microsoft_sso',
    name: 'Sign in with Microsoft',
    category: 'auth',
    purpose: 'For corporate training clients whose staff have work accounts.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('tenantId', 'Tenant ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'apple_sso',
    name: 'Sign in with Apple',
    category: 'auth',
    purpose: 'Required by Apple if the iOS app offers any other social sign-in.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [
      TEXT('teamId', 'Team ID'),
      TEXT('clientId', 'Services ID'),
      TEXT('keyId', 'Key ID'),
      KEY('privateKey', 'Private key, the .p8 contents'),
    ],
  },
  {
    id: 'recaptcha',
    name: 'Google reCAPTCHA',
    category: 'auth',
    purpose: 'Keeps scripted sign-ups off the enquiry form without asking real people to solve anything.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('siteKey', 'Site key'), KEY('secretKey', 'Secret key')],
  },

  /* Measurement ------------------------------------------------------------ */
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    purpose: 'What people looked at before they enrolled, and which page lost them.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('measurementId', 'Measurement ID', 'GA4_MEASUREMENT_ID', 'G-XXXXXXXXXX'),
      KEY('apiSecret', 'API secret', undefined, 'Only for server-side events.'),
    ],
  },
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    category: 'analytics',
    purpose: 'One container, so marketing adds tags without waiting for a deployment.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('containerId', 'Container ID', undefined, 'GTM-XXXXXXX')],
  },
  {
    id: 'meta_pixel',
    name: 'Meta Pixel',
    category: 'analytics',
    purpose: 'Attributing enrolments to the Facebook and Instagram ads that produced them.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      TEXT('pixelId', 'Pixel ID'),
      KEY('accessToken', 'Conversions API token', undefined, 'Optional, for server-side events.'),
    ],
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    category: 'analytics',
    purpose: 'Conversion tracking, so spend is judged against enrolments rather than clicks.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('conversionId', 'Conversion ID'), TEXT('conversionLabel', 'Conversion label')],
  },
  {
    id: 'clarity',
    name: 'Microsoft Clarity',
    category: 'analytics',
    purpose: 'Session recordings and heatmaps, free, and the fastest way to see why a page is not converting.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [TEXT('projectId', 'Project ID')],
  },

  /* AI --------------------------------------------------------------------- */
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    purpose: 'The course companion, written feedback and speaking assessment.',
    status: 'planned',
    landsIn: 'after go-live',
    fallback: 'None of the AI features are built yet either, so nothing is missing today.',
    fields: [KEY('apiKey', 'API key', 'ANTHROPIC_API_KEY')],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    purpose: 'An alternative for the same features, and for Whisper transcription.',
    status: 'planned',
    landsIn: 'after go-live',
    fields: [KEY('apiKey', 'API key')],
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    category: 'ai',
    purpose: 'Transcribing class recordings, which is what makes them searchable.',
    status: 'planned',
    landsIn: 'after go-live',
    fields: [KEY('apiKey', 'API key')],
  },

  /* Automation and CRM ----------------------------------------------------- */
  {
    id: 'webhooks',
    name: 'Outgoing webhooks',
    category: 'automation',
    purpose:
      'A POST to your own endpoint on enrolment, payment and completion. The escape hatch that makes every other integration optional.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [
      URLF('url', 'Endpoint URL', 'https://'),
      KEY('signingSecret', 'Signing secret', undefined, 'Each delivery is signed so you can verify it came from here.'),
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'automation',
    purpose: 'Connecting enrolments to the several hundred tools nobody will build an integration for.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [KEY('apiKey', 'API key')],
  },
  {
    id: 'zoho_crm',
    name: 'Zoho CRM',
    category: 'automation',
    purpose: 'Pushing enquiries into the CRM the sales team already works in.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [
      TEXT('clientId', 'Client ID'),
      KEY('clientSecret', 'Client secret'),
      KEY('refreshToken', 'Refresh token'),
      TEXT('dataCentre', 'Data centre', undefined, 'in, com or eu'),
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'automation',
    purpose: 'The same, for an academy running marketing out of HubSpot.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [KEY('accessToken', 'Private app access token')],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    category: 'automation',
    purpose: 'Mirroring enrolments into a sheet, because somebody in every institute wants it in a sheet.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('spreadsheetId', 'Spreadsheet ID'), KEY('serviceAccountJson', 'Service account JSON')],
  },

  /* Support and accounts --------------------------------------------------- */
  {
    id: 'slack',
    name: 'Slack',
    category: 'support',
    purpose: 'Alerting staff to a failed payment or a full batch where they already are.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [URLF('webhookUrl', 'Incoming webhook URL', 'https://hooks.slack.com/…')],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'support',
    purpose: 'The same alerts, for a team that lives on Telegram instead.',
    status: 'planned',
    landsIn: 'Phase 7',
    fields: [KEY('botToken', 'Bot token'), TEXT('chatId', 'Chat ID')],
  },
  {
    id: 'crisp',
    name: 'Crisp',
    category: 'support',
    purpose: 'Live chat on the storefront, answered from a phone.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('websiteId', 'Website ID')],
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'support',
    purpose: 'Turning learner problems into tickets somebody owns.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('domain', 'Domain', undefined, 'yourname.freshdesk.com'), KEY('apiKey', 'API key')],
  },
  {
    id: 'zoho_books',
    name: 'Zoho Books',
    category: 'support',
    purpose: 'Pushing invoices to the accountant instead of exporting a spreadsheet every month.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [
      TEXT('organizationId', 'Organisation ID'),
      KEY('clientSecret', 'Client secret'),
      KEY('refreshToken', 'Refresh token'),
    ],
  },
  {
    id: 'tally',
    name: 'Tally',
    category: 'support',
    purpose: 'The books most Kerala institutes actually keep, reached over its XML port.',
    status: 'planned',
    landsIn: 'after go-live',
    fields: [URLF('endpoint', 'Tally endpoint', 'http://localhost:9000')],
  },
  {
    id: 'fcm',
    name: 'Firebase Cloud Messaging',
    category: 'support',
    purpose: 'Push notifications to the phone app, once there is one.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('projectId', 'Project ID'), KEY('serviceAccountJson', 'Service account JSON')],
  },
];

export function integrationById(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function integrationsByCategory() {
  return INTEGRATION_CATEGORIES.map((category) => ({
    ...category,
    items: INTEGRATIONS.filter((i) => i.category === category.key),
  })).filter((c) => c.items.length > 0);
}

/** Fields an academy has to fill in before an integration can do anything. */
export function requiredFields(def: IntegrationDef): IntegrationField[] {
  return def.fields.filter((f) => !f.hint?.startsWith('Optional') && !f.hint?.startsWith('Only'));
}
