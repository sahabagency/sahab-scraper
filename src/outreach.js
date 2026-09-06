function topIssues(audit) {
  const severity = { high: 3, medium: 2, low: 1 };
  return (audit.issues || [])
    .slice()
    .sort((a, b) => (severity[b.severity] || 0) - (severity[a.severity] || 0))
    .slice(0, 3)
    .map(issue => issue.title.replace('Missing or weak: ', ''));
}

function money(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function issueSentence(issues) {
  if (!issues.length) return 'لقيت عدة فجوات تستحق المراجعة في مسار التحويل والظهور الرقمي.';
  if (issues.length === 1) return `أوضح فجوة ظهرت لي هي: ${issues[0]}.`;
  return `أوضح الفجوات اللي ظهرت لي: ${issues.join('، ')}.`;
}

function businessContext(lead, audit) {
  if (!lead.website) {
    return `وصلت لـ ${lead.name} من Google، ولاحظت إن ملف النشاط ما عنده موقع واضح مرتبط فيه. هذا يخلي جزء من العملاء أصحاب النية العالية ما يلقون مسار مباشر للخدمات والحجز.`;
  }
  const title = audit.evidence?.title;
  return title
    ? `راجعت حضور ${lead.name} على Google والموقع (${title}) بشكل فعلي.`
    : `راجعت حضور ${lead.name} على Google والموقع بشكل فعلي.`;
}

function buildBreakdownLines(audit) {
  return (audit.opportunityBreakdown || []).slice(0, 5).map(item => {
    const r = item.annualRange || {};
    return `• ${item.service}: ${money(r.low)}–${money(r.high)} سنويًا — ${item.issues?.slice(0, 2).join('، ') || ''}`;
  });
}

function ensureBookingLink(body, bookingUrl) {
  if (!bookingUrl || String(body).includes(bookingUrl)) return body;
  return `${String(body).trim()}\n\nإذا حابين نشوف المراجعة سوا، هذا رابط موعد قصير:\n${bookingUrl}`;
}

function fallbackMessage({ lead, audit, bookingUrl }) {
  const issues = topIssues(audit);
  const route = lead.contactRoute || { channel: lead.contactEmail ? 'email' : 'research_required', destination: lead.contactEmail || null };
  const context = businessContext(lead, audit);
  const gapLine = issueSentence(issues);
  const annual = audit.opportunity?.annualRange || { low: 0, high: 0 };
  const breakdown = buildBreakdownLines(audit);

  const headline = annual.high > 0
    ? `بناءً على المراجعة، قد تكون عندكم فرصة إيراد ضائعة تقديريًا بين ${money(annual.low)} و${money(annual.high)} سنويًا.`
    : '';

  const body = `مرحبًا فريق ${lead.name}\n\n${context}\n\n${gapLine}\n\n${headline}${breakdown.length ? `\n\nالتفصيل حسب كل جزء:\n${breakdown.join('\n')}` : ''}\n\nهذه أرقام تقديرية وليست خسارة محققة؛ بنيتها على الفجوات الظاهرة وافتراضات متوسط قيمة العميل وحجم الـleads.\n\nأنا ما أرسل لكم عرض تسويق عام. عندي المراجعة نفسها، وأقدر أوريكم بالضبط إيش يحتاج يتصلح أول وإيش الأولوية.\n\n${bookingUrl ? `إذا حابين نشوفها سوا، هذا رابط موعد قصير:\n${bookingUrl}\n\n` : ''}محمد\nSahab Agency`;

  return {
    subject: annual.high > 0
      ? `${lead.name}: فرصة إيراد ضائعة قد تصل إلى ${money(annual.high)} سنويًا`
      : `${lead.name}: مراجعة نمو سريعة`,
    body,
    channel: route.channel === 'research_required' ? 'email' : route.channel,
    destination: route.destination || lead.contactEmail || null,
    generatedBy: 'rules',
    evidenceUsed: issues,
    requiresReview: true
  };
}

async function viaOpenAI({ lead, audit, bookingUrl, industry, location }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const payload = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content: 'Write a concise Arabic B2B outbound email for a Saudi/Gulf business in a natural professional tone. Lead with the estimated missed opportunity, then show a short service-by-service breakdown. Use only provided public evidence. Never state revenue loss as a verified fact. Phrase it as estimated missed opportunity / قد تكون تخسر / فرصة ضائعة and explicitly say it is an estimate based on assumptions. Do not invent traffic, spend, rankings, or revenue. Avoid generic praise. If a booking URL is provided, include it exactly once near the end. Output valid JSON with subject and body only.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          business: lead.name,
          website: lead.website,
          googleRating: lead.rating,
          reviewCount: lead.reviewCount,
          industry,
          location,
          contactRoute: lead.contactRoute,
          socials: lead.socials,
          auditScore: audit.score,
          issues: topIssues(audit),
          evidence: audit.evidence,
          opportunityEstimate: audit.opportunity,
          opportunityBreakdown: audit.opportunityBreakdown,
          bookingUrl
        })
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) return null;
  const data = await response.json();
  const text = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!text) return null;

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.subject || !parsed.body) return null;
    return {
      subject: parsed.subject,
      body: ensureBookingLink(parsed.body, bookingUrl),
      channel: lead.contactRoute?.channel || (lead.contactEmail ? 'email' : 'research_required'),
      destination: lead.contactRoute?.destination || lead.contactEmail || null,
      generatedBy: 'openai',
      evidenceUsed: topIssues(audit),
      requiresReview: true
    };
  } catch {
    return null;
  }
}

export async function buildOutreach(args) {
  return (await viaOpenAI(args).catch(() => null)) || fallbackMessage(args);
}
