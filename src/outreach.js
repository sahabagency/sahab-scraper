function topIssues(audit) {
  const severity = { high: 3, medium: 2, low: 1 };
  return (audit.issues || [])
    .slice()
    .sort((a, b) => (severity[b.severity] || 0) - (severity[a.severity] || 0))
    .slice(0, 3)
    .map(issue => issue.title.replace('Missing or weak: ', ''));
}

function issueSentence(issues) {
  if (!issues.length) return 'I found a few conversion and discoverability gaps worth reviewing.';
  if (issues.length === 1) return `The clearest gap I found is ${issues[0]}.`;
  return `The clearest gaps I found are ${issues.slice(0, -1).join(', ')} and ${issues.at(-1)}.`;
}

function businessContext(lead, audit) {
  if (!lead.website) {
    return `I found ${lead.name} through Google and noticed there is no public website attached to the business profile. That can make it harder to capture high-intent searches and move prospects into a clear booking path.`;
  }
  const title = audit.evidence?.title;
  return title
    ? `I reviewed ${lead.name}'s public website (${title}) and your Google presence.`
    : `I reviewed ${lead.name}'s public website and Google presence.`;
}

function safeOpportunity(audit) {
  const range = audit.opportunity?.annualRange;
  if (!range || (!range.low && !range.high)) return '';
  return `Using a conservative model based on the visible funnel gaps, average ticket and lead-volume assumptions, the improvement opportunity could be around ${range.low.toLocaleString()}–${range.high.toLocaleString()} per year. This is an estimate, not a verified loss figure.`;
}

function fallbackMessage({ lead, audit, bookingUrl }) {
  const issues = topIssues(audit);
  const route = lead.contactRoute || { channel: lead.contactEmail ? 'email' : 'research_required', destination: lead.contactEmail || null };
  const context = businessContext(lead, audit);
  const gapLine = issueSentence(issues);
  const opportunity = safeOpportunity(audit);

  const body = `Hi ${lead.name} team,\n\n${context}\n\n${gapLine}${opportunity ? `\n\n${opportunity}` : ''}\n\nI’m not reaching out with a generic marketing package. I already have the audit findings and can show you exactly what I would fix first and why.\n\n${bookingUrl ? `If useful, you can pick a time here: ${bookingUrl}\n\n` : ''}Best,\nMohammed\nSahab Agency`;

  return {
    subject: `${lead.name}: quick growth audit`,
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
        content: 'Write a concise B2B outbound message for a marketing agency. Use only the provided public evidence. Do not invent facts, traffic, revenue, ad spend, rankings, or losses. If an opportunity range is present, explicitly label it as an estimate based on assumptions. The opening must prove we actually reviewed the business. Avoid generic praise and spammy language. Aim for 90-150 words. Output valid JSON with subject and body only.'
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
      body: parsed.body,
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
