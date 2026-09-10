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

/**
 * 1 is what Medcity asked for first and what a new institute is set up with.
 * Everything else is there so the catalogue is a map rather than a wishlist.
 */
export type Priority = 1 | 2 | 3;

/**
 * A field this sends out, and what it is called on the other side.
 *
 * Every CRM names things differently, and an institute that cannot say "our
 * lead source is your utm_source_c" has to ask us to redeploy. So the mapping
 * is data, entered per institute, not a constant in this file.
 */
export interface MappingDef {
  key: string;
  label: string;
  help?: string;
  /** What it is usually called there, offered as the starting value. */
  suggested?: string;
}

/** The five things a CRM has to be told, whichever CRM it is. */
export const LEAD_MAPPING: MappingDef[] = [
  { key: 'source', label: 'Lead source', help: 'Which ad, page or walk-in the enquiry came from.', suggested: 'Lead Source' },
  { key: 'owner', label: 'Owner', help: 'The counsellor it is assigned to.', suggested: 'Owner' },
  { key: 'stage', label: 'Stage', help: 'Where it has reached in the follow-up.', suggested: 'Lead Status' },
  { key: 'course', label: 'Course of interest', suggested: 'Course' },
  { key: 'enrolmentRef', label: 'Enrolment reference', help: 'Written back when the fee is paid, so the admission is tied to the original enquiry.', suggested: 'Enrolment ID' },
];

/** What a form has to hand over for the lead to be worth anything. */
export const FORM_MAPPING: MappingDef[] = [
  { key: 'name', label: 'Name field', suggested: 'name' },
  { key: 'phone', label: 'Phone field', suggested: 'phone' },
  { key: 'email', label: 'Email field', suggested: 'email' },
  { key: 'course', label: 'Course field', suggested: 'course' },
  { key: 'source', label: 'Source field', help: 'The hidden field carrying utm_source or the campaign name.', suggested: 'utm_source' },
];

export interface IntegrationDef {
  id: string;
  name: string;
  category: CategoryKey;
  /** What it does for this academy, not what the company does. */
  purpose: string;
  status: IntegrationStatus;
  landsIn?: string;
  priority: Priority;
  /** Alternatives in the same slot: pick one, not all of them. */
  alternativeTo?: string;
  /** The provider plan and permissions this actually needs, checked in advance. */
  requires?: string;
  /** What this institute has to tell us about the other side's field names. */
  mappings?: MappingDef[];
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
  { key: 'ads', group: 'Advertising, analytics and CRM', label: 'Advertising', blurb: 'Where enquiries come from, and what they cost.' },
  { key: 'crm', group: 'Advertising, analytics and CRM', label: 'CRM', blurb: 'Leads, owners and the enrolment they turned into.' },
  { key: 'analytics', group: 'Advertising, analytics and CRM', label: 'Measurement', blurb: 'What visitors do before they enrol, and where they stop.' },

  { key: 'whatsapp', group: 'Communication and support', label: 'WhatsApp and social', blurb: 'How Kerala actually reads its messages.' },
  { key: 'email', group: 'Communication and support', label: 'Email', blurb: 'Receipts and account mail, kept apart from campaigns.' },
  { key: 'sms', group: 'Communication and support', label: 'SMS and calling', blurb: 'The channel that reaches a learner without data.' },
  { key: 'support', group: 'Communication and support', label: 'Chat, helpdesk and alerts', blurb: 'Answering people, and telling staff.' },
  { key: 'forms', group: 'Communication and support', label: 'Forms and surveys', blurb: 'Where an enquiry is first typed.' },

  { key: 'payments', group: 'Sales, teaching and operations', label: 'Payments and billing', blurb: 'Course fees, and the institute’s own subscription. Not the same thing.' },
  { key: 'loyalty', group: 'Sales, teaching and operations', label: 'Loyalty and rewards', blurb: 'Points, stamps and passes, run by a platform of its own.' },
  { key: 'subscription', group: 'Sales, teaching and operations', label: 'Institute subscription billing', blurb: 'What the institute pays us. Kept apart from what students pay the institute, on purpose.' },
  { key: 'accounting', group: 'Sales, teaching and operations', label: 'Accounting', blurb: 'Getting invoices to whoever keeps the books.' },
  { key: 'meeting', group: 'Sales, teaching and operations', label: 'Live classes and calendars', blurb: 'Where a class happens, and who is expected at it.' },
  { key: 'storage', group: 'Sales, teaching and operations', label: 'Video and files', blurb: 'Where recordings and material are kept.' },
  { key: 'commerce', group: 'Sales, teaching and operations', label: 'Website and store', blurb: 'The properties that already sell these courses.' },
  { key: 'reporting', group: 'Sales, teaching and operations', label: 'Business reporting', blurb: 'Combining this with everything else the business runs on.' },
  { key: 'automation', group: 'Sales, teaching and operations', label: 'Automation and signing', blurb: 'Getting events out, and agreements signed.' },
  { key: 'auth', group: 'Sales, teaching and operations', label: 'Signing in', blurb: 'Ways into an account other than a password.' },
  { key: 'ai', group: 'Sales, teaching and operations', label: 'AI', blurb: 'Transcription, feedback and the course companion.' },
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
    priority: 1,
    requires:
      'A live Razorpay account with KYC cleared. API keys from the dashboard, and a webhook on payment.captured and order.paid pointing here. Route or Smart Collect only if you split fees across branches.',
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
    priority: 2,
    requires:
      'A Stripe account that can accept INR, which for an Indian entity means an Indian Stripe account. Restricted key limited to charges, customers and webhooks.',
    purpose: 'International cards, for learners paying from outside India.',
    status: 'planned',
    landsIn: 'Phase 8',
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
    priority: 2,
    requires:
      'A verified Cashfree merchant account. App ID and secret key from the merchant dashboard, production environment, and the webhook URL whitelisted.',
    purpose: 'An Indian gateway with lower UPI pricing than most, worth having as a second rail.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('appId', 'App ID'), KEY('secretKey', 'Secret key')],
  },
  {
    id: 'payu',
    name: 'PayU',
    category: 'payments',
    priority: 2,
    requires:
      'A PayU merchant account with the salt for the environment you are on. Test and production salts differ and are not interchangeable.',
    purpose: 'Another Indian gateway, common where a bank relationship already exists.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('merchantKey', 'Merchant key'), KEY('salt', 'Salt')],
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    category: 'payments',
    priority: 3,
    requires:
      'A PhonePe business merchant ID with the salt key and salt index. Onboarding is manual and takes a few days.',
    purpose: 'UPI-first checkout, which is what most walk-in learners reach for.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('merchantId', 'Merchant ID'), KEY('saltKey', 'Salt key'), TEXT('saltIndex', 'Salt index')],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payments',
    priority: 3,
    requires:
      'A PayPal business account. REST app credentials, live rather than sandbox. Cross border settlement rules apply to Indian accounts.',
    purpose: 'Still the default for some overseas learners, particularly in the Gulf.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },

  /* Email ------------------------------------------------------------------ */
  {
    id: 'smtp',
    name: 'SMTP',
    category: 'email',
    priority: 1,
    requires:
      'Any mailbox that allows SMTP. For Google Workspace that means an app password with 2FA on, since plain passwords are refused.',
    purpose: 'Any mail server. The plainest option, and the one that works with a mailbox you already have.',
    status: 'wired',
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
    priority: 2,
    requires:
      'A Resend account with the sending domain verified by DNS. The free tier covers a few thousand a month, which receipts alone will outgrow.',
    purpose: 'Transactional email with delivery you can actually see, which plain SMTP does not give you.',
    status: 'wired',
    fields: [KEY('apiKey', 'API key'), TEXT('fromEmail', 'From address')],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'email',
    priority: 3,
    requires:
      'A SendGrid account with domain authentication done and a key scoped to Mail Send only. Single sender verification is not enough at volume.',
    purpose: 'High volume email, if campaigns grow past what a mailbox will carry.',
    status: 'wired',
    fields: [KEY('apiKey', 'API key'), TEXT('fromEmail', 'From address')],
  },
  {
    id: 'ses',
    name: 'Amazon SES',
    category: 'email',
    priority: 2,
    requires:
      'An AWS account with SES moved out of the sandbox, which needs a support request. An IAM user with ses:SendEmail and nothing more.',
    purpose: 'The cheapest email at volume, and the most work to set up.',
    status: 'wired',
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
    priority: 1,
    requires:
      'An MSG91 account with the sender ID and DLT template registered with TRAI. Without DLT registration Indian carriers drop the message silently.',
    purpose: 'Indian SMS with DLT templates handled, which matters more here than price.',
    status: 'wired',
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
    priority: 2,
    requires:
      'A Twilio account with an Indian sender registered on DLT, or an international number if you accept the cost. Account SID and auth token.',
    purpose: 'International SMS and voice, for learners already abroad.',
    status: 'wired',
    fields: [TEXT('accountSid', 'Account SID'), KEY('authToken', 'Auth token'), TEXT('fromNumber', 'From number')],
  },
  {
    id: 'exotel',
    name: 'Exotel',
    category: 'sms',
    priority: 2,
    requires:
      'An Exotel account with a virtual number, and the API key and token from the settings. Call recording needs the plan that includes it.',
    purpose: 'Calls and call tracking, for a front desk that follows up enquiries by phone.',
    status: 'wired',
    fields: [TEXT('accountSid', 'Account SID'), KEY('apiToken', 'API token'), TEXT('callerId', 'Caller ID')],
  },

  /* WhatsApp --------------------------------------------------------------- */
  {
    id: 'aisensy',
    name: 'AiSensy',
    category: 'whatsapp',
    priority: 1,
    requires:
      'An approved WhatsApp Business account connected to AiSensy, message templates approved by Meta, and a project API key. Templates take a day or two to clear.',
    purpose: 'WhatsApp on approved templates, which is how most learners here actually read a reminder.',
    status: 'wired',
    fallback: 'Reminders and fee notices go by hand from somebody’s phone.',
    fields: [KEY('apiKey', 'API key', 'AISENSY_API_KEY'), TEXT('campaignName', 'Default campaign name')],
  },
  {
    id: 'wati',
    name: 'WATI',
    category: 'whatsapp',
    priority: 2,
    requires:
      'A WATI account with the WhatsApp Business number verified, approved templates, and the tenant specific API endpoint and token.',
    purpose: 'WhatsApp with a shared team inbox, if the front desk answers as well as sends.',
    status: 'wired',
    fields: [TEXT('endpoint', 'API endpoint'), KEY('accessToken', 'Access token')],
  },
  {
    id: 'gupshup',
    name: 'Gupshup',
    category: 'whatsapp',
    priority: 2,
    requires:
      'A Gupshup account with the WhatsApp app created and the number verified. API key from the dashboard, and templates approved before anything sends.',
    purpose: 'WhatsApp at volume, usually cheaper once you are past a few thousand messages.',
    status: 'wired',
    fields: [KEY('apiKey', 'API key'), TEXT('appName', 'App name'), TEXT('sourceNumber', 'Source number')],
  },
  {
    id: 'whatsapp_cloud',
    name: 'WhatsApp Cloud API',
    category: 'whatsapp',
    priority: 2,
    requires:
      'A Meta app with whatsapp_business_messaging and whatsapp_business_management, a verified business, and a phone number ID. A permanent system user token, not the temporary one the console offers.',
    purpose: 'Meta directly, with no reseller in between. Cheapest per message, most setup.',
    status: 'wired',
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
    priority: 1,
    requires:
      'A Zoom account on a paid plan for meetings over forty minutes. A server to server OAuth app with meeting:write, meeting:read and user:read, plus the webhook secret for attendance.',
    purpose:
      'Meetings created when a class is scheduled, the recording pulled afterwards, and attendance taken from join and leave events.',
    status: 'wired',
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
    priority: 2,
    requires:
      'Google Workspace. Meet links come from Calendar, so the Calendar API and OAuth on an account that can create events are what this actually needs.',
    purpose: 'Meetings made on a Workspace calendar, if the academy already lives in Workspace.',
    status: 'planned',
    landsIn: 'Later',
    fields: [TEXT('clientId', 'OAuth client ID'), KEY('clientSecret', 'OAuth client secret')],
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'meeting',
    priority: 3,
    requires:
      'Microsoft 365 with Teams. An Entra app with OnlineMeetings.ReadWrite.All and an application access policy granting it for the organiser.',
    purpose: 'The same, for an academy on Microsoft 365.',
    status: 'planned',
    landsIn: 'Later',
    fields: [TEXT('tenantId', 'Tenant ID'), TEXT('clientId', 'Application ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'jitsi',
    name: 'Jitsi',
    category: 'meeting',
    priority: 3,
    requires:
      'Nothing paid if you self host. For 8x8 hosted, an app ID and the JWT key pair from their console.',
    purpose: 'Self-hosted classes with no per-seat licence, at the cost of running a server.',
    status: 'planned',
    landsIn: 'Later',
    fields: [
      TEXT('domain', 'Domain', undefined, 'meet.yourdomain.com'),
      KEY('appSecret', 'JWT app secret', undefined, 'Only if your deployment requires tokens.'),
    ],
  },
  {
    id: 'hundredms',
    name: '100ms',
    category: 'meeting',
    priority: 3,
    requires:
      'A 100ms account, an app access key and secret, and a room template configured for the class size you run.',
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
    priority: 1,
    requires:
      'An S3 bucket with public access blocked, and an IAM user limited to GetObject, PutObject and DeleteObject on that bucket alone. Any S3 compatible provider works.',
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
    priority: 2,
    requires:
      'A Bunny.net account with a stream library, its library ID and API key, and a pull zone for delivery.',
    purpose: 'Video encoding and delivery, with a player that behaves on a weak connection.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('libraryId', 'Library ID'), KEY('apiKey', 'API key'), TEXT('cdnHostname', 'CDN hostname')],
  },
  {
    id: 'cloudflare_stream',
    name: 'Cloudflare Stream',
    category: 'storage',
    priority: 2,
    requires:
      'A Cloudflare account with Stream enabled, which is billed per minute stored and delivered. An API token scoped to Stream only.',
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
    priority: 1,
    requires:
      'A Google Cloud project with the OAuth consent screen published, and the callback URL of this deployment added as an authorized redirect.',
    purpose: 'One tap instead of a password, which removes the largest support burden an institute has.',
    status: 'wired',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'microsoft_sso',
    name: 'Sign in with Microsoft',
    category: 'auth',
    priority: 2,
    requires:
      'An Entra app registration with the redirect URL added, and User.Read delegated permission. Multi tenant if institutes sign in from their own directories.',
    purpose: 'For corporate training clients whose staff have work accounts.',
    status: 'wired',
    fields: [TEXT('tenantId', 'Tenant ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'apple_sso',
    name: 'Sign in with Apple',
    category: 'auth',
    priority: 3,
    requires:
      'A paid Apple Developer account, a Services ID, a key for Sign in with Apple, and the domain verified. The most fiddly of the three.',
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
    priority: 1,
    requires:
      'A reCAPTCHA site registered for this domain. v3 gives a score rather than a puzzle, which is what you want on an enquiry form.',
    purpose: 'Keeps scripted sign-ups off the enquiry form without asking real people to solve anything.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('siteKey', 'Site key'), KEY('secretKey', 'Secret key')],
  },

  /* Measurement ------------------------------------------------------------ */
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    priority: 1,
    requires:
      'A GA4 property with a web data stream. The measurement ID for the tag, and a Measurement Protocol API secret if server side events are sent.',
    purpose: 'What people looked at before they enrolled, and which page lost them. A paid enrolment is also reported from this server, keyed to the order number so it deduplicates against the browser tag.',
    status: 'wired',
    fields: [
      TEXT('measurementId', 'Measurement ID', 'GA4_MEASUREMENT_ID', 'G-XXXXXXXXXX'),
      KEY('apiSecret', 'API secret', undefined, 'Only for server-side events.'),
    ],
  },
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    category: 'analytics',
    priority: 1,
    requires:
      'A GTM container for this domain, with publish rights for whoever manages tags. Server side tagging is a separate paid container.',
    purpose: 'One container, so marketing adds tags without waiting for a deployment.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('containerId', 'Container ID', undefined, 'GTM-XXXXXXX')],
  },
  {
    id: 'meta_pixel',
    name: 'Meta Pixel',
    category: 'ads',
    priority: 1,
    requires:
      'A pixel in Events Manager owned by the same Business Manager as the ad account, and the domain verified so events survive iOS restrictions.',
    purpose: 'Attributing enrolments to the Facebook and Instagram ads that produced them.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [
      TEXT('pixelId', 'Pixel ID'),
      KEY('accessToken', 'Conversions API token', undefined, 'Optional, for server-side events.'),
    ],
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    category: 'ads',
    priority: 1,
    requires:
      'A Google Ads account, the conversion ID and label from the conversion action, and the tag firing on the site. Reporting and offline uploads need the API separately.',
    purpose: 'Conversion tracking, so spend is judged against enrolments rather than clicks.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('conversionId', 'Conversion ID'), TEXT('conversionLabel', 'Conversion label')],
  },
  {
    id: 'clarity',
    name: 'Microsoft Clarity',
    category: 'analytics',
    priority: 2,
    requires:
      'Nothing paid. A Clarity project and its ID.',
    purpose: 'Session recordings and heatmaps, free, and the fastest way to see why a page is not converting.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('projectId', 'Project ID')],
  },

  /* AI --------------------------------------------------------------------- */
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    priority: 2,
    requires:
      'An Anthropic API key on a workspace with a spend limit set. Usage is billed per token, so set the limit before this goes near learners.',
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
    priority: 2,
    requires:
      'An OpenAI API key on a project with a budget. Same warning about the spend limit.',
    purpose: 'An alternative for the same features, and for Whisper transcription.',
    status: 'planned',
    landsIn: 'after go-live',
    fields: [KEY('apiKey', 'API key')],
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    category: 'ai',
    priority: 3,
    requires:
      'A Deepgram API key with a balance on it. Malayalam accented English transcribes better here than on the general models.',
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
    priority: 2,
    requires:
      'Nothing from a provider. An endpoint that accepts POST, and a shared secret so the receiver can verify the signature.',
    purpose:
      'A POST to your own endpoint, signed and retried. The escape hatch that makes every other integration optional. A captured payment and a new enrolment are sent today; the rest of the event list is declared but nothing raises it yet.',
    status: 'wired',
    fields: [
      URLF('url', 'Endpoint URL', 'https://'),
      KEY('signingSecret', 'Signing secret', undefined, 'Each delivery is signed so you can verify it came from here.'),
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'automation',
    priority: 2,
    requires:
      'A Zapier account. Webhooks by Zapier is a paid feature, so the free tier will not carry this.',
    purpose: 'Connecting enrolments to the several hundred tools nobody will build an integration for.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [KEY('apiKey', 'API key')],
  },
  {
    id: 'zoho_crm',
    name: 'Zoho CRM',
    category: 'crm',
    priority: 2,
    mappings: LEAD_MAPPING,
    requires:
      'A Zoho CRM edition that includes API access, which excludes the free tier at this volume. An OAuth client with ZohoCRM.modules.ALL and the correct datacentre, .in for Indian accounts.',
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
    category: 'crm',
    priority: 2,
    mappings: LEAD_MAPPING,
    requires:
      'A HubSpot account and a private app token with crm.objects.contacts and crm.objects.deals read and write. Free tier is enough to start.',
    purpose: 'The same, for an academy running marketing out of HubSpot.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [KEY('accessToken', 'Private app access token')],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    category: 'reporting',
    priority: 2,
    requires:
      'A service account with the Sheets API on, and the sheet shared with that service account address as an editor.',
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
    priority: 2,
    requires:
      'A Slack workspace and an incoming webhook, or an app with chat:write scoped to the channel staff actually watch.',
    purpose: 'Alerting staff to a failed payment or a full batch where they already are.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [URLF('webhookUrl', 'Incoming webhook URL', 'https://hooks.slack.com/…')],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'support',
    priority: 3,
    requires:
      'A bot from BotFather and the chat ID of the group. Free, and the fastest of these to set up.',
    purpose: 'The same alerts, for a team that lives on Telegram instead.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [KEY('botToken', 'Bot token'), TEXT('chatId', 'Chat ID')],
  },
  {
    id: 'crisp',
    name: 'Crisp',
    category: 'support',
    priority: 2,
    requires:
      'A Crisp website ID. The free plan carries the widget; the API for conversation history needs a paid plan.',
    purpose: 'Live chat on the storefront, answered from a phone.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('websiteId', 'Website ID')],
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'support',
    priority: 2,
    requires:
      'A Freshdesk account and an API key from the agent profile. The agent needs permission on the ticket types you write to.',
    purpose: 'Turning learner problems into tickets somebody owns.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('domain', 'Domain', undefined, 'yourname.freshdesk.com'), KEY('apiKey', 'API key')],
  },
  {
    id: 'zoho_books',
    name: 'Zoho Books',
    category: 'accounting',
    priority: 2,
    requires:
      'Zoho Books on a plan with API access, an OAuth client with ZohoBooks.invoices.CREATE, and the organization ID.',
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
    category: 'accounting',
    priority: 3,
    requires:
      'Tally Prime running on a machine reachable from here, with the ODBC or XML port open. In practice this means a scheduled export rather than a live connection.',
    purpose: 'The books most Kerala institutes actually keep, reached over its XML port.',
    status: 'planned',
    landsIn: 'after go-live',
    fields: [URLF('endpoint', 'Tally endpoint', 'http://localhost:9000')],
  },
  {
    id: 'fcm',
    name: 'Firebase Cloud Messaging',
    category: 'support',
    priority: 3,
    requires:
      'A Firebase project and a service account with the Firebase Cloud Messaging API enabled. Only worth doing once there is a phone app.',
    purpose: 'Push notifications to the phone app, once there is one.',
    status: 'planned',
    landsIn: 'Phase 8',
    fields: [TEXT('projectId', 'Project ID'), KEY('serviceAccountJson', 'Service account JSON')],
  },

  /* Advertising ------------------------------------------------------------ */
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    category: 'ads',
    priority: 1,
    purpose:
      'Reads spend, reach and cost per lead for the Facebook and Instagram campaigns, and sends enrolments back so Meta optimises for people who actually pay.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'A Meta business account with the ad account and the page in the same Business Manager. System user token with ads_read for reporting, ads_management to write conversions, business_management to list the accounts.',
    docsUrl: 'https://developers.facebook.com/docs/marketing-apis',
    fallback: 'Cost per enrolment is worked out by hand from the Ads Manager export.',
    fields: [
      TEXT('adAccountId', 'Ad account ID', undefined, 'The act_ number, without the act_ prefix is fine too.'),
      TEXT('businessId', 'Business Manager ID'),
      KEY('accessToken', 'System user access token', undefined, 'Generate a long lived one, not a user token.'),
    ],
  },
  {
    id: 'meta_capi',
    name: 'Meta Conversions API',
    category: 'ads',
    priority: 1,
    purpose:
      'Sends a purchase event from this server the moment a fee is paid, so the campaign is credited even when the browser pixel is blocked. Keyed to the order number, so Meta counts one admission rather than two.',
    status: 'wired',
    alternativeTo: 'meta_pixel',
    requires:
      'The same pixel as the site, plus a Conversions API access token generated from Events Manager. Nothing else, but the pixel and this must use one dataset or the numbers double.',
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/conversions-api',
    fallback: 'Only the browser pixel reports, so iOS traffic under reports badly.',
    fields: [
      TEXT('pixelId', 'Pixel or dataset ID'),
      KEY('accessToken', 'Conversions API token'),
      TEXT('testEventCode', 'Test event code', undefined, 'Optional. Only while you are checking events arrive.'),
    ],
  },
  {
    id: 'google_ads_offline',
    name: 'Google Ads offline conversions',
    category: 'ads',
    priority: 1,
    purpose:
      'Uploads the enrolment against the click that caused it, so Smart Bidding learns from paid admissions rather than from form fills.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'A Google Ads manager account, a developer token approved for standard access, and OAuth on a user with edit rights on the ad account. The site must be passing gclid through to the enquiry form.',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/conversions/upload-clicks',
    fallback: 'Bidding optimises for enquiries, which rewards the cheap and unqualified ones.',
    fields: [
      TEXT('customerId', 'Customer ID', undefined, 'Ten digits, no dashes.'),
      TEXT('loginCustomerId', 'Manager account ID', undefined, 'Only if the account sits under an MCC.'),
      KEY('developerToken', 'Developer token'),
      KEY('refreshToken', 'OAuth refresh token'),
      TEXT('conversionActionId', 'Conversion action ID', undefined, 'The offline action you created in Google Ads.'),
    ],
  },
  {
    id: 'linkedin_ads',
    name: 'LinkedIn Ads',
    category: 'ads',
    priority: 3,
    purpose: 'Spend and lead reporting for the professional courses, where the audience is worth the CPM.',
    status: 'planned',
    landsIn: 'Later',
    requires: 'A Campaign Manager account and an app with r_ads_reporting, plus rw_conversions if leads are pushed back.',
    fields: [TEXT('accountId', 'Ad account ID'), KEY('accessToken', 'Access token')],
  },
  {
    id: 'microsoft_ads',
    name: 'Microsoft Ads and UET',
    category: 'ads',
    priority: 3,
    purpose: 'The Bing side of search, and the UET tag that measures it.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_ads',
    requires: 'A Microsoft Advertising account, a developer token, and OAuth on a user with account access.',
    fields: [
      TEXT('uetTagId', 'UET tag ID'),
      TEXT('customerId', 'Customer ID'),
      KEY('developerToken', 'Developer token'),
      KEY('refreshToken', 'OAuth refresh token'),
    ],
  },
  {
    id: 'search_console',
    name: 'Google Search Console',
    category: 'analytics',
    priority: 2,
    purpose: 'Which course pages people find in search, and which queries they found them with.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'Ownership of the property already verified, and OAuth on a user with at least restricted access to it.',
    fields: [TEXT('siteUrl', 'Property URL', undefined, 'Exactly as it appears in Search Console.'), KEY('refreshToken', 'OAuth refresh token')],
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    priority: 3,
    purpose: 'Recordings and heatmaps of where a course page loses people.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'clarity',
    requires: 'Any paid plan for recordings on a site this size. The free tier samples too thinly to be useful.',
    fields: [TEXT('siteId', 'Site ID')],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'analytics',
    priority: 3,
    purpose: 'Product analytics on the learner side: which lessons get finished, where a cohort stalls.',
    status: 'planned',
    landsIn: 'Later',
    requires: 'A project API key. Self hosted or cloud, the key is the same shape.',
    fields: [TEXT('projectApiKey', 'Project API key'), URLF('host', 'Host', 'https://eu.i.posthog.com')],
  },

  /* CRM -------------------------------------------------------------------- */
  {
    id: 'medcity_crm',
    name: 'Medcity CRM',
    category: 'crm',
    priority: 1,
    mappings: LEAD_MAPPING,
    purpose:
      'The CRM the counsellors already live in. An enquiry goes across with its source, an owner comes back, and when the fee is paid the enrolment is written against the original enquiry rather than a new record.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'A base URL, an API token with permission to create and update leads, and the field names on their side for source, owner, stage and the enrolment link. Ask them for a sandbox before anything writes.',
    fallback: 'Counsellors copy enquiries over by hand, and the enrolment never gets linked back to the ad that caused it.',
    fields: [
      URLF('baseUrl', 'API base URL', 'https://crm.example.com/api/v1'),
      KEY('apiToken', 'API token'),
      TEXT('leadEndpoint', 'Lead endpoint', undefined, 'Path appended to the base URL, for example /leads.'),
      TEXT('ownerField', 'Owner field name', undefined, 'Optional. Left blank, the mapping screen asks later.'),
    ],
  },
  {
    id: 'leadsquared',
    name: 'LeadSquared',
    category: 'crm',
    priority: 2,
    mappings: LEAD_MAPPING,
    purpose: 'Lead capture, call tasks and the follow up sequence counsellors work through.',
    status: 'planned',
    landsIn: 'Phase 8',
    alternativeTo: 'medcity_crm',
    requires: 'Access key and secret key from the LeadSquared admin, on a plan that allows API lead creation.',
    docsUrl: 'https://apidocs.leadsquared.com/',
    fields: [TEXT('accessKey', 'Access key'), KEY('secretKey', 'Secret key'), URLF('region', 'API host', 'https://api-in21.leadsquared.com')],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    priority: 3,
    mappings: LEAD_MAPPING,
    purpose: 'For an institute that already runs its admissions on Salesforce.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'medcity_crm',
    requires: 'A connected app with the api and refresh_token scopes, and a user whose profile can create Leads and Opportunities.',
    fields: [
      URLF('instanceUrl', 'Instance URL', 'https://yourorg.my.salesforce.com'),
      TEXT('clientId', 'Consumer key'),
      KEY('clientSecret', 'Consumer secret'),
      KEY('refreshToken', 'Refresh token'),
    ],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'crm',
    priority: 3,
    mappings: LEAD_MAPPING,
    purpose: 'A lighter pipeline for a smaller institute, with deals per enquiry.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'medcity_crm',
    requires: 'A personal API token from a user with access to the pipeline you want written to.',
    fields: [KEY('apiToken', 'API token'), TEXT('companyDomain', 'Company domain', undefined, 'The yourcompany part of the Pipedrive URL.')],
  },
  {
    id: 'freshsales',
    name: 'Freshsales',
    category: 'crm',
    priority: 3,
    mappings: LEAD_MAPPING,
    purpose: 'Freshworks CRM, useful where the helpdesk is already Freshdesk.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'medcity_crm',
    requires: 'An API key from a user with the Sales role, and the bundle that includes API access.',
    fields: [TEXT('domain', 'Domain', undefined, 'yourcompany.myfreshworks.com'), KEY('apiKey', 'API key')],
  },

  /* Social messaging ------------------------------------------------------- */
  {
    id: 'instagram_dm',
    name: 'Instagram Messaging',
    category: 'whatsapp',
    priority: 2,
    purpose: 'Turns a DM on the course reels into an enquiry with a name attached, instead of a notification somebody forgets.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'A professional Instagram account linked to a Facebook page, and an app with instagram_manage_messages and pages_messaging. The account has to have messaging from tools turned on.',
    fields: [TEXT('igAccountId', 'Instagram account ID'), KEY('pageAccessToken', 'Page access token'), KEY('verifyToken', 'Webhook verify token')],
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    category: 'whatsapp',
    priority: 2,
    purpose: 'The same for the page inbox, which is where the click to message ads land.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'A page access token with pages_messaging and pages_manage_metadata, on a page the ad account can use.',
    fields: [TEXT('pageId', 'Page ID'), KEY('pageAccessToken', 'Page access token'), KEY('verifyToken', 'Webhook verify token')],
  },
  {
    id: 'interakt',
    name: 'Interakt',
    category: 'whatsapp',
    priority: 3,
    purpose: 'A WhatsApp business inbox with templates, for an institute that prefers it to AiSensy.',
    status: 'wired',
    alternativeTo: 'aisensy',
    requires: 'An approved WhatsApp Business account and a secret key from the Interakt developer settings.',
    fields: [KEY('apiKey', 'API key')],
  },

  /* Campaign email --------------------------------------------------------- */
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'email',
    priority: 2,
    purpose: 'Campaign mail to enquiries and past students, kept away from receipts so a marketing complaint never blocks an invoice.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'An API key and the audience ID. A paid plan if the list is over the free ceiling, which it will be.',
    fields: [KEY('apiKey', 'API key', undefined, 'Ends with the datacentre, for example -us21.'), TEXT('audienceId', 'Audience ID')],
  },
  {
    id: 'brevo',
    name: 'Brevo',
    category: 'email',
    priority: 2,
    purpose: 'Campaigns plus transactional mail on one account, which suits an institute that does not want two vendors.',
    status: 'planned',
    landsIn: 'Phase 8',
    alternativeTo: 'mailchimp',
    requires: 'A v3 API key with campaigns and contacts enabled, and a verified sender domain.',
    fields: [KEY('apiKey', 'API key'), TEXT('listId', 'List ID')],
  },
  {
    id: 'zoho_campaigns',
    name: 'Zoho Campaigns',
    category: 'email',
    priority: 3,
    purpose: 'Where the rest of the business already runs on Zoho.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'mailchimp',
    requires: 'A Zoho OAuth client with ZohoCampaigns.contact.ALL, and the right datacentre. India accounts are .in, not .com.',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token'), TEXT('listKey', 'List key')],
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    category: 'email',
    priority: 3,
    purpose: 'Behavioural sequences, for a course line that sells over weeks rather than on the call.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'mailchimp',
    requires: 'The account API URL and key, from Settings then Developer.',
    fields: [URLF('apiUrl', 'API URL', 'https://youraccount.api-us1.com'), KEY('apiKey', 'API key')],
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'email',
    priority: 3,
    purpose: 'Receipts and password resets only, on a provider that refuses to carry campaigns and so keeps its reputation.',
    status: 'wired',
    alternativeTo: 'resend',
    requires: 'A server token and a verified sender signature or DKIM on the sending domain.',
    fields: [KEY('serverToken', 'Server token'), TEXT('fromEmail', 'From address')],
  },
  {
    id: 'knowlarity',
    name: 'Knowlarity',
    category: 'sms',
    priority: 3,
    purpose: 'Cloud telephony: the counsellor calls from a tracked number, and the recording sits on the enquiry.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'exotel',
    requires: 'An SR number, an authorization key and an x-api-key, on a plan that allows call recording retrieval.',
    fields: [TEXT('srNumber', 'SR number'), KEY('authKey', 'Authorization key'), KEY('apiKey', 'x-api-key')],
  },

  /* Chat and helpdesk ------------------------------------------------------ */
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'support',
    priority: 3,
    purpose: 'Chat on the course pages with the learner record attached to the conversation.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'crisp',
    requires: 'An access token from a private app, with read and write on conversations and contacts.',
    fields: [TEXT('appId', 'App ID'), KEY('accessToken', 'Access token')],
  },
  {
    id: 'tawk',
    name: 'tawk.to',
    category: 'support',
    priority: 3,
    purpose: 'Free live chat, which is the honest answer for a small institute starting out.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'crisp',
    requires: 'Nothing paid. The property ID and widget ID from the tawk dashboard.',
    fields: [TEXT('propertyId', 'Property ID'), TEXT('widgetId', 'Widget ID')],
  },
  {
    id: 'zoho_desk',
    name: 'Zoho Desk',
    category: 'support',
    priority: 3,
    purpose: 'Tickets for fee disputes and access problems, in the same suite as the books.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'freshdesk',
    requires: 'A Zoho OAuth client with Desk.tickets.ALL and the organization ID.',
    fields: [TEXT('orgId', 'Organization ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'support',
    priority: 3,
    purpose: 'For an institute already standardised on it.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'freshdesk',
    requires: 'An API token enabled in admin, plus the email of the agent it acts as.',
    fields: [TEXT('subdomain', 'Subdomain'), TEXT('agentEmail', 'Agent email'), KEY('apiToken', 'API token')],
  },
  {
    id: 'onesignal',
    name: 'OneSignal',
    category: 'support',
    priority: 2,
    purpose: 'Browser and app push for class reminders, which arrives even when WhatsApp is muted.',
    status: 'planned',
    landsIn: 'Phase 8',
    alternativeTo: 'fcm',
    requires: 'An app ID and a REST API key. The free tier covers web push at this volume.',
    fields: [TEXT('appId', 'App ID'), KEY('restApiKey', 'REST API key')],
  },

  /* Forms ------------------------------------------------------------------ */
  {
    id: 'ninja_forms',
    name: 'Ninja Forms',
    category: 'forms',
    priority: 1,
    mappings: FORM_MAPPING,
    purpose:
      'The enquiry forms already running on the WordPress site. A submission arrives here as a lead with its source and the page it came from, rather than as an email in an inbox.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'The Ninja Forms webhook add on, or the small bridge plugin, on the WordPress site. A shared secret so a stranger cannot post fake leads.',
    fallback: 'Enquiries stay in WordPress and are re keyed by hand, losing the source every time.',
    fields: [URLF('siteUrl', 'WordPress site URL', 'https://medcityacademy.com'), KEY('sharedSecret', 'Shared secret'), TEXT('formIds', 'Form IDs', undefined, 'Comma separated. Blank means every form.')],
  },
  {
    id: 'google_forms',
    name: 'Google Forms',
    category: 'forms',
    priority: 2,
    mappings: FORM_MAPPING,
    purpose: 'Counsellor run intake and feedback forms, pulled in without anyone downloading a sheet.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'OAuth on a Google account with access to the form, and the Forms API turned on in that project.',
    fields: [TEXT('formId', 'Form ID'), KEY('refreshToken', 'OAuth refresh token')],
  },
  {
    id: 'typeform',
    name: 'Typeform',
    category: 'forms',
    priority: 3,
    mappings: FORM_MAPPING,
    purpose: 'Longer application forms where the completion rate is worth paying for.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_forms',
    requires: 'A personal access token with responses:read, and a webhook on the form.',
    fields: [TEXT('formId', 'Form ID'), KEY('accessToken', 'Access token')],
  },
  {
    id: 'zoho_forms',
    name: 'Zoho Forms',
    category: 'forms',
    priority: 3,
    mappings: FORM_MAPPING,
    purpose: 'The Zoho suite answer, where the CRM is Zoho too.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_forms',
    requires: 'A Zoho OAuth client with ZohoForms.form.READ, on the correct datacentre.',
    fields: [TEXT('formLinkName', 'Form link name'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },

  /* Loyalty ---------------------------------------------------------------- */
  {
    id: 'reward_loyalty',
    name: 'Reward Loyalty',
    category: 'loyalty',
    priority: 2,
    purpose:
      'Points, stamp cards, vouchers and prepaid passes, run as a platform of its own rather than as a corner of this one. This product reports what a learner did; the scheme decides what it is worth.',
    status: 'planned',
    landsIn: 'Phase 9',
    requires:
      'A Reward Loyalty install with API access, its base URL and an API key, and the program identifier. Confirm the endpoint names against your own version before connecting: the payloads below are what this product sends, not what any particular release expects to receive.',
    fallback:
      'The points and referral wallet built into this product keep running, which is the default and is fine until the scheme needs stamps, vouchers or passes.',
    fields: [
      URLF('baseUrl', 'API base URL', 'https://rewards.example.com/api'),
      KEY('apiKey', 'API key'),
      TEXT('programId', 'Program ID', undefined, 'Optional where the install runs one program.'),
    ],
    mappings: [
      { key: 'memberEmail', label: 'Member email field', help: 'What the scheme calls the address it matches a member on.', suggested: 'email' },
      { key: 'memberPhone', label: 'Member phone field', suggested: 'mobile' },
      { key: 'externalId', label: 'External member id field', help: 'Where it stores this product\'s user id, so a member survives an email change.', suggested: 'external_id' },
      { key: 'earnEvent', label: 'Earn event name', help: 'What it calls the event that awards on a purchase.', suggested: 'purchase' },
    ],
  },

  /* Institute subscription billing ----------------------------------------- */
  {
    id: 'chargebee',
    name: 'Chargebee',
    category: 'subscription',
    priority: 2,
    purpose:
      'Bills the institute for its own subscription to this platform. Deliberately separate from Razorpay, which takes student fees. One is our revenue, the other is theirs, and they must never share a ledger.',
    status: 'planned',
    landsIn: 'Phase 10',
    requires: 'A Chargebee site, a full access API key, and the plans created before anything is charged.',
    fallback: 'Institute subscriptions are invoiced by hand outside the product.',
    fields: [TEXT('site', 'Site name', undefined, 'The yoursite part of yoursite.chargebee.com.'), KEY('apiKey', 'API key')],
  },
  {
    id: 'stripe_billing',
    name: 'Stripe Billing',
    category: 'subscription',
    priority: 2,
    purpose: 'The same job as Chargebee, for institutes billed outside India.',
    status: 'planned',
    landsIn: 'Phase 10',
    alternativeTo: 'chargebee',
    requires: 'A Stripe account with Billing enabled, a restricted key limited to customers, subscriptions and invoices, and the webhook signing secret.',
    fields: [KEY('secretKey', 'Secret key'), KEY('webhookSecret', 'Webhook signing secret'), TEXT('priceIds', 'Price IDs', undefined, 'Comma separated, one per plan.')],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'accounting',
    priority: 3,
    purpose: 'Pushes fee invoices to the books without anyone typing them twice.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'zoho_books',
    requires: 'An Intuit app with com.intuit.quickbooks.accounting, OAuth on the company file, and the realm ID.',
    fields: [TEXT('realmId', 'Realm ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },
  {
    id: 'xero',
    name: 'Xero',
    category: 'accounting',
    priority: 3,
    purpose: 'The same, for an accountant who works in Xero.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'zoho_books',
    requires: 'A Xero app with accounting.transactions and accounting.contacts, connected to the right tenant.',
    fields: [TEXT('tenantId', 'Tenant ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },

  /* Website and store ------------------------------------------------------ */
  {
    id: 'woocommerce',
    name: 'WordPress and WooCommerce',
    category: 'commerce',
    priority: 1,
    purpose:
      'The store this replaces. While both are running, an order there becomes an enrolment here, and a course published here appears there. When the migration is finished this is how the archive is read.',
    status: 'wired',
    requires:
      'WooCommerce REST keys with read and write, generated under WooCommerce then Settings then Advanced. Permalinks must not be set to plain, or the REST route disappears.',
    fallback: 'Orders taken on the old store have to be entered here by hand during the changeover.',
    fields: [
      URLF('siteUrl', 'Store URL', 'https://medcityacademy.com'),
      TEXT('consumerKey', 'Consumer key'),
      KEY('consumerSecret', 'Consumer secret'),
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    priority: 3,
    purpose: 'For an institute whose storefront is Shopify rather than WordPress.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'woocommerce',
    requires: 'A custom app on the store with read_orders and read_products, and its admin API access token.',
    fields: [TEXT('shopDomain', 'Shop domain', undefined, 'yourstore.myshopify.com'), KEY('accessToken', 'Admin API access token')],
  },

  /* Calendars and booking -------------------------------------------------- */
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'meeting',
    priority: 2,
    purpose: 'Puts the batch timetable on the trainer calendar, so a class collision is visible before it happens.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires:
      'A Google Cloud project with the Calendar API on. For a Workspace domain, a service account with domain wide delegation writes to staff calendars without each of them signing in.',
    fields: [TEXT('calendarId', 'Calendar ID', undefined, 'Blank uses the primary calendar of the connected account.'), KEY('serviceAccountJson', 'Service account JSON')],
  },
  {
    id: 'outlook_calendar',
    name: 'Outlook Calendar',
    category: 'meeting',
    priority: 3,
    purpose: 'The same for a Microsoft 365 institute.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_calendar',
    requires: 'An Entra app with Calendars.ReadWrite application permission and admin consent granted.',
    fields: [TEXT('tenantId', 'Directory tenant ID'), TEXT('clientId', 'Application ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'meeting',
    priority: 3,
    purpose: 'Counselling slots booked by the enquirer rather than arranged over a phone call.',
    status: 'planned',
    landsIn: 'Later',
    requires: 'A personal access token, and a paid plan if you want the webhook that tells us a slot was booked.',
    fields: [KEY('accessToken', 'Personal access token'), URLF('schedulingUrl', 'Scheduling link', 'https://calendly.com/medcity/counselling')],
  },
  {
    id: 'zoho_bookings',
    name: 'Zoho Bookings',
    category: 'meeting',
    priority: 3,
    purpose: 'The same, inside Zoho.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'calendly',
    requires: 'A Zoho OAuth client with ZohoBookings.data.CREATE on the correct datacentre.',
    fields: [TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },

  /* Video and files -------------------------------------------------------- */
  {
    id: 'vdocipher',
    name: 'VdoCipher',
    category: 'storage',
    priority: 2,
    purpose:
      'DRM on the recorded lessons. The one integration bought for a reason other than convenience: a recorded IELTS course is the whole asset, and a screen recording of it is a competitor.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'A paid VdoCipher account and its API secret. Widevine and FairPlay come with the plan, no separate licence to arrange.',
    fallback: 'Recordings are served as signed links, which stop casual sharing and nothing more.',
    fields: [KEY('apiSecret', 'API secret')],
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    category: 'storage',
    priority: 3,
    purpose: 'Hosting for promotional video and open lessons, where protection matters less than the player.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'bunny',
    requires: 'A Vimeo account on a plan that allows API uploads, and a token with upload and video_files scopes.',
    fields: [KEY('accessToken', 'Access token')],
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    category: 'storage',
    priority: 2,
    purpose: 'Course material that trainers already keep in Drive, attached to a lesson without being copied.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'A service account with the Drive API on, and the folder shared with that service account address.',
    fields: [TEXT('folderId', 'Folder ID'), KEY('serviceAccountJson', 'Service account JSON')],
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    category: 'storage',
    priority: 3,
    purpose: 'The same for a Microsoft 365 institute.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_drive',
    requires: 'An Entra app with Files.Read.All application permission and admin consent.',
    fields: [TEXT('tenantId', 'Directory tenant ID'), TEXT('clientId', 'Application ID'), KEY('clientSecret', 'Client secret')],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    priority: 3,
    purpose: 'Where a department has years of material sitting in one shared folder.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'google_drive',
    requires: 'A scoped app with files.content.read, and a refresh token rather than the short lived one the console shows first.',
    fields: [TEXT('appKey', 'App key'), KEY('appSecret', 'App secret'), KEY('refreshToken', 'Refresh token')],
  },

  /* Business reporting ----------------------------------------------------- */
  {
    id: 'looker_studio',
    name: 'Looker Studio',
    category: 'reporting',
    priority: 2,
    purpose: 'A read only feed of the reports, so the management dashboard sits beside spend and the rest of the business.',
    status: 'planned',
    landsIn: 'Phase 8',
    requires: 'Nothing on their side. We issue a signed URL, and it is revoked from here the moment someone leaves.',
    fields: [TEXT('allowedEmails', 'Allowed viewers', undefined, 'Comma separated. Blank means the link works for anyone who has it.')],
  },
  {
    id: 'power_bi',
    name: 'Power BI',
    category: 'reporting',
    priority: 3,
    purpose: 'The same feed for a Microsoft shop.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'looker_studio',
    requires: 'Power BI Pro on whoever builds the report. The feed itself is the same signed URL.',
    fields: [TEXT('allowedEmails', 'Allowed viewers')],
  },
  {
    id: 'zoho_analytics',
    name: 'Zoho Analytics',
    category: 'reporting',
    priority: 3,
    purpose: 'And for a Zoho shop.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'looker_studio',
    requires: 'A Zoho OAuth client with ZohoAnalytics.data.all, and a workspace to import into.',
    fields: [TEXT('workspaceId', 'Workspace ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },

  /* Automation and signing ------------------------------------------------- */
  {
    id: 'make',
    name: 'Make',
    category: 'automation',
    priority: 2,
    purpose: 'Wires this to anything not on the list, without waiting for us to build a connector.',
    status: 'planned',
    landsIn: 'Phase 8',
    alternativeTo: 'zapier',
    requires: 'A Make account and a webhook scenario. The free tier is enough to start.',
    fields: [URLF('webhookUrl', 'Webhook URL', 'https://hook.eu2.make.com/...')],
  },
  {
    id: 'zoho_flow',
    name: 'Zoho Flow',
    category: 'automation',
    priority: 3,
    purpose: 'The same inside Zoho, where the CRM and books already live.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'zapier',
    requires: 'A Zoho Flow plan that allows custom webhooks.',
    fields: [URLF('webhookUrl', 'Webhook URL')],
  },
  {
    id: 'zoho_sign',
    name: 'Zoho Sign',
    category: 'automation',
    priority: 3,
    purpose: 'Enrolment agreements and refund undertakings signed without a printer.',
    status: 'planned',
    landsIn: 'Later',
    requires: 'A Zoho OAuth client with ZohoSign.documents.ALL, and the templates created first.',
    fields: [TEXT('templateId', 'Template ID'), TEXT('clientId', 'Client ID'), KEY('clientSecret', 'Client secret'), KEY('refreshToken', 'Refresh token')],
  },
  {
    id: 'docusign',
    name: 'DocuSign',
    category: 'automation',
    priority: 3,
    purpose: 'The same where a partner university insists on it.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'zoho_sign',
    requires: 'A JWT app with signature and impersonation, consent granted once by the sending user, and the account and user GUIDs.',
    fields: [TEXT('accountId', 'Account ID'), TEXT('integrationKey', 'Integration key'), TEXT('userId', 'Impersonated user ID'), KEY('privateKey', 'RSA private key')],
  },
  {
    id: 'adobe_sign',
    name: 'Adobe Acrobat Sign',
    category: 'automation',
    priority: 3,
    purpose: 'And where the institute is already on Adobe.',
    status: 'planned',
    landsIn: 'Later',
    alternativeTo: 'zoho_sign',
    requires: 'An Acrobat Sign account on a plan with API access, and an integration key with agreement_write.',
    fields: [KEY('integrationKey', 'Integration key'), URLF('shard', 'API host', 'https://api.in1.adobesign.com')],
  },
];

export function integrationById(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export const INTEGRATION_GROUPS = [
  'Advertising, analytics and CRM',
  'Communication and support',
  'Sales, teaching and operations',
] as const;

export function integrationsByCategory() {
  return INTEGRATION_CATEGORIES.map((category) => ({
    ...category,
    items: INTEGRATIONS.filter((i) => i.category === category.key).sort(
      (a, b) => a.priority - b.priority,
    ),
  })).filter((c) => c.items.length > 0);
}

export function integrationsByGroup() {
  return INTEGRATION_GROUPS.map((group) => ({
    group,
    categories: integrationsByCategory().filter((c) => c.group === group),
  })).filter((g) => g.categories.length > 0);
}

/** Fields an academy has to fill in before an integration can do anything. */
export function requiredFields(def: IntegrationDef): IntegrationField[] {
  return def.fields.filter((f) => !f.hint?.startsWith('Optional') && !f.hint?.startsWith('Only'));
}
